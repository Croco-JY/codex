# SOURCE OS
## Global Fashion Product Development & Manufacturing Operating System
### Codex Master Specification v3.0

---

# 0. CODEX OPERATING INSTRUCTION

You are building a production-grade B2B fashion manufacturing platform named **SOURCE OS**.

Do not attempt to implement the entire product at once.

The complete product vision is described below so that architectural decisions made today remain compatible with future phases.

However:

> **IMPLEMENT PHASE 0 ONLY.**

Do not implement Phase 1 or later business features unless explicitly instructed in a later task.

When uncertain, prefer:

1. simpler architecture,
2. explicit domain boundaries,
3. stronger data integrity,
4. stronger security,
5. fewer dependencies,
6. boring and maintainable technology,

over novelty or premature optimization.

---

# 1. PRODUCT DEFINITION

SOURCE OS is a global B2B fashion sourcing, product-development and manufacturing platform.

Its long-term workflow is:

```text
DISCOVER
Materials
Factories
Suppliers

        ↓

DEVELOP
Style
Measurements
AI Pattern
Grading
Tech Pack
BOM
Samples

        ↓

SOURCE
RFQ
Quotes
Comparison

        ↓

TRANSACT
Contract
Electronic Signature
Protected Payment

        ↓

PRODUCE
Production
QC
Shipment

        ↓

LEARN
Supplier Performance
Pattern Corrections
Cost Data
Production Data
Reorder
```

SOURCE OS is not merely a directory.

It should eventually become:

> The operating layer between a fashion idea and a finished product.

---

# 2. CORE DATA PRINCIPLE

Every manufactured design has one canonical:

```text
STYLE ID
```

Everything belongs directly or indirectly to that Style.

```text
STYLE
│
├─ Design References
├─ Measurement Spec
├─ Materials
├─ Pattern
├─ Grading
├─ Tech Pack
├─ BOM
├─ Samples
├─ Factory Candidates
├─ RFQs
├─ Quotations
├─ Contract
├─ Production
├─ QC
└─ Shipment
```

Do not design these as disconnected products.

---

# 3. PRODUCT AREAS

Long-term navigation:

```text
DISCOVER
  Materials
  Factories
  Suppliers
  Saved
  Compare

DEVELOP
  Projects
  Styles
  Measurements
  SOURCE Pattern
  Tech Packs
  BOM
  Samples

SOURCE
  RFQs
  Quotes
  Shortlists

TRADE
  Contracts
  Approvals
  Payments
  Claims

PRODUCE
  Production
  QC
  Shipments
  Reorders

ORGANIZATION
  Team
  Security
  Settings

ADMIN
```

Do not expose unavailable areas before enabled by feature flags.

---

# 4. LANGUAGE & RUNTIME POLICY

This is a permanent architectural decision for initial product development.

Use only these primary languages:

## Business Core

```text
Java 25 LTS
```

Responsibilities:

```text
Identity
Organizations
Permissions
Materials
Factories
Projects
RFQ
Quotation
Contracts
Payments
Production
QC
Audit
Business Transactions
```

Java owns all transactional business truth.

---

## Frontend

```text
TypeScript 5.9.x
React 19.3.x
Vite 8.x
Node.js 24 LTS
```

Responsibilities:

```text
User Interface
Search UI
Forms
Tables
Dashboards
Pattern Review UI
Contract UI
Production UI
```

Node.js is a frontend build/runtime tool only.

Do not implement the business backend in Node.js.

---

## Data / AI

```text
Python 3.14.x
uv
pyproject.toml
uv.lock
```

Responsibilities:

```text
Crawler
ETL
Normalization
Translation
Document Parsing
Pattern AI
Image Processing
Semantic Search Experiments
Model Training
Recommendations
```

Python must not own transactional business state.

---

## Database

```text
PostgreSQL 18.x
```

PostgreSQL is the sole system of record.

---

## Infrastructure

```text
Terraform
```

---

# 5. TECHNOLOGIES NOT TO USE IN V1

Do not introduce these unless measured evidence later requires them:

```text
Rust
Kotlin
Node backend
Microservices
Kubernetes
Kafka
Redis
MongoDB
OpenSearch / Elasticsearch
GraphQL
Custom authentication
Custom payment custody
Custom electronic-signature cryptography
Event sourcing frameworks
CQRS frameworks
```

Rust may later be used for proven CPU-intensive bottlenecks such as:

```text
Pattern geometry
Massive ETL
High-volume image processing
```

but not before profiling proves a need.

---

# 6. BACKEND STACK

Use:

```text
Java 25 LTS
Spring Boot 4.1.x
Spring MVC
Spring Security
Spring Modulith
Spring Data JPA
JdbcClient where explicit SQL is clearer
Maven Wrapper
Flyway
PostgreSQL 18
```

Do not use WebFlux unless future measured requirements justify it.

The product is transaction-heavy and PostgreSQL-centric.

---

# 7. FRONTEND STACK

Use:

```text
React
TypeScript strict mode
Vite
React Router
TanStack Query
TanStack Table
React Hook Form
Zod
```

Use one centralized API client.

Do not scatter direct fetch calls through page components.

