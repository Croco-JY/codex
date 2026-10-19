# ADR 018: Platform authorization and scoped audit
Status: Accepted for Phase 1A.
Canonical supply mutations require an ACTIVE PLATFORM_ADMIN assignment for the validated issuer/subject. Organization roles never confer platform authority. Existing tenant authorization remains unchanged.
Audit scope ORGANIZATION requires an organization; PLATFORM forbids an organization and requires a target type/id. V3 logically backfills legacy rows via constant default without mutating history or disabling guards. Existing append-only and truncate protection stay intact. Business mutations and allowlisted scalar audit changes commit atomically. Bootstrap is operator-only SQL, never HTTP or production seed. See the bootstrap runbook.
