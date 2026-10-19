CREATE TABLE data_source (
 id uuid PRIMARY KEY, source_code varchar(100) NOT NULL UNIQUE CHECK(source_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
 source_type varchar(40) NOT NULL CHECK(source_type IN ('OFFICIAL_WEBSITE','PUBLIC_DIRECTORY','PARTNER_FEED','MANUAL_ENTRY','SUPPLIER_SUBMISSION','TRADE_SHOW','OTHER')),
 name varchar(160) NOT NULL CHECK(length(trim(name))>0), namespace varchar(160),base_url varchar(2000),
 access_method varchar(30) NOT NULL CHECK(access_method IN ('MANUAL','API','FEED','PERMITTED_WEB','OTHER')),
 normalization_policy varchar(20) NOT NULL DEFAULT 'PRESERVE' CHECK(normalization_policy IN ('PRESERVE','TRIM')),
 active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE data_source_record (
 id uuid PRIMARY KEY,data_source_id uuid NOT NULL REFERENCES data_source(id),
 record_kind varchar(30) NOT NULL CONSTRAINT data_source_record_kind_check CHECK(record_kind IN ('SUPPLIER','FACILITY','MATERIAL','MATERIAL_VARIANT')),
 external_record_key varchar(500) NOT NULL CHECK(length(trim(external_record_key))>0),
 normalized_external_record_key varchar(500) NOT NULL CHECK(length(normalized_external_record_key)>0),
 first_seen_at timestamptz,last_seen_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(data_source_id,record_kind,normalized_external_record_key),UNIQUE(id,record_kind),
 CHECK((first_seen_at IS NULL AND last_seen_at IS NULL) OR
 (first_seen_at IS NOT NULL AND last_seen_at IS NOT NULL AND first_seen_at<=last_seen_at))
);
CREATE TABLE data_source_observation (
 id uuid PRIMARY KEY,source_record_id uuid NOT NULL REFERENCES data_source_record(id),
 observation_key varchar(200) NOT NULL CHECK(length(trim(observation_key))>0),
 observed_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),retrieved_at timestamptz,
 content_hash varchar(64),hash_algorithm varchar(20),supersedes_observation_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_record_id,observation_key),UNIQUE(id,source_record_id),
 CHECK((content_hash IS NULL AND hash_algorithm IS NULL) OR
 (content_hash IS NOT NULL AND content_hash ~ '^[a-f0-9]{64}$' AND hash_algorithm IS NOT NULL AND hash_algorithm='SHA-256')),
 CHECK(id IS DISTINCT FROM supersedes_observation_id),
 FOREIGN KEY(supersedes_observation_id,source_record_id) REFERENCES data_source_observation(id,source_record_id)
);
CREATE INDEX observation_record_time_idx ON data_source_observation(source_record_id,observed_at DESC,id DESC);
CREATE TABLE data_source_observation_review (
 id uuid PRIMARY KEY,observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 review_status varchar(30) NOT NULL CHECK(review_status IN ('ACCEPTED','REJECTED','NEEDS_REVIEW')),
 license_status varchar(30) CHECK(license_status IN ('UNKNOWN','PERMITTED','RESTRICTED','PROHIBITED')),
 terms_status varchar(30) CHECK(terms_status IN ('UNKNOWN','PERMITTED','RESTRICTED','PROHIBITED')),
 reviewed_by_issuer varchar(500) NOT NULL CHECK(length(trim(reviewed_by_issuer))>0),
 reviewed_by_subject varchar(255) NOT NULL CHECK(length(trim(reviewed_by_subject))>0),
 reviewed_at timestamptz NOT NULL DEFAULT now(),notes varchar(1000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_latest_idx ON data_source_observation_review(observation_id,reviewed_at DESC,created_at DESC,id DESC);
CREATE FUNCTION protect_external_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy text; expected text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.data_source_id,NEW.record_kind,NEW.external_record_key,NEW.normalized_external_record_key)
 IS DISTINCT FROM (OLD.id,OLD.data_source_id,OLD.record_kind,OLD.external_record_key,OLD.normalized_external_record_key)
 THEN RAISE EXCEPTION 'External identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT normalization_policy INTO policy FROM data_source WHERE id=NEW.data_source_id FOR SHARE;
 expected:=CASE policy WHEN 'TRIM' THEN btrim(NEW.external_record_key) ELSE NEW.external_record_key END;
 IF NEW.normalized_external_record_key IS DISTINCT FROM expected THEN
 RAISE EXCEPTION 'Source normalization contract mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER record_identity BEFORE INSERT OR UPDATE ON data_source_record FOR EACH ROW EXECUTE FUNCTION protect_external_identity();
CREATE FUNCTION protect_source_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_code IS DISTINCT FROM OLD.source_code OR (NEW.normalization_policy IS DISTINCT FROM OLD.normalization_policy AND EXISTS(SELECT 1 FROM data_source_record WHERE data_source_id=OLD.id))
 THEN RAISE EXCEPTION 'Source identity contract cannot change' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER source_contract BEFORE UPDATE ON data_source FOR EACH ROW EXECUTE FUNCTION protect_source_contract();
CREATE FUNCTION reject_source_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Source fact is append-only' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER record_no_delete BEFORE DELETE ON data_source_record FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER record_no_truncate BEFORE TRUNCATE ON data_source_record FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER observation_immutable BEFORE UPDATE OR DELETE ON data_source_observation FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER observation_no_truncate BEFORE TRUNCATE ON data_source_observation FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER review_immutable BEFORE UPDATE OR DELETE ON data_source_observation_review FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER review_no_truncate BEFORE TRUNCATE ON data_source_observation_review FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
COMMENT ON TABLE data_source_record IS 'Persistent external identity, not a canonical entity and not observation evidence. Keys preserve source-specific case and normalization.';
COMMENT ON TABLE data_source_observation IS 'Immutable observation facts. No unrestricted raw payload. Human evaluation belongs in append-only observation reviews.';
COMMENT ON TABLE data_source_observation_review IS 'Append-only human/platform evaluation, distinct from immutable source observations.';
