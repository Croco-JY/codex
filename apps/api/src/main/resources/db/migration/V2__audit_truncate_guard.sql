CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_event
 FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
