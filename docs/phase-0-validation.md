# Phase 0 validation report
Status: implementation and current-instance checks completed; remote CI/publication verification pending.

## Scope and structure
apps/api, apps/web, three README-only workers, infra/terraform, docs/adr (16 decisions), docs/design-system (13 documents), docs/screens and scripts are created. Java owns transactional truth; identity, organization, authorization, audit, file and narrowly shared HTTP infrastructure are the only modules. No Phase 1+ entities or pages.

## Exact versions
Oracle JDK 25.0.4.1 (SHA-256 verified); Spring Boot 4.1.1; Spring Modulith 2.1.1; springdoc 3.1.1; Maven Wrapper 3.9.11 (distribution checksum pinned); PostgreSQL 18.3 (Compose image digest pinned); Node 24.19.0; pnpm 11.25.0; TypeScript 5.9.3; React/React DOM 19.3.0; Vite 8.3.4; CPython 3.14.8 managed by uv 0.12.23; Terraform 1.14.0. All frontend resolved versions live in pnpm-lock.yaml.

## Migrations
V1__foundation.sql creates organization, membership and audit_event with keys, lifecycle checks, timestamps, versions and append-only update/delete guard.
V2__audit_truncate_guard.sql prevents TRUNCATE. V1 was not edited after application.

## Observed checks
- Backend: 13 tests, 0 failures/errors/skips; unit identity mapping, Modulith boundaries, two real PostgreSQL Testcontainers contexts, Flyway, membership/tenant isolation, audit, storage, errors, health and OIDC adapter isolation.
- Frontend: 2 Vitest tests pass; strict type checks and production build pass.
- Playwright: 1 live API/browser flow passes, including shell, database-backed health, local identity, protected organization creation.
- Terraform: formatting, initialization without backend and validate pass; no infrastructure was applied.
- pnpm production dependency audit: 0 reported vulnerabilities (point-in-time registry result, not a comprehensive security certification).
- Desktop and 390px screenshots inspected; mobile document has no horizontal overflow.
- Cloud setup script is repeatable and tested. install_script and start_skill are confirmed saved in the environment draft; publication remains pending.
- Disposable local source snapshot was committed only in /tmp, cloned without local hardlinks, and built with frozen frontend dependencies and Maven Wrapper. All 13 backend and 2 frontend tests and builds passed. This is a source reproducibility check, not verification of a remote GitHub clone or cloud snapshot restoration.
- Documented development startup succeeded on a fresh Compose PostgreSQL database; live API proxy, regenerated contract equality and Playwright passed. Sending SIGTERM to the development script closed both API and web ports. The original checkout's services were then restarted and validated again.

## CI and limitations
GitHub Actions configuration runs backend/integration tests, frontend checks, contract regeneration, Playwright and Terraform validation. The workflow has not been pushed or executed on GitHub; a green remote CI result is not claimed. Thus the specification's final remote-CI acceptance gate remains pending.
Cognito provider credentials/account are not configured. Production backend uses issuer/audience validation; tests mock provider decoding. Production SPA has a token injection interface, not a complete hosted-login deployment. Private S3 and AWS resources are intentionally future deployment configuration; Terraform contains no fabricated settings.
Fresh-task snapshot restoration and environment publication have not been verified.

## Deviations and deferred work
The checkout root is the existing codex repository rather than nesting another source-os directory; all required relative directories are present. Workers have no executable dependencies or uv.lock because no worker code is implemented, as explicitly permitted. TanStack Table is deferred until there is a table workflow. Cloud browser testing uses the already installed Chromium 154.0.8037.57 because the official Playwright download domain is blocked; standard CI installs the Playwright Chromium bundle. CI uses Temurin Java 25 while this cloud instance uses checksum-verified Oracle Java 25.
Materials, factories, crawlers, patterns, AI, RFQ, contracts, payments, production, QC and logistics remain unimplemented.

## Run
Normal local setup: follow README and run ./scripts/dev.sh; run ./scripts/test.sh while the API is available.
Cloud: run ./scripts/cloud-setup.sh, source .local/cloud-env.sh, then ./scripts/dev.sh. See environment start instructions; tasks use the existing isolated checkout and do not create worktrees.
