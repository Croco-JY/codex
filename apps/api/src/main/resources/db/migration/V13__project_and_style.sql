CREATE TABLE project (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organization(id),
 name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
 description varchar(4000) CHECK (description IS NULL OR length(btrim(description)) > 0),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
 version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_org_page_idx ON project(organization_id,created_at DESC,id DESC);
CREATE INDEX project_org_status_page_idx ON project(organization_id,status,created_at DESC,id DESC);

CREATE TABLE style (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES project(id),
 style_code varchar(100) CHECK (style_code IS NULL OR length(btrim(style_code)) > 0),
 name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
 description varchar(4000) CHECK (description IS NULL OR length(btrim(description)) > 0),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
 version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX style_project_page_idx ON style(project_id,created_at DESC,id DESC);
CREATE INDEX style_project_status_page_idx ON style(project_id,status,created_at DESC,id DESC);

CREATE FUNCTION protect_project_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.organization_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Project identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER project_identity BEFORE UPDATE ON project FOR EACH ROW EXECUTE FUNCTION protect_project_identity();

CREATE FUNCTION protect_style_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.project_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Style identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER style_identity BEFORE UPDATE ON style FOR EACH ROW EXECUTE FUNCTION protect_style_identity();

CREATE FUNCTION reject_workspace_destruction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Workspace rows cannot be deleted or truncated' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER project_no_delete BEFORE DELETE ON project FOR EACH ROW EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER project_no_truncate BEFORE TRUNCATE ON project FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER style_no_delete BEFORE DELETE ON style FOR EACH ROW EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER style_no_truncate BEFORE TRUNCATE ON style FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