Server state belongs in TanStack Query.

Avoid Redux until a real requirement appears.

---

# 8. PYTHON STACK

Use:

```text
Python 3.14
uv
pyproject.toml
uv.lock
```

Do not mix:

```text
pip requirements.txt
Poetry
Conda
multiple environment managers
```

unless explicitly required.

Use ordinary CPython.

Do not use experimental free-threaded Python in initial production systems.

---

# 9. REPOSITORY STRUCTURE

Create:

```text
source-os/

apps/
  api/
  web/

workers/
  ingestion/
  pattern-ai/
  intelligence/

infra/
  terraform/

docs/
  adr/
  design-system/
  screens/

scripts/
```

Phase 0 may scaffold worker directories but must not implement Phase 1+ business logic.

---

# 10. BUILD POLICY

Backend:

```text
Maven Wrapper
```

Frontend:

```text
pnpm
pnpm-lock.yaml
```

Python:

```text
uv
uv.lock
```

Infrastructure:

```text
Terraform
```

Do not add Nx, Turborepo, Bazel or another repository orchestration framework unless proven necessary.

---

# 11. VERSION POLICY

Prefer LTS and stable versions over newest versions.

## Patch updates

May be automated if:

```text
CI passes
tests pass
security scan passes
```

## Minor updates

Require:

```text
CI
E2E
human approval
```

## Major updates

Require:

```text
ADR
dedicated upgrade branch
migration testing
manual review
```

Never automatically major-upgrade:

```text
Java
Spring Boot
React
PostgreSQL
Python
Node
```

---

# 12. DEPENDENCY POLICY

Do not add a dependency if the current standard library or existing dependency can reasonably solve the problem.

Every new significant dependency should document:

```text
Why is it needed?
Is it actively maintained?
What is its license?
What security risk does it add?
What alternative exists?
```

Avoid dependency proliferation.

---

# 13. ARCHITECTURE

Use:

```text
MODULAR MONOLITH
```

Do not create microservices.

Conceptual runtime:

```text
Browser
   │
CloudFront
   │
React SPA
   │
ALB
   │
Java Spring Boot API
   │
PostgreSQL
   │
S3 / Async auxiliary workers
```

Python workers are auxiliary.

If Python is completely unavailable:

```text
Contracts
RFQ
Production
Payments
QC
```

must still work.

---

# 14. BACKEND MODULES

Long-term backend modules:

```text
identity
organization
authorization
geography

supplier
facility
capability

material
pricing
inventory

dataingestion
supplierverification

project
style

measurement
pattern
grading
techpack
bom
sample

rfq
quotation

contract
approval
payment

production
quality
logistics

file
audit
notification
```

Use package-by-domain.

Do not organize top-level source code as:

```text
controllers/
services/
repositories/
entities/
```

Use domain modules instead.

---

# 15. MODULE BOUNDARIES

Modules must not directly mutate another module's database entity.

Cross-module communication should use:

```text
IDs
immutable DTOs
public application services
domain/application events
```

Use Spring Modulith and/or ArchUnit to verify dependency boundaries.

Do not create a giant shared module.

`shared` may contain only truly generic infrastructure concepts.

---

# 16. API CONTRACT

Backend is authoritative.

Flow:

```text
Java DTO
↓
OpenAPI
↓
Generated TypeScript Client
↓
React
```

Do not manually duplicate Java API models as handwritten TypeScript interfaces.

Generate frontend API types/client from OpenAPI.

---

# 17. DATABASE PRINCIPLE

PostgreSQL is the only business system of record.

Do not allow:

```text
Python workers
frontend
crawler
AI
```

to independently establish business truth.

All transactional writes must pass through controlled application interfaces.

---

# 18. DATABASE RULES

Use:

```text
UUID identifiers
UTC timestamps
foreign keys
explicit lifecycle states
version columns
Flyway migrations
```

Money:

```text
NUMERIC(19,4)
```

Java:

```text
BigDecimal
```

Never use floating-point numbers for:

```text
money
exchange rates
commercial quantities
```

---

# 19. DATABASE MIGRATIONS

Use Flyway for every schema change.

Production must never rely on Hibernate auto schema generation.

Production setting:

```text
ddl-auto=validate
```

Schema migration files are immutable once released.

Do not silently edit a released migration.

---

# 20. ORGANIZATION MODEL

SOURCE OS is organization-centric.

Model:

```text
UserIdentity
Organization
Membership
```

Organization types eventually include:

```text
BRAND
PROMOTION_AGENCY
FACTORY
MILL
CONVERTER
MATERIAL_SUPPLIER
TRIM_SUPPLIER
PROCESSOR
QC_COMPANY
LOGISTICS_COMPANY
PLATFORM
```

A user may belong to multiple organizations.

Do not store one global role directly on the user.

---

# 21. ROLE MODEL

Long-term roles:

```text
PLATFORM_ADMIN

ORG_OWNER
ORG_ADMIN

BUYER_MANAGER
BUYER_MEMBER

SUPPLIER_MANAGER
SUPPLIER_MEMBER

CONTRACT_SIGNER
FINANCE_MANAGER

VIEWER
```

Permission must consider:

