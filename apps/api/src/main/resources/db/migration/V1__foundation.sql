CREATE TABLE organization (
 id uuid PRIMARY KEY, name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
 version bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE membership (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organization(id),
 issuer varchar(500) NOT NULL, subject varchar(255) NOT NULL,
 role varchar(30) NOT NULL CHECK (role IN ('ORG_OWNER','ORG_ADMIN','VIEWER')),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
 version bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,issuer,subject)
);
CREATE INDEX membership_identity_idx ON membership(issuer,subject);
CREATE TABLE audit_event (
 id uuid PRIMARY KEY, actor_issuer varchar(500) NOT NULL, actor_subject varchar(255) NOT NULL,
 organization_id uuid NOT NULL REFERENCES organization(id), action varchar(100) NOT NULL,
 request_id varchar(64) NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_time_idx ON audit_event(organization_id,occurred_at);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_event is append-only'; END; $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_event
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
