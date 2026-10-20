CREATE TABLE country (
 id uuid PRIMARY KEY, alpha2 varchar(2) NOT NULL UNIQUE CHECK(alpha2 ~ '^[A-Z]{2}$'),
 alpha3 varchar(3) NOT NULL UNIQUE CHECK(alpha3 ~ '^[A-Z]{3}$'), name_en varchar(160) NOT NULL CHECK(length(trim(name_en))>0),
 name_native varchar(160) NOT NULL, active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO country(id,alpha2,alpha3,name_en,name_native) VALUES
 ('00000000-0000-4000-8000-000000000001','KR','KOR','South Korea','대한민국'),
 ('00000000-0000-4000-8000-000000000002','JP','JPN','Japan','日本'),
 ('00000000-0000-4000-8000-000000000003','CN','CHN','China','中国');
CREATE TABLE region (
 id uuid PRIMARY KEY, country_id uuid NOT NULL REFERENCES country(id), parent_region_id uuid,
 code varchar(80), name_en varchar(160) NOT NULL CHECK(length(trim(name_en))>0), name_native varchar(160),
 region_type varchar(30) NOT NULL CHECK(region_type IN ('PROVINCE','PREFECTURE','METROPOLITAN','CITY','DISTRICT','OTHER')),
 active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,country_id), UNIQUE(country_id,code), CHECK(id IS DISTINCT FROM parent_region_id),
 FOREIGN KEY(parent_region_id,country_id) REFERENCES region(id,country_id)
);
CREATE INDEX region_parent_idx ON region(parent_region_id);
CREATE TABLE industrial_cluster (
 id uuid PRIMARY KEY, country_id uuid NOT NULL REFERENCES country(id), region_id uuid,
 slug varchar(100) NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]*$'),
 name_en varchar(160) NOT NULL CHECK(length(trim(name_en))>0),name_native varchar(160),description varchar(4000),
 active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,country_id), UNIQUE(country_id,slug), FOREIGN KEY(region_id,country_id) REFERENCES region(id,country_id)
);
CREATE INDEX cluster_region_idx ON industrial_cluster(region_id);
CREATE FUNCTION lock_geography() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(91101); RETURN NULL; END; $$;
CREATE TRIGGER region_lock BEFORE INSERT OR UPDATE OR DELETE ON region FOR EACH STATEMENT EXECUTE FUNCTION lock_geography();
CREATE TRIGGER cluster_lock BEFORE INSERT OR UPDATE OR DELETE ON industrial_cluster FOR EACH STATEMENT EXECUTE FUNCTION lock_geography();
CREATE FUNCTION reject_region_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(WITH RECURSIVE ancestors AS (
 SELECT id,parent_region_id FROM region WHERE id=NEW.parent_region_id
 UNION SELECT r.id,r.parent_region_id FROM region r JOIN ancestors a ON r.id=a.parent_region_id)
 SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'Region cycle' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER region_no_cycle AFTER INSERT OR UPDATE ON region FOR EACH ROW EXECUTE FUNCTION reject_region_cycle();