```text
user
membership
organization
role
resource ownership
action
```

---

# 22. AUTHORIZATION

Centralize authorization.

Do not scatter organization ownership checks throughout controllers.

Never trust:

```text
organizationId
```

supplied by the client without verifying membership and permission.

---

# 23. AUTHENTICATION

Use OIDC abstraction.

Production target:

```text
AWS Cognito
```

Do not store passwords.

Support future:

```text
MFA
Passkeys/WebAuthn
Session Management
Account Revocation
```

---

# 24. STEP-UP AUTHENTICATION

Future sensitive actions require fresh strong authentication.

Examples:

```text
Sign Contract
Accept Contract Amendment
Initiate Payment
Release Payment
Change Payout Destination
Add Organization Admin
Change Organization Ownership
Sensitive Export
```

Design authentication abstraction now so this can be added without rewriting the application.

Do not implement contract flows in Phase 0.

---

# 25. DUAL APPROVAL

Future organizations may configure approval policies.

Examples:

```text
Contract > threshold
Payment > threshold
Payout Account Change
```

Future entities:

```text
ApprovalPolicy
ApprovalRequest
ApprovalDecision
```

Do not implement Phase 0 business workflows yet.

---

# 26. FILE STORAGE

Use storage abstraction:

```text
StoragePort
```

Adapters:

```text
LocalStorageAdapter
S3StorageAdapter
```

Development may use local storage.

Production uses private S3.

Do not store binary files in PostgreSQL.

---

# 27. FILE SECURITY

Future sensitive files include:

```text
Tech Packs
Patterns
Contracts
BOMs
QC Reports
```

File URLs must be:

```text
private
authorized
temporary
```

Never permanent public URLs.

Future uploads should pass:

```text
Quarantine
↓
MIME validation
↓
file-signature validation
↓
malware scan
↓
approved storage
```

Prepare interfaces but do not overimplement scanning infrastructure in Phase 0.

---

# 28. AUDIT ARCHITECTURE

Create an audit foundation in Phase 0.

Future AuditEvent fields:

```text
actor
organization
action
entityType
entityId
beforeState
afterState
requestId
timestamp
```

Audit events are append-only.

Never log:

```text
passwords
tokens
secret keys
confidential file contents
```

---

# 29. SECURITY STANDARD

Treat SOURCE OS as a high-trust B2B transaction platform.

Engineering security practices should align with:

```text
OWASP ASVS
```

appropriate to the eventual contract/payment risk profile.

Security is a release requirement, not optional polish.

---

# 30. SECURITY HEADERS

Prepare frontend delivery for:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

Production CORS must use an allowlist.

Never use wildcard production CORS.

---

# 31. SECRETS

No production secret may appear in:

```text
Git
source code
Docker image
frontend bundle
plain Terraform files
```

Production target:

```text
AWS Secrets Manager
```

---

# 32. DATA INGESTION VISION

Future global sourcing data enters through:

```text
Partner API
Partner Feed
CSV Import
Supplier Portal
Public API
Permitted Web Collection
Manual Admin
```

Every external value must preserve provenance.

---

# 33. SUPPLY DATABASE GEOGRAPHY

Materials UI may group:

```text
Europe
Japan
Korea
China
United States
Other
```

Database geography must use:

```text
Global Region
Country
Administrative Region
Industrial Cluster
```

Examples:

```text
Europe
→ Italy
→ Piedmont
→ Biella

Japan
→ Aichi
→ Bishu

China
→ Zhejiang
→ Shaoxing
```

Do not store "Europe" as a country.

---

# 34. MATERIAL MODEL VISION

Canonical parent:

```text
Material
```

Types:

```text
FABRIC
LEATHER
LINING
INTERLINING
ZIPPER
BUTTON
SNAP
BUCKLE
THREAD
TAPE
LABEL
ELASTIC
FILLING
PACKAGING
OTHER
```

Use structured subtype schemas.

Do not put the entire material domain in one unvalidated JSONB column.

---

# 35. FACTORY MODEL VISION

Factories eventually expose structured capability.

Product Capability:

```text
Coat
Jacket
Shirt
Trousers
Knitwear
Denim
Leather
Down
Tailoring
Sportswear
Accessories
```

Material Capability:

```text
Heavy Wool
Leather
Denim
Technical Nylon
Stretch Knit
Silk
Down
```

Process Capability:

```text
Full Canvas
Bonding
Seam Sealing
Leather Sewing
Embroidery
Washing
Laser Cutting
Automated Cutting
```

Do not reduce a factory to one arbitrary quality star rating.

---

# 36. SEARCH ARCHITECTURE

Do not deploy a search cluster initially.

Initial search:

```text
PostgreSQL structured filters
PostgreSQL indexes
pg_trgm where needed
```

Design interfaces:

```text
MaterialSearchService
FactorySearchService
```

so a future search engine can replace the implementation without changing domain logic.

---

# 37. FACET SYSTEM

Filters must use an extensible facet architecture.

Supported filter concepts:

```text
MULTI_SELECT
SINGLE_SELECT
NUMBER_RANGE
MONEY_RANGE
PERCENTAGE_RANGE
BOOLEAN
HIERARCHICAL
DATE_RANGE
SEARCHABLE_SELECT
```

