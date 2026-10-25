# SOURCE OS — Commercial Readiness / Pattern-to-Transaction Schema Contract v1.0

**Status:** Proposed architecture contract, NOT migration/implementation approval.  
**Evidence baseline:** Croco-JY/codex main at 41c629cce3bcdf5abf776cf33784631a4e150667 (merged PR #4, Phase 2G).  
**Scope:** Six monetization-critical gaps, with Pattern Artifact immediate seam requirements.  
**Authority:** This addendum supplements the existing master specification and ADRs; it does not rewrite previously accepted Phase 0–2 contracts or execute Phase 3+. Every later schema/API implementation requires a separately scoped approval and an exact fresh-HEAD review.

## 0. Verified existing boundaries (do not regress)

- V1–V17 exist on main. V13 Project/Style, V14 Requirement, V15 Material Selection, V16 Facility Candidate, V17 Development Reference are implemented. Some older docs still describe Phase 2 as planned; those passages are historical, not evidence that the merged implementation is absent.
- Organization -> Project -> Style is the private ownership spine; Style UUID is canonical design identity. Organization membership is required before private resource lookup; PLATFORM_ADMIN alone is NOT a tenant bypass. Protected private ancestor validation remains 403 before nested lookup, and wrong nested identity is 404 after tenant authorization.
- Style Facility Candidate currently has a required global facility_id (V16). No private/bring-your-own supplier or facility record exists. Supplier organization linking is historical, grants no canonical edit authority, and global supplier/facility are not buyer-owned.
- Style Development Reference is generic: PENDING -> READY/FAILED/DETACHED, create-new storage, 10 MiB limit, separately committed reservation/storage/finalization, no SQL transaction around remote storage. READY access is privately authorized. A raw storage UUID is not a capability. No automatic physical deletion.
- Released migrations are append-only history. Do not edit V1–V17; add new Flyway versions after V17 after a separate review. Keep strict decimal JSON strings, security audits, Module verification, parent lock order, DB-level trim/state/DELETE/TRUNCATE guards, and immutable keyset/cursor history.
- ADR 012 promises immutable Pattern revisions; ADR 013 signed contract/document hashes; ADR 014 licensed external payment custody. The master spec already envisages ManufacturingSpecificationPackage, commercial quote snapshots, transactional outbox and external signatures. Extend those contracts instead of inventing parallel incompatible systems.

## 1. Domain topology and ownership

Commercial architecture: DISCOVER (global/private supply overlay) -> DEVELOP (Pattern/Grade/BOM/Yield/Cost) -> SOURCE (RFQ) -> TRANSACT (contract/payment) -> PRODUCE (QC/shipment) -> LEARN (permissioned aggregate market signals).

| Domain / aggregate | Scope of truth | Design ownership and lifecycle |
| --- | --- | --- |
| PatternRevision, PatternArtifact, PatternPiece | tenant-private Style | Revision immutable once SEALED; storage identity not exposed |
| MarkerPlanRevision, YieldEstimateRevision, GradingRevision | tenant-private Style + explicit PatternRevision | Versioned computations, immutable input snapshots and evidence |
| BOMRevision, BOMItem, CostScenarioRevision | tenant-private Style | Independently sealed; source-specific currency, unit and price facts |
| ManufacturingSpecificationPackage / PatternRelease | tenant-private Style and later RFQ/Contract | Immutable manifest digest and release/file hashes |
| PrivateSupplier, PrivateFacility, SupplierContact | owner Organization only | May remain private permanently; NOT a catalog Supplier/Facility |
| FacilityCandidate overlay | tenant-private Style | Exactly one global Facility OR one same-tenant PrivateFacility |
| GuestInvitation, GuestSession, QuoteDraft | tenant-private recipient transaction scope | Expiring/revocable capabilities; guest is not Organization member |
| RFQ, RFQRecipient, QuoteRevision, Contract, Milestone | buyer-owned tenant-private commercial domain | Submitted snapshots immutable; signed contract amended, not rewritten |
| Plan/Entitlement, UsageReservation, UsageLedger | tenant-billing/control plane | Concurrency-safe, auditable policy and usage accounting |
| TelemetryConsent, EligibleSignal, PublishedAggregate | separate privacy/analytics boundary | Positive opt-in/contractual basis, purpose bounds, aggregation safety |

Future top-level Modulith packages must expose immutable public records and service/port contracts, not another module's Repository/JPA entity. No reverse dependency from global catalog into buyer-private modules. New value objects do not silently enlarge an existing generic Reference's 10 MiB file allowance.

## 2. Pattern Artifact and Yield / Marker bridge — immediate Phase 3 contract

### 2.1 Minimal schema seams

PatternArtifact is a sealed immutable file/geometry artifact, NOT an always-updated costing row. Required identity/metadata contract:

- pattern_artifact: id UUID; style_id UUID (private scoped via Style ancestry); pattern_revision_id UUID; artifact_kind controlled enum (DXF_AAMA, DXF_ASTM, PDF, GEOMETRY_MANIFEST, OTHER_APPROVED); media_type; byte_size; sha256_content; storage_object_id (server-private); upload_state; parser_version NULLABLE; coordinate_unit NULLABLE; authored_by audit reference; created_at. Binding/ownership and digest are immutable after SEAL.
- pattern_revision: id, style_id, sequential revision_no UNIQUE(style_id, revision_no), lifecycle DRAFT/SEALED/SUPERSEDED (SUPERSEDED must NOT rewrite the sealed content), version for mutable draft state, sealed_at, manifest_sha256; never update approved geometry bytes in place.
- marker_plan_revision: id, style_id, pattern_revision_id, grading_revision_id NULLABLE, fabric_selection_revision_id NULLABLE, revision_no, width_value NUMERIC, width_unit MM/CM/INCH, usable_cuttable_width NUMERIC, width basis/cuttable definition, grain/nap/stripe/plaid rules, defect/edge allowances, marker_length, marker_area, piece_area, unit, layout_software/version, method MANUAL/DETERMINISTIC/AI_PROPOSAL/IMPORTED, state DRAFT/VALIDATED/SEALED, input_manifest_sha256, result_sha256, created_at/sealed_at. Never assume nominal fabric width is cuttable width.
- yield_estimate_revision: id, style_id, marker_plan_revision_id NULLABLE, pattern_revision_id, size_mix_revision_id NULLABLE, method, confidence/provenance, status UNKNOWN/ESTIMATED/VALIDATED, consumption_per_unit NUMERIC(19,6) NULLABLE + unit METER/YARD, marker_efficiency NUMERIC(9,6) NULLABLE, waste_allowance_rate NUMERIC(9,6) NULLABLE, shrinkage_basis, measurement_basis, computed_at, sealed_at. Null/UNKNOWN is distinct from zero; no fake result on upload.
- size_mix_revision: explicit size names and nonnegative quantities/ratios; ratio denominator > 0. Marker results must state which size mix and cutting assumptions they apply to.

Pattern Artifact manifest MUST reserve an extensible machine-readable reference slot, e.g. costingInputs: { markerPlanRevisionId: nullable, yieldEstimateRevisionId: nullable, evaluationState: NOT_EVALUATED | ESTIMATED | VALIDATED }. This is a reference, not mutable numeric denormalization. Do NOT require a yield estimate before a draft pattern is created; future grading/parsing can populate a new sealed revision instead of mutating prior truth.

### 2.2 Numeric and deterministic conditions

- Use PostgreSQL NUMERIC with explicit precision and checks: cuttable width > 0, consumption >= 0 only when status permits zero for legitimate cases, marker efficiency > 0 and <= 1 when validated, waste 0..1. All externally exposed decimals are exact strings; do not use float/double for money, lengths or consumption.
- Units must be dimensional and source-preserving. A declared conversion and persisted versioned rounding policy are required to convert METER/YARD and fabric price per UOM; never multiply $/yd by a meter figure. FX rates are externally sourced and timestamped, never live-overwrite historical totals.
- Material constraints affecting yield: width, selvage, directional nap, repeat matching, shrinkage, loss allowance, marker arrangement, size ratio, cutter constraints, fabric defects. The estimation method, parser/engine version, evidence and human QA status travel with the result.
- Marker efficiency and yield do NOT arise from a simple DXF/PDF upload by magic. A validated geometry parser, actual marker layout/algorithm or explicit verified manual input is necessary. Label AI-only values as estimates, never production-grade measurements.
- Recalculation creates a new result revision. Historical CostScenario and RFQ reference the exact prior revision.

### 2.3 Costing/BOM separate revisions

- bom_revision(id, style_id, revision_no, source_pattern_revision_id NULLABLE, status, manifest_sha256, sealed_at); bom_item_revision(id, bom_revision_id, line_no, item_type, required_material_spec_snapshot, source_selection_id NULLABLE, quantity_per_unit NUMERIC, quantity_uom, waste_basis, source_evidence). Keep immutable revision lines.
- cost_scenario_revision(id, style_id, bom_revision_id, yield_estimate_revision_id NULLABLE, production_size_mix_revision_id NULLABLE, quantity, currency, price_snapshot_refs, fx_snapshot_refs, formula_version, assumptions_json_with_validated_schema, estimated_unit_cost, total_estimated_cost, contingency, status DRAFT/SEALED, sealed_at). Scenario is a planning estimate, NOT an accepted supplier quotation.
- cost components include fabric consumption x fabric price, trims, cutting/making, finishing, waste, logistics, duties, tax/FX allowances as applicable; record inclusion basis and uncertainties. A source Selection references a canonical Material, but does not turn a marketplace Price fact into the buyer's actual negotiated price.
- Separately sealed BOM, Marker, Yield, Cost and Pattern allow later what-if modeling without altering the contractual historical snapshot. No costing engine or BOM migration is authorized by this document.

## 3. Pattern Release as commercial technical appendix

- A Pattern Release is an immutable package manifest selecting exact approved revision IDs AND digests: Pattern, Measurement, Grading, BOM, Tech Pack, material specification, QC tolerances, optional Approved Sample, and attachment content digest(s). Missing future domains must be represented as explicit NOT_INCLUDED or NOT_READY, never implied approved.
- manufacture_specification_package(id, style_id, version, status DRAFT/SEALED/VOIDED_BY_SUCCESSOR, canonical_manifest_version, manifest_sha256, sealed_at, sealed_by, supersedes_package_id NULLABLE). Once SEALED its contents and manifest bytes never change.
- package_item(id, package_id, item_kind, referenced_revision_id, referenced_digest, attachment_digest, inclusion_state) supports multiple artifacts, but server validates ownership and attachment readiness before SEAL. Fixed whitelist of item kinds and artifact payload schema.
- Canonicalize manifest deterministically (fixed ordering/encoding/number formatting, schema version), compute SHA-256 over canonical manifest bytes and individual binary hashes. Define hash algorithm/serialization version, preserve original signed bytes and verify on download; a mere database UUID is NOT audit proof.
- Later rfq_revision and submitted quote_revision bind package ID + manifest SHA-256, party IDs, commercial terms, deadline, currency and immutable snapshots. Signed contract references the *accepted* quote revision + exact package SHA, signer identities, external provider envelope/events and effective terms. Any amendment produces a new package/contract revision and consent flow.
- This is useful evidence, not automatic legal enforceability. Signature validity, chain of custody, contract acceptance and jurisdiction require legal review.
- Future payment milestones refer to immutable contract/milestone criteria, QC/receipt disputes and state transitions. SOURCE OS does NOT hold escrow/customer funds directly: licensed provider custody, signed webhooks, idempotency and ledger reconciliation are separate explicit work (ADR 014). Pattern Release alone may not trigger funds release.

## 4. Guest supplier transaction layer — secure low friction

A guest invitation is a *capability for one recipient and transaction*, NOT an Organization membership or a bare signed object URL.

- guest_invitation(id, buyer_org_id, rfq_recipient_id or pre-RFQ share_id, package_id, scope [VIEW_PACKAGE, SUBMIT_QUOTE, UPLOAD_QUOTE], recipient_contact_hash and verified address route, random_token_verifier_hash, expires_at, max_redemptions, redeemed_count, revoked_at, created_at, created_by, purpose). Generate 256-bit cryptographic opaque tokens; store only keyed/verifier hashes, never raw tokens or URLs in audit/logs/email analytics.
- The one-use *redemption* exchanges the email/messenger URL token for a tightly scoped short-lived server session; viewing/submitting can continue in that session. A literally one-use URL on every page load would break supplier completion. Choose recipient verification (email OTP or comparable step-up) based on document sensitivity and jurisdiction; magic link forwarding alone is not strong identity verification.
- guest_session(id, invitation_id, scopes, issued_at, expires_at, revoked_at, nonce/device_or_stepup_state), fully server-enforced. No active buyer Organization membership, global catalog curation or cross-style browsing. Token subject remains an external guest principal with explicit auditable provenance, never fabricated OIDC issuer/subject.
- Server-streamed authorized views; watermark per recipient and access time; expiration/revoke on document, session and API boundaries; no raw storage paths. Download is separately entitled by scope. Watermark deters casual leaks; it does NOT guarantee copying prevention.
- Lightweight quote form has requested fields (price + currency + price basis, MOQ + unit, production lead-time + start condition, validity end, exclusions and note); input may be manual or via XLSX/PDF upload. Uploaded content stays private/quarantined pending malware/content safety and parser checks. AI/Parser output is a DRAFT that recipient explicitly reviews/submits before creating an immutable quotation revision.
- Idempotent quote submit, anti-replay and CSRF defense as applicable, rate/attempt limits, secure no-store/referrer policy, message-channel restrictions, full revoke/expiry tests. Use verified opted-in supplier contacts; no bulk messages to scraped contacts. E-mail/Kakao/WeChat are possible delivery channels ONLY after lawful account/provider availability, verified recipient and country/channel policies are confirmed.

## 5. BYOS private supplier overlay — immediate seam plus later activation

Do NOT insert a buyer's private address book into canonical supplier_profile/facility, and do NOT reuse supplier_organization_link as a BYOS permission grant.

- private_supplier(id, owner_organization_id FK, display_name, country_id NULLABLE, metadata, status ACTIVE/ARCHIVED, version, created_at, updated_at, provenance OWNER_ENTERED/IMPORT/SUPPLIER_CONFIRMED). Tenant ownership immutable, no public search indexing, no direct global ID.
- private_facility(id, private_supplier_id, owner_organization_id [redundant only if enforcing same-tenant composite FK], name/type/location, version/status). Private supplier contacts have their own restricted confidentiality class; personal contact fields must never be published by default.
- private_supplier_global_binding(id, owner_organization_id, private_supplier_id, global_supplier_id NULLABLE, link_status PROPOSED/APPROVED/REVOKED, resolution_evidence, verified_by, created_at) maps identities without collapsing tenant rows. Similar facility binding can follow independently. A claim by a factory proves the factory actor, not a buyer's consent to disclose buyer-owned commercial history.
- Candidate evolution from V16: add private_facility_id NULLABLE and relax existing facility_id NOT NULL **in a new migration**, then enforce CHECK (num_nonnulls(facility_id, private_facility_id) = 1); add same-tenant FK through a composite private facility key/owner lookup with a DB constraint/trigger that resolves Style -> Project -> Organization. Preserve existing global facility_candidate row IDs, constraints and read semantics; replace global uniqueness by partial UNIQUE(style_id, facility_id) WHERE facility_id IS NOT NULL; add partial UNIQUE(style_id, private_facility_id) WHERE private_facility_id IS NOT NULL. A strong same-tenant constraint must be checked at SQL boundary, not only in service code.
- Define one typed public API candidate source discriminator GLOBAL_FACILITY | PRIVATE_FACILITY with opaque resource IDs and tenant-first resolution. Do not return private IDs in global Supply directory; avoid leaking existence through match suggestions, messages or timing.
- Platform promotion is a verified evidence workflow, NOT automatic copy/merge: candidate match -> supplier claim/validation -> buyer consent to disclose particular fields -> platform moderation -> public canonical create/reuse -> tenant-private binding. Revocation and mistake correction preserve historical private records. Only supplier-authorized/public fields may enter the global graph; buyer negotiations, orders, Pattern and Yield never transfer automatically.
- This enables immediate workflow using a brand's existing factories even with an incomplete global search index.

## 6. Plan entitlement and metered usage

Central feature policy MUST not rely on frontend state or scattered route checks. Organization is the customer billing principal; per-seat/guest behavior is explicitly specified per feature.

- plan_definition(id, plan_code, published_version, effective_at, archived_at); plan_feature(plan_version_id, feature_key, enabled, limit_value NULLABLE, limit_period, unit, policy_version). Define NULL semantics explicitly; no implicit unlimited and no zero-as-missing.
- organization_subscription(id, organization_id, plan_version_id, provider_reference, state, period_start/end, version), organization_entitlement_override(id, organization_id, feature, delta_or_absolute_limit, reason, expires_at, approved_by, audit). Do not store raw payment credentials.
- usage_reservation(id, org_id, feature_key, idempotency_key, units, status RESERVED/CONSUMED/RELEASED/EXPIRED, correlation_resource_id, created_at, finalized_at, version); UNIQUE(org_id, feature_key, idempotency_key).
- usage_ledger(id, org_id, reservation_id, event_type RESERVE/CONSUME/RELEASE/ADJUST, units NUMERIC(19,4), billing_period, occurred_at, audit_reference): append-only; no updates/deletes/truncates. Keep a locking allowance/balance or atomic period-counter row consistent with the ledger to prevent concurrent overspend.
- Policy Enforcement Point runs AFTER authentication/tenant authorization and BEFORE chargeable action. No presence/existence leak across Organizations. Use transactional reserve under per-org-feature-period lock with the business row and audit when possible. For file uploads/AI/guest external I/O, reserve first, run external work outside SQL transaction, finalize or compensate in separate transactions with idempotent retry/reconciliation. It is impossible to atomically commit a database balance and an arbitrary external object-store or AI call without a coordination protocol.
- Meter examples: active projects, Pattern artifact bytes/count, monthly RFQs, active condition alerts, parsed document pages/AI tokens. Define unit, billable event, release/refund, prorating, grandfathering and downgrade behavior per feature; active-state cardinality is not the same as cumulative event quota.
- API outcomes: membership failure remains 403; disabled plan capability returns explicit safe 403 feature-not-entitled; exhausted product quota returns 409 quota-exceeded (not HTTP 429, which is reserved for rate throttling); replay with same idempotency key is stable, mismatched payload returns 409. Provider webhook is signature-verified and idempotent, not itself a source of private authorization.
- Portal guest submissions are charged to a defined buyer org quota only after an authorized invitation/policy decision; a guest may never arbitrarily select org/plan.

## 7. Data de-identification, consent and market intelligence

Separate three classes at the data contract boundary:

1. TENANT_PRIVATE: identifiable Pattern geometry, style/design, negotiated unit prices, exact order quantity, client-supplier relationships, samples, project IDs, granular measurements and buyer-specific Yield. Default NOT exportable or trainable cross-tenant.
2. ELIGIBLE_MARKET_SIGNAL: only an explicit allowlist of coarse categories, normalized cost/consumption bands, country-region ranges, operational delivery outcomes and provenance/confidence *where sharing contract, purpose, retention and consent allow*. It remains access-controlled tenant data until anonymization and approval.
3. PUBLISHED_AGGREGATE: public/enterprise analytics release after grouping, thresholds, disclosure controls and aggregate review; never expose a row-level private event.

- telemetry_consent(org_id, consent_version, purposes, data_categories, effective_at, revoked_at, lawful_basis_or_contract_ref, terms_digest, audit); default DENIED until explicit contractual authorization. Dataset lineage must remember policy version and provenance. Prevent new use on revocation, honor contractual deletion/retention and correct previously shipped outputs where obligations require; immutability of audit proofs is not unlimited retention of personal/private source data.
- signal_candidate(id, org_id, source_event_id, schema_version, eligibility_policy_version, category_bucket, metric_bucket, event_period, region_bucket, disclosure_risk_state, access_restricted, retention_until); recorded outside canonical global supplier identity. Never copy exact quote text, Pattern geometry, contact identifiers, raw free text or foreign keys into analytics export.
- aggregate_release(id, metric_definition_version, window, buckets, contributing_org_count, privacy_method_version, suppression_decision, noise_budget_reference NULLABLE, released_at, reviewer, output_digest); use per-tenant contribution bounding and minimum distinct Organizations (k-anonymity-style threshold), dominance suppression, repeated-query differencing defense, and small-cell/rare-factory protection.
- Removing org IDs, coarse bucketing or adding informal noise alone DOES NOT prove anonymization. If offering privacy guarantees, specify and measure formal differential privacy parameters, composition budget and release accounting; otherwise call the output controlled aggregates, not anonymous. No re-identification, hidden join keys, or cross-tenant model training absent separate explicit consent/legal basis.
- Keep analytics ETL isolated behind authorized, logged extract/transform/approve flow; crawler canonical truth and supply-directory raw evidence never directly ingest buyer-private transaction facts.

## 8. Source-to-transaction commercial defensibility

Leakage mitigation is mainly product value, not hiding factory names or a technical prohibition. Make compliant in-platform trade superior via revision proof, quote comparisons, spec-change notifications, acceptance history, QC issue traceability and provider-backed protected milestones. A branded contract / evidence chain reduces disputes but cannot prevent private out-of-platform negotiations or guarantee court outcomes.

Commercial audit events must preserve immutable actor/scope, action, business-object ID, relevant manifest digest, timestamp and request ID without embedding raw OIDC subjects, guest token, pattern geometry, buyer pricing or supplier private contacts in shared logs. Append-only audit is not permission to broadcast sensitive evidence.

## 9. Phase gating / order of work

| Gate | Scope | Exit / proof |
| --- | --- | --- |
| 3A — now, specification only | Pattern Artifact schema seam + reference slots for Marker/Yield/BOM; security/data classification | DDL/DTO proposal and acceptance tests approved before V18+ is introduced |
| 3B — Pattern revision/artifact | private typed revision, sealed bytes/hash, non-XA upload, authorization | Cross-tenant, replay, crash, truncation, immutable revisions, exact-decimal tests |
| 3C — Geometry/Grading | deterministic parser/grade + revision metadata | Golden fixture and explicit unsupported/unknown states |
| 3D — Marker/Yield/BOM/Cost | separately versioned computation and cost estimates | UOM, shrinkage, size mix, cost sensitivity and no-fake-confidence tests |
| 3E — Release/guest seam | sealed manufacturing package and revokeable scoped sharing contract | Manifest hash golden vectors, guest misuse, expiration and contract baseline tests |
| Parallel narrow design gate | Private Supplier/Facility overlay, entitlement reservations, telemetry consent contracts | Independent migrations and tenant/quotas/privacy negative tests, not hidden 3A work |
| Phase 5+ | Real RFQ/Quotation, guest submissions and commercial revisions | Quote snapshots and recipient acceptance never change |
| Phase 6–9 | Signature, payments, QC, delivery, intelligence | Licensed provider reconciliation + anonymization disclosure review |

No Phase 3 subfeature is made mandatory for Phase 2 read operations. Design decisions here do not authorize code, API, migration, cron, AI inference, payments, outbound messaging or any new role.

## 10. Non-negotiable acceptance tests before monetization release

- Tenant A cannot read/list/guess Tenant B's PrivateSupplier, Pattern, Yield, Quotation, guest invitation or metering ledger. PLATFORM_ADMIN alone cannot access a private account. Every nested access checks tenant membership first, then scoped relation.
- Archived Projects/Styles retain authorized immutable history but reject ordinary descendants' mutations as previously locked; deliberate contract-execution exception requires separate approved policy, never implicit bypass.
- Sealed revisions remain byte/digest-identical under new revisions, catalog price changes, revocation, expiry, cancellation and retry. Direct UPDATE/DELETE/TRUNCATE SQL attempts fail for immutable commercial proofs.
- V16 existing global candidates survive overlay migration, preserve list/uniqueness behavior, and cannot be rebound to another tenant or private facility.
- Guest token: lost/forwarded/replayed/expired/revoked, simultaneous redeem, quote double-submit, session-to-another-RFQ, CSRF and download-without-scope all fail safely; contact and token never appear in response/audit/logs.
- Meter: two concurrent operations cannot both spend the last unit; identical idempotency retries are stable; external IO failure compensates; webhook duplication doesn't double-credit or double-charge.
- Analytics: opt-out, revoked consent, rare supplier cells, high-contribution single tenant, small populations, repeated queries and joins cannot reveal hidden private deal facts.
- No raw issuer/subject, storage ID, private contact, signed object URL, secrets or unsupported parser outputs in public/client/shared export. Exact decimals and historical keyset/cursor semantics survive.
- Schema upgrade runs on a populated V17 baseline; migration checks and independent cross-org integration tests; OpenAPI generated and checked rather than edited manually; CI reports truthfully.

## 11. Explicit open decisions before production build

Legal review for contract evidence/enforceability, cross-border privacy and usage rights; consent text/purpose/retention; exact guest verification assurance level; definition of contract-ready QC/spec completeness; selected licensed escrow/payment provider; plan tiers/quotas and pricing; accepted product costing accuracy; marker/grade computation engine and tolerance; BYOS organization/brand/supplier consent and contact messaging channels; contribution threshold and formal privacy guarantees if claimed. None is silently settled by this specification.
