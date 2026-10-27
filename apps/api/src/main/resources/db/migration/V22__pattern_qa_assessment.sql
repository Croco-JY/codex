-- Human attestation about one exact immutable revision, never production approval.
CREATE FUNCTION pattern_qa_text_is_canonical(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT length(value) BETWEEN 1 AND 2000 AND value = btrim(value,
        U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

CREATE TABLE pattern_qa_assessment (
    id uuid PRIMARY KEY,
    pattern_revision_id uuid NOT NULL,
    style_id uuid NOT NULL,
    assessment_number bigint NOT NULL CHECK (assessment_number BETWEEN 1 AND 9007199254740991),
    outcome varchar(32) NOT NULL CHECK (outcome IN ('OBSERVED','CHANGES_REQUESTED','HUMAN_REVIEWED')),
    evidence_basis varchar(32) NOT NULL CHECK (evidence_basis IN ('METADATA_ONLY','READY_ARTIFACT')),
    artifact_id uuid REFERENCES pattern_artifact(id),
    notes varchar(2000) NOT NULL CHECK (pattern_qa_text_is_canonical(notes)),
    reviewer_issuer varchar(500) NOT NULL CHECK (length(reviewer_issuer) BETWEEN 1 AND 500),
    reviewer_subject varchar(255) NOT NULL CHECK (length(reviewer_subject) BETWEEN 1 AND 255),
    reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (pattern_revision_id,style_id) REFERENCES pattern_revision(id,style_id),
    UNIQUE (pattern_revision_id,assessment_number),
    CHECK ((evidence_basis='METADATA_ONLY' AND artifact_id IS NULL AND outcome<>'HUMAN_REVIEWED')
        OR (evidence_basis='READY_ARTIFACT' AND artifact_id IS NOT NULL))
);

CREATE FUNCTION guard_pattern_qa_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; owner_status varchar; latest bigint;
BEGIN
    SELECT pattern_id INTO owner_id FROM pattern_revision
        WHERE id=NEW.pattern_revision_id AND style_id=NEW.style_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'QA revision context missing'; END IF;
    -- Application already holds Project -> Style. Never acquire ancestors here.
    SELECT status INTO owner_status FROM pattern WHERE id=owner_id FOR UPDATE;
    IF owner_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'QA Pattern is not active'; END IF;
    SELECT COALESCE(max(assessment_number),0) INTO latest FROM pattern_qa_assessment
        WHERE pattern_revision_id=NEW.pattern_revision_id;
    IF latest>=9007199254740991 OR NEW.assessment_number<>latest+1 THEN
        RAISE EXCEPTION 'Invalid QA assessment sequence';
    END IF;
    IF NEW.artifact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pattern_artifact WHERE id=NEW.artifact_id
        AND pattern_revision_id=NEW.pattern_revision_id AND style_id=NEW.style_id AND state='READY'
    ) THEN RAISE EXCEPTION 'Exact READY artifact required'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pattern_qa_assessment_insert BEFORE INSERT ON pattern_qa_assessment
    FOR EACH ROW EXECUTE FUNCTION guard_pattern_qa_assessment();
CREATE TRIGGER pattern_qa_assessment_no_update BEFORE UPDATE ON pattern_qa_assessment
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER pattern_qa_assessment_no_delete BEFORE DELETE ON pattern_qa_assessment
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER pattern_qa_assessment_no_truncate BEFORE TRUNCATE ON pattern_qa_assessment
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