UX levels:

```text
PRIMARY
ADVANCED
SPECIALIST
```

Do not show 40 expanded filters simultaneously.

---

# 38. SEARCH STATE

All significant filter state must be serializable into URL parameters.

Example:

```text
/materials?
country=JP
&wool.min=80
&gsm.min=450
&gsm.max=550
&moq.max=100
```

Refreshing must preserve the query.

Saved searches eventually store the same filter model.

---

# 39. RESULT MODES

Future material/factory searches should support:

```text
GRID
LIST
TABLE
```

Professional users need table mode.

Do not force consumer-style card browsing for all workflows.

---

# 40. DESIGN SYSTEM

Create:

```text
SOURCE UI
```

Architecture:

```text
Design Tokens
↓
Accessible Primitives
↓
Reusable Components
↓
Domain Components
↓
Patterns
↓
Screens
```

Do not design every page independently.

---

# 41. VISUAL CHARACTER

SOURCE OS should feel:

```text
Industrial
Editorial
Enterprise
Precise
Trustworthy
Material-focused
```

Avoid:

```text
excessive gradients
glassmorphism
crypto aesthetics
consumer marketplace playfulness
excessive animation
oversized empty cards
```

---

# 42. DESIGN TOKENS

Use semantic tokens.

Examples:

```text
surface-default
surface-muted
surface-raised

text-primary
text-secondary
text-muted

border-default
border-strong

action-primary
action-danger

status-success
status-warning
status-danger
status-info
```

Do not hardcode random hex colors across feature components.

---

# 43. DENSITY

Prepare for:

```text
Comfortable
Compact
```

view density.

Professional sourcing teams may prefer compact mode.

---

# 44. CORE COMPONENT VISION

Future SOURCE UI components include:

```text
Button
Input
NumberInput
CurrencyInput
Select
Combobox
MultiSelect
Checkbox
Radio
DatePicker
FileUpload
Tabs
Badge
StatusBadge
Dialog
Drawer
Toast
Breadcrumb
Pagination
DataTable
FilterPanel
FilterChip
SearchInput
EntityCard
MoneyDisplay
FreshnessIndicator
VerificationBadge
Timeline
ActivityFeed
EmptyState
ErrorState
Skeleton
```

Phase 0 should implement only a minimal foundation necessary for shell/demo.

---

# 45. DATA TRUST

Future external data must distinguish:

```text
PUBLIC_OBSERVED
SUPPLIER_PROVIDED
SUPPLIER_ATTESTED
PLATFORM_VERIFIED
TRANSACTION_VERIFIED
AI_INFERRED
```

Never visually equate scraped data with transaction-verified data.

---

# 46. DAILY CRAWLER VISION

Future permitted external data collection begins daily at:

```text
11:00 Asia/Seoul
```

This starts orchestration.

Do not hit all websites simultaneously.

Pipeline:

```text
Scheduler
↓
Crawler Worker
↓
Raw Capture
↓
Parse
↓
Normalize
↓
Validate
↓
Staging
↓
Diff
↓
Publish / Review
```

Crawler failure must never impact core business systems.

---

# 47. CRAWLING POLICY

Never bypass:

```text
authentication
paywalls
anti-bot protections
access controls
robots restrictions
explicit terms restrictions
```

Store source permissions and provenance.

Do not copy images without appropriate rights.

---

# 48. MONTHLY SUPPLIER VERIFICATION

Future suppliers that have claimed profiles and have eligible verified contacts may receive a monthly verification request.

The system should distinguish:

```text
Initial Claim Invitation
```

from:

```text
Recurring Monthly Supplier Verification
```

Do not automatically enroll arbitrary scraped emails into recurring monthly outreach.

---

# 49. MONTHLY VERIFICATION PURPOSE

Suppliers confirm fields such as:

```text
Price
MOQ
MCQ
Lead Time
Capacity
Capabilities
Public Profile Data
```

This creates:

```text
SUPPLIER_ATTESTED
```

data.

It must not automatically become:

```text
PLATFORM_VERIFIED
```

or:

```text
TRANSACTION_VERIFIED
```

---

# 50. SUPPLIER EMAIL ARCHITECTURE

Future email sending should use an external delivery provider abstraction.

Target:

```text
Amazon SES
```

Interface:

```text
EmailDeliveryPort
```

Track:

```text
SENT
DELIVERED
BOUNCED
COMPLAINED
SUPPRESSED
```

Do not use personal Gmail accounts for bulk verification.

Do not use email opens as the primary success metric.

Primary success event:

```text
SUPPLIER_VERIFICATION_COMPLETED
```

---

# 51. SUPPLIER VERIFICATION FLYWHEEL

Long-term:

```text
Daily Observation
↓
Supplier Confirmation
↓
Higher Data Quality
↓
Buyer Search
↓
RFQ
↓
Transaction
↓
Transaction Verified Data
↓
Better Supplier Intelligence
↓
Higher Supplier Incentive To Participate
```

---

# 52. SOURCE PATTERN

SOURCE PATTERN is a future paid product-development module.

Capabilities:

