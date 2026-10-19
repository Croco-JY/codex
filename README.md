# SOURCE OS — Phase 1A
A modular manufacturing-platform foundation with a canonical supplier/facility directory, source identity and provenance, geography and capability taxonomy. Materials and commercial workflows remain outside this implementation.

## Prerequisites
Java 25 LTS, Node 24 LTS, pnpm 11.25.0, Docker with Compose; CPython 3.14 + uv for deterministic OpenAPI export tooling; workers remain README-only. Terraform >=1.10 <2 for scaffold validation only.

## First run
```sh
cp .env.example .env
cd apps/web
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
cd ../..
./scripts/dev.sh
```
Compose uses `.env` for the local database password. To customize API settings, export variables in `.env` explicitly in your shell (do not source untrusted files). The API defaults match the example in the local profile. Flyway applies migrations on startup and JPA validates the schema.
Local API binds 127.0.0.1:8080; web binds 127.0.0.1:5173. The dev script waits for database-backed readiness. Logs: `.local/api.log`. Ctrl-C stops API and web; `docker compose stop` stops the database without deleting data.

## Authentication and organization setup
The local profile accepts `X-Dev-Subject` only on a loopback-bound API. Enter your own local identity in the development-only UI, then create a real organization. There are no seeded accounts or business data. Organization creation atomically establishes owner membership and an audit event. Production builds contain no development login; integrate an OIDC authorization-code + PKCE provider via the token interface before deployment. No passwords are handled.

Production must omit `local`, set DB_URL/DB_USER/DB_PASSWORD, HTTPS OIDC_ISSUER_URI, OIDC_AUDIENCE and explicit CORS_ORIGINS. The resource server validates issuer, expiry and audience. Cognito is the production target. Do not deploy local authentication or the Vite development server.

## Tests and contract
```sh
./scripts/test.sh
# With API running, regenerate Java-owned contract and frontend types:
./scripts/export-openapi.sh
cd apps/web && pnpm check:api
```
Backend uses actual PostgreSQL 18 Testcontainers for migrations, repositories, audit, tenant isolation, authorization, storage and OpenAPI tests. No H2 or skipped integration fallback. Vitest covers health/error states. Playwright exercises live health and protected organization creation. CI runs these checks and compares generated schema artifacts.

## Layout
`apps/api`: Java transactional core; `apps/web`: React UI; `workers/*`: future-only README scaffolds; `infra/terraform`: nondeployed skeleton; `docs`: architecture, ADRs, design system, specification and API contract; `scripts`: local orchestration.

Phase 1A APIs use `/api/v1/suppliers`, `/facilities`, `/countries`, `/regions`, `/industrial-clusters` and `/capabilities`. Directory reads require authentication; `/api/v1/admin/...` mutations require a separately provisioned PLATFORM_ADMIN, never an organization role. See [platform bootstrap](docs/platform-admin-bootstrap.md), [ingestion contract](docs/data-ingestion.md) and [API contract](docs/openapi.json). No production principals or fake suppliers are seeded; only KR/JP/CN reference countries are seeded. Full directory/admin UI is deferred.

See [Phase 1A validation](docs/phase-1a-validation.md) for current results and `docs/phase-0-validation.md` for historical baseline results. Production infrastructure and full Cognito browser sign-in require deployment-specific configuration; this repository supplies their foundations only.
