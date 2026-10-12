# Significant dependencies
All versions are pinned by pom.xml or pnpm-lock.yaml. These projects have active stable releases at setup time; review advisories and licenses before release.

| Dependency | Purpose | License | Security surface / alternative |
|---|---|---|---|
| Spring Boot/MVC/Security/Data/Actuator | Transactional API, OIDC validation, persistence, readiness | Apache-2.0 | HTTP/auth/SQL surface; alternative manual servlet/security code increases risk |
| Spring Modulith | Verify domain boundaries | Apache-2.0 | Build-time architecture analysis; alternative ArchUnit |
| Flyway | Versioned PostgreSQL migrations | Apache-2.0 core | Privileged DDL; alternative manual SQL risks drift |
| PostgreSQL JDBC | Database protocol | BSD-2-Clause | SQL/network boundary; no viable standard JDK driver |
| springdoc | Java-derived OpenAPI | Apache-2.0 | Schema endpoint reveals foundation contracts; alternative build-time generator |
| React / Router | UI and navigation | MIT | Browser rendering; alternative handwritten DOM |
| TanStack Query | Central server-state lifecycle | MIT | In-memory response caching; clear cache on identity change |
| React Hook Form / Zod | Accessible form state and validation | MIT | Client validation is advisory; backend validates independently |
| openapi-fetch / openapi-typescript | Typed generated API contract/client | MIT | Central transport only; alternative handwritten types risk contract drift |
| Vite / TypeScript / pnpm | Frontend compilation and reproducible lockfile install | MIT | Build supply chain; frozen lockfile, no business backend |
| Vitest / Testing Library / Playwright | Unit and live-browser validation | MIT / Apache-2.0 | Development only; browser artifacts require trusted downloads |
| Testcontainers / JUnit | Real PostgreSQL integration tests | MIT / EPL-2.0 | Test-only Docker control; never ship with runtime |

TanStack Table is intentionally deferred because Phase 0 has no table workflow; adding it now would violate the dependency policy. Python environments are deferred because workers are README-only.