```text
AI Pattern Draft
Pattern Adjustment
Measurements
Grading
Pattern QC
Revision Management
DXF/PDF
Secure Factory Release
```

Do not implement it in Phase 0.

---

# 53. PATTERN ARCHITECTURE

Do not ask an LLM to directly generate authoritative production geometry.

Future flow:

```text
Garment Understanding
↓
Measurement Parser
↓
Base Block Retrieval
↓
Pattern Draft Proposal
↓
Deterministic Geometry Engine
↓
Geometry Validation
↓
Human QA where required
↓
Approved Pattern
```

AI proposes.

Deterministic geometry computes.

Human QA validates according to service tier.

---

# 54. PATTERN DATA MODEL VISION

Future entities:

```text
MeasurementSpec
MeasurementRevision

Pattern
PatternRevision
PatternPiece
PatternPoint
PatternAnnotation
PatternRelease

GradeRuleSet
GradeRule
SizeRange
```

Never overwrite an approved pattern revision.

---

# 55. PATTERN FORMATS

Initial future support:

```text
DXF-AAMA
DXF-ASTM
PDF
```

Do not reverse engineer proprietary CAD formats without permission.

---

# 56. PATTERN QUALITY STATES

Future states:

```text
AI_DRAFT
SYSTEM_VALIDATED
HUMAN_REVIEWED
SAMPLE_VALIDATED
PRODUCTION_VERIFIED
```

Never describe an AI-only draft as production verified.

---

# 57. PATTERN BUSINESS MODEL

SOURCE PATTERN is a paid service.

Potential service tiers:

```text
BASIC
AI Pattern + Automated Validation

PRO
AI Pattern + Technician QA + Revision

DEVELOPMENT
Pattern + QA + Grading + POM + Fit Review + Factory Package
```

Prices belong in configuration/data, not application code.

---

# 58. PATTERN PRICING PRINCIPLE

Target initial gross margin:

```text
approximately 50%
```

Variable cost may include:

```text
AI compute
Human pattern QA
Grading QA
Simulation
Revision reserve
Infrastructure
Payment fees
Support allowance
```

Formula:

```text
Selling Price =
Variable Cost / (1 - Target Gross Margin)
```

At 50% target gross margin:

```text
Selling price ≈ 2 × true variable cost
```

Do not confuse 50% markup with 50% gross margin.

---

# 59. PATTERN LEARNING LOOP

Future feedback:

```text
AI Pattern
↓
Sample
↓
Pattern Correction
↓
Approved Fit
```

Store corrections together with:

```text
Garment Type
Material
Fit
Factory
Pattern Revision
Sample Result
```

Never auto-retrain production models on unreviewed feedback.

---

# 60. RFQ / QUOTATION VISION

Future workflow:

```text
Style
↓
RFQ
↓
Multiple Suppliers
↓
Quotation Revisions
↓
Comparison
↓
Shortlist
↓
Accept
```

Submitted commercial snapshots are immutable.

Do not reconstruct old quotes using today's prices.

---

# 61. CONTRACT VISION

Future contract references:

```text
Accepted Quote
Pattern Revision
Measurement Revision
Tech Pack Revision
BOM Revision
Approved Sample
Material Specification
QC Standard
Delivery
Payment Terms
```

Signed contracts are immutable.

Changes require amendments.

---

# 62. MANUFACTURING SPECIFICATION PACKAGE

Future signed production contracts lock:

```text
Pattern Revision
Measurement Revision
Tech Pack Revision
BOM Revision
Approved Sample Reference
Material Specification
```

into one:

```text
ManufacturingSpecificationPackage
```

with cryptographic hashes.

This package defines exactly what is being manufactured.

---

# 63. ELECTRONIC SIGNATURE

Future electronic signing uses an external signature provider abstraction.

Do not build custom cryptographic signature infrastructure.

Store:

```text
provider
envelopeId
signers
timestamps
document hashes
provider event IDs
```

---

# 64. PAYMENT VISION

SOURCE OS must not initially custody funds directly.

Use licensed payment / escrow providers.

Future entities:

```text
PaymentIntent
PaymentMilestone
ProviderTransaction
ReleaseCondition
PaymentStatus
```

---

# 65. PAYMENT MILESTONES

Example future workflow:

```text
30% Deposit
20% Material Ready
40% QC Passed
10% Shipment
```

Always display:

```text
Contract Total
Paid
Protected
Pending
Released
Remaining
```

---

# 66. PRODUCTION

Future production states:

```text
DRAFT
CONFIRMED
MATERIAL_ORDERED
MATERIAL_READY
CUTTING
SEWING
FINISHING
QC
READY_TO_SHIP
SHIPPED
DELIVERED
CANCELLED
```

State transitions must be explicitly validated.

---

# 67. QC

Future QC results:

```text
PASS
CONDITIONAL_PASS
FAIL
```

Store:

```text
inspection type
sample size
minor defects
major defects
critical defects
photos
report
inspector
timestamp
```

QC may later trigger payment-release conditions.

---

# 68. TRANSACTIONAL OUTBOX

Use PostgreSQL transactional outbox when business events are introduced.

Concept:

```text
Business Change
+
Outbox Event

COMMIT
```

