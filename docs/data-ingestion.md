# External identity and observation foundation

Phase 1A has no production crawler or raw evidence object storage. Sources are stable registered datasets/providers with an explicit PRESERVE (default) or TRIM key contract. Raw external keys are retained. Identity is `(data_source_id,record_kind,normalized_external_record_key)`, so SUPPLIER 123 and MATERIAL 123 are distinct; MATERIAL is only a prepared enum, not a business implementation.

DataSourceRecord is persistent EXTERNAL IDENTITY. DataSourceObservation is immutable observed facts, identified by record + observation key. Retrying identical facts returns the same observation; conflicting facts return 409. Corrected observations are new rows with a same-record supersedes FK. first/last_seen follow actual observation times, not retry times. No raw_payload column, scraped HTML, full API response or unrestricted JSON metadata is persisted.

DataSourceObservationReview is separate append-only evaluation, with server Actor, review status, optional license/terms and bounded internal notes. Latest review is ordered by reviewed_at,created_at,id descending. Reviews never update observation facts. These endpoints are platform-admin-only.

Typed `*_external_record` tables perform Identity Resolution: a DataSourceRecord identifies a canonical supplier/facility. Typed `*_source` tables perform Fact Provenance: an actual DataSourceObservation supports a canonical field/fact. Real FKs and record-kind checks preserve this distinction. Canonical creation plus binding/citation/audit uses one transaction and a record lock; retries reuse the existing canonical ID. Aliases never merge entities automatically.

All source mutations require PLATFORM_ADMIN and audit. No private payloads/authentication headers or tokens belong in notes, URLs or audit. Operational collection permissions and stable source key contracts must be reviewed before real imports; API availability is not permission to bypass source restrictions.
