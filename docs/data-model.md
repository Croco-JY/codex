# Data Model

V1 migration creates organization, membership and audit_event. UUID keys, UTC timestamptz, foreign keys, explicit states, version columns and unique identity/organization membership prevent ambiguity. Audit is append-only via PostgreSQL trigger. Hibernate ddl-auto=validate; Flyway owns schema changes. Commercial money will use NUMERIC(19,4) and BigDecimal in future phases.