Then process asynchronously.

Do not introduce Kafka initially.

---

# 69. ERROR MODEL

Use RFC Problem Details style responses.

Example:

```json
{
  "type": "invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "The requested transition is not allowed.",
  "requestId": "..."
}
```

All API errors must contain a correlation/request ID.

---

# 70. IDEMPOTENCY

Future high-risk mutations must support idempotency.

Examples:

```text
RFQ final submission
Contract creation
Payment initiation
Production confirmation
```

Design infrastructure so:

```text
Idempotency-Key
```

can be added consistently.

---

# 71. OBSERVABILITY

Use structured JSON logging.

Include where available:

```text
requestId
userId
organizationId
module
route
latency
HTTP status
```

Use Spring Boot Actuator.

Future monitoring includes:

```text
5xx
latency
CPU
memory
DB connections
failed jobs
crawler failures
AI worker failures
payment webhook failures
signature webhook failures
```

---

# 72. TESTING POLICY

Backend:

```text
JUnit
Spring Boot Integration Tests
Testcontainers PostgreSQL
Flyway Migration Tests
Authorization Tests
Module Boundary Tests
State Transition Tests
```

Do not use H2 as a fake substitute for PostgreSQL.

Frontend:

```text
Vitest
React Testing Library
```

E2E:

```text
Playwright
```

---

# 73. SECURITY CI

Prepare CI architecture for:

```text
dependency vulnerability scanning
secret scanning
static analysis
container image scanning
SBOM generation
license reporting
```

Do not add excessive tooling before Phase 0 is stable, but document the intended path.

---

# 74. INFRASTRUCTURE TARGET

Production target:

```text
CloudFront
S3
ALB
ECS Fargate
RDS PostgreSQL Multi-AZ
Cognito
Secrets Manager
KMS
CloudWatch
WAF
```

Infrastructure as code:

```text
Terraform
```

Do not introduce Kubernetes.

---

# 75. BACKUP / RECOVERY

Future production target:

```text
RDS Multi-AZ
Automated Backups
Point-in-Time Recovery
```

Initial design target:

```text
RPO <= 5 minutes
RTO <= 1 hour
```

Document backup restoration procedures before contract/payment launch.

---

# 76. DOCUMENTATION POLICY

Important architectural decisions must be documented before implementation.

Create:

```text
/docs/product-vision.md
/docs/information-architecture.md
/docs/domain-model.md
/docs/architecture.md
/docs/security-model.md
/docs/authorization.md
/docs/data-model.md
/docs/data-ingestion.md
/docs/search-and-facets.md
/docs/pattern-system.md
/docs/pattern-ai.md
/docs/pattern-pricing.md
/docs/contract-security.md
/docs/payment-security.md
/docs/roadmap.md
```

Phase 0 does not need detailed implementation of every future file, but should establish the documentation structure and core architectural documents.

---

# 77. ARCHITECTURE DECISION RECORDS

Create:

```text
/docs/adr/
```

Required ADRs:

```text
001-language-runtime-policy.md
002-modular-monolith.md
003-postgresql-system-of-record.md
004-no-microservices-v1.md
005-no-search-cluster-v1.md
006-openapi-generated-client.md
007-crawler-isolation.md
008-ai-non-critical-path.md
009-oidc-authentication.md
010-tenant-isolation.md
011-immutable-commercial-history.md
012-pattern-revision-model.md
013-contract-immutability.md
014-external-payment-custody.md
015-design-system.md
016-dependency-policy.md
```

ADRs for future unimplemented modules may document intent only.

---

# 78. DESIGN SYSTEM DOCUMENTATION

Create:

```text
/docs/design-system/
```

At minimum:

```text
principles.md
tokens.md
typography.md
spacing.md
density.md
components.md
forms.md
tables.md
filters.md
statuses.md
accessibility.md
responsive.md
internationalization.md
```

Phase 0 may keep these concise but structurally complete.

---

# 79. SCREEN SPECIFICATION POLICY

Before future major screen implementation create:

```text
/docs/screens/
```

Each screen specification should define:

```text
Purpose
User Goal
Roles
Information Hierarchy
Primary CTA
Secondary Actions
Required Data
Loading State
Empty State
Error State
Permissions
Responsive Behavior
Accessibility
Acceptance Criteria
```

Do not implement large business screens before their screen spec exists.

---

# 80. ROADMAP

## PHASE 0 — FOUNDATION

Build only:

```text
Repository
Backend shell
Frontend shell
PostgreSQL
Flyway
Organization foundation
Membership foundation
Authorization foundation
OIDC abstraction
Audit foundation
Storage abstraction
Request IDs
Error model
Health endpoints
Design system foundation
Local development
CI
Terraform skeleton
Documentation
```

---

## PHASE 1 — GLOBAL SUPPLY DATABASE

Future:

```text
Geography
Suppliers
Facilities
Materials
Factories
Capabilities
Price History
Data Provenance
Freshness
Source Registry
Crawler
Supplier Claim
Monthly Supplier Verification
Search
Filters
Saved
Compare
Admin Data Review
```

Do not implement in current task.

---

## PHASE 2 — PRODUCT WORKSPACE

Future:

```text
Projects
Styles
References
Measurements
Tech Pack Vault
BOM foundation
```

---

## PHASE 3 — SOURCE PATTERN OPERATIONS

Future:

```text
Pattern Vault
Pattern Revision
Measurement Revision
DXF/PDF import
Pattern Preview
Grade Rules
Grading Table
Secure Factory Release
Paid Pattern Service
Pricing Engine
Human QA Workflow
```

---

## PHASE 4 — PATTERN AI

Future:

```text
Garment Classification
Measurement Parsing
Block Retrieval
Existing Pattern Modification
AI Draft
Geometry Validation
Grading Suggestion
Pattern QC
```

---

## PHASE 5 — SOURCING MARKETPLACE

Future:

```text
RFQ
Quotation
Quote Revision
Comparison
Samples
Supplier Activity
```

---

## PHASE 6 — CONTRACT

Future:

```text
Contract Generator
Manufacturing Specification Package
Amendments
Authorized Signers
Approvals
Electronic Signature
Evidence Package
```

---

## PHASE 7 — PROTECTED TRANSACTION

Future:

```text
Payment Provider
Milestone Payment
Approvals
Reconciliation
Disputes
```

---

## PHASE 8 — PRODUCTION OS

Future:

```text
Production
Milestones
QC
Shipment
Supplier Performance
Reorder
```

---

## PHASE 9 — INTELLIGENCE

Future:

```text
Semantic Search
Image Search
Material Recommendation
Factory Recommendation
Pattern Recommendation
Cost Prediction
Lead-time Prediction
Production Risk Prediction
```

---

# 81. PHASE 0 REPOSITORY REQUIREMENTS

Create:

```text
/apps/api
/apps/web

/workers/ingestion
/workers/pattern-ai
/workers/intelligence

/infra/terraform

/docs
/docs/adr
/docs/design-system
/docs/screens

/scripts
```

Workers may contain README/scaffolding only.

Do not implement AI/crawler logic.

---

# 82. PHASE 0 BACKEND

Create Spring Boot API using:

```text
Java 25
Spring Boot 4.1.x
Maven Wrapper
Spring MVC
Spring Security
Spring Modulith
Flyway
PostgreSQL
Actuator
```

Implement only foundation modules:

```text
identity
organization
authorization
audit
file
shared infrastructure
```

Do not create material/factory/RFQ/contract/payment/pattern business entities yet.

---

# 83. PHASE 0 DATABASE

Create initial Flyway migrations for only required foundation entities.

Likely foundation tables:

```text
organization
membership

audit_event

attachment metadata if necessary

outbox_event only if required by actual Phase 0 implementation
```

Identity-provider users may be represented by an internal user identity mapping if necessary.

Keep the schema minimal.

Do not anticipate every future table.

---

# 84. PHASE 0 AUTH

Create an authentication abstraction.

Local development may use a clearly isolated development authentication adapter if needed.

Production interface must target OIDC/Cognito.

Do not implement custom password authentication.

Do not commit real Cognito credentials.

---

# 85. PHASE 0 AUTHORIZATION

Implement centralized authorization foundation.

At minimum prove:

```text
A user can belong to an organization.

A user without membership cannot access the organization's protected resource.

An authorized organization member can access allowed resources.
```

Use integration tests.

---

# 86. PHASE 0 AUDIT

Implement reusable audit infrastructure.

Prove through a simple foundation operation that an audited mutation records:

```text
actor
organization
action
timestamp
request ID
```

Do not build the entire future audit model unnecessarily.

---

# 87. PHASE 0 STORAGE

Create:

```text
StoragePort
LocalStorageAdapter
```

Provide interface placeholder/configuration for future S3 adapter.

Do not implement production S3 credentials into repository.

A simple authorized storage test is sufficient.

---

# 88. PHASE 0 ERROR HANDLING

Implement:

```text
RFC Problem Details
request/correlation ID
consistent error mapper
```

Every error response should expose the request ID.

---

# 89. PHASE 0 OBSERVABILITY

Implement:

```text
structured application logs
request ID filter/interceptor
Actuator health
readiness
liveness
```

Logs must not leak authentication tokens.

---

# 90. PHASE 0 FRONTEND

Create React application using:

```text
TypeScript strict
React
Vite
React Router
TanStack Query
React Hook Form
Zod
```

Implement only:

```text
Application Shell
Basic Navigation Shell
Authentication State Foundation
Organization Context Foundation
API Health Demo
Minimal Design System Foundation
Error Boundary
Loading / Empty / Error examples
```

Do not build fake Material/Factory/Pattern/Contract pages.

---

# 91. PHASE 0 DESIGN SYSTEM

Implement minimal reusable foundation:

```text
Button
Input
StatusBadge
Card / Surface
PageLayout
Stack / basic layout primitives
Skeleton
EmptyState
ErrorState
```

Use semantic CSS variables.

Create token architecture for:

```text
color
spacing
typography
radius
border
elevation
motion
```

Do not attempt to create 50 components during Phase 0.

---

# 92. PHASE 0 FRONTEND API CLIENT

Backend exposes OpenAPI.

Generate TypeScript API client.

Frontend must use generated types/client.

Do not create duplicate handwritten DTOs.

Add CI check so incompatible API changes are visible.

---

# 93. PHASE 0 LOCAL DEVELOPMENT

Provide a documented local-development command.

Use Docker Compose only where useful for local infrastructure such as PostgreSQL.

Expected experience:

```text
clone repo
configure example env
start PostgreSQL
run migrations
start API
start Web
run tests
```

Document exact steps.

---

# 94. PHASE 0 ENVIRONMENT CONFIGURATION

Create:

```text
.env.example
```

with safe placeholders only.

Never commit secrets.

Validate required environment variables on application startup where appropriate.

---

# 95. PHASE 0 CI

GitHub Actions must:

```text
Build backend
Run backend unit tests
Run PostgreSQL Testcontainers integration tests
Validate Flyway migrations
Build frontend
Run frontend tests
Run basic lint/type checks
Run Playwright smoke test
```

CI must fail on test failure.

---

# 96. PHASE 0 TESTCONTAINERS

Use actual PostgreSQL Testcontainers.

Test:

```text
fresh PostgreSQL starts
all Flyway migrations execute
application connects successfully
foundation repository works
```

Do not use H2.

---

# 97. PHASE 0 E2E

Create one minimal Playwright smoke flow.

Example:

```text
Open application
↓
Application shell renders
↓
Frontend calls API health
↓
Backend responds
↓
Health status visible
```

If development authentication is included:

also verify a basic protected-route flow.

Keep E2E minimal.

---

# 98. PHASE 0 TERRAFORM

Create a Terraform skeleton only.

Document intended production resources:

```text
VPC
ALB
ECS Fargate
RDS PostgreSQL
S3
CloudFront
Cognito
Secrets Manager
KMS
CloudWatch
WAF
```

Do not build unnecessarily complete production infrastructure if credentials/account configuration are unavailable.

Prefer syntactically valid, modular scaffolding over fabricated production settings.

---

# 99. PHASE 0 DOCUMENTATION

Required completed core documents:

```text
/docs/product-vision.md
/docs/information-architecture.md
/docs/domain-model.md
/docs/architecture.md
/docs/security-model.md
/docs/authorization.md
/docs/roadmap.md

/docs/design-system/principles.md
/docs/design-system/tokens.md
/docs/design-system/components.md
```

Create all required ADRs listed above.

Future-topic ADRs may explicitly state:

```text
Status: Proposed / Future Phase
```

Do not pretend unimplemented architecture is already implemented.

---

# 100. PHASE 0 ACCEPTANCE CRITERIA

Phase 0 is complete only when all of the following are true.

## Clean environment

A fresh clone can be built from documented steps.

## Database

A clean PostgreSQL database applies all Flyway migrations.

## Backend

Backend starts successfully.

## Frontend

Frontend starts successfully.

## API

Frontend successfully communicates with backend.

## Authorization

Tenant/membership isolation foundation has passing integration tests.

## Audit

Foundation audit flow is demonstrated and tested.

## OpenAPI

OpenAPI specification is generated.

## TypeScript Client

Frontend API types/client are generated from OpenAPI.

## Tests

Backend tests pass.

Frontend tests pass.

Integration tests pass.

Playwright smoke passes.

## CI

CI is green.

## Documentation

Required docs and ADRs exist.

## Security

No secrets committed.

No custom password handling.

No wildcard production CORS defaults.

## Scope

No Phase 1 business entities or pages have been implemented.

---

# 101. STOP CONDITION

When every Phase 0 acceptance criterion passes:

> **STOP.**

Do not proceed to:

```text
Materials
Factories
Crawler
Supplier Verification
Patterns
AI Pattern
RFQ
Quotes
Samples
Contracts
Electronic Signatures
Payments
Production
QC
Logistics
```

Wait for explicit next instruction.

---

# 102. REQUIRED FINAL CODEX REPORT

After Phase 0 is complete, provide a concise report containing:

```text
1. Repository structure created
2. Technologies and exact versions used
3. Architecture decisions implemented
4. Flyway migrations created
5. Tests added
6. CI status
7. Local run commands
8. Known limitations
9. Deferred Phase 1 items
10. Any deviation from this specification
```

If anything was changed from this specification, explain why.

Do not silently deviate.

---

# 103. FIRST EXECUTION COMMAND

Begin now.

Your current task is:

> Implement SOURCE OS Phase 0 only, exactly according to this specification.

Start by:

1. inspecting the current repository,
2. preserving valid existing work if compatible,
3. creating/updating the architecture documentation and ADRs,
4. scaffolding the repository structure,
5. configuring backend, frontend and PostgreSQL,
6. implementing the Phase 0 foundation,
7. adding tests,
8. configuring CI,
9. running the full Phase 0 test suite,
10. fixing all failures,
11. reporting the completed Phase 0 result.

Do not ask for permission between routine implementation steps.

Do not proceed to Phase 1.

Do not invent business data.

Do not create mock material/factory/contract functionality merely to make the product appear more complete.

The goal of this phase is not feature count.

The goal is a stable, secure, maintainable foundation for the complete SOURCE OS product.