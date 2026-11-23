# STG-1A Java 25 API runtime packaging

This slice packages the existing executable API JAR without changing application
code. Baseline: `d648d7aff2418adc728b1274632f6c7df2be9ab3`. Branch:
`stg-1a-java25-runtime`. Source implementation does not constitute runtime
acceptance, independent acceptance, Phase 3G resumption or deployment permission.

## Image and platform

The runtime base is the Docker Official Image maintained for Eclipse Temurin:

```text
eclipse-temurin:25-jre-noble@sha256:334f294a3edd3fc7c2a7b12ed0f4b3f43c2e9bd39de2867996b4ae6a652721bf
platform: linux/amd64
tag index: sha256:f3dd0838e69b881cc382237d5901e74ae3705b1056ad964b2e0e523b174fef99
config: sha256:0b73b5431584a04c7840a23cbf970bc08ab6239f910deb9f3d5890ec768c6066
config JAVA_VERSION: jdk-25.0.5.1+2
```

Verification on 2026-11-23 KST used HTTPS GETs to Docker Hub's
`registry-1.docker.io/v2/library/eclipse-temurin/manifests/25-jre-noble`, the
selected platform manifest and its config blob. SHA-256 was recomputed over each
raw response and matched its digest. No layer was pulled or executed. The
selected platform digest is pinned rather than relying on the mutable tag.
Registry metadata establishes content identity; no signature attestation,
vulnerability scan or actual Java execution is claimed by this static check.

References: [official image metadata](https://github.com/docker-library/official-images/blob/master/library/eclipse-temurin),
[Temurin container sources](https://github.com/adoptium/containers),
[Temurin licensing](https://adoptium.net/about/legal/).
The JRE uses GPLv2 with the Classpath Exception; the Ubuntu base and other
components retain their respective licenses. The runtime is a supported Ubuntu
JRE image, with no Maven, Node or compiler added. The image inventory and licenses
must be reviewed in an approved build environment. Other CPU architectures need
their own verified manifest and acceptance; do not silently remove the pin.
Digest updates require a reviewed packaging change and renewed verification.

## Exact JAR and build context

The POM and pinned Maven 3.9.11 wrapper imply
`apps/api/target/source-os-api-0.0.1-SNAPSHOT.jar`. Actual Maven output remains
unverified until an authorized build. The verifier requires that exact file,
Spring Boot `JarLauncher`, `SourceOsApplication`, embedded dependencies, Maven
coordinates and a Java 25 application class (major version 69). It rejects a
plain JAR, `.original`, a missing JAR, substituted bytes and stale source records.

Run from the repository root. Python 3 and Git suffice for static verification:

```sh
./scripts/stg-1a-verify.sh
```

Static mode does not execute Docker, Maven, Java, a network request or tests.
It checks every baseline file outside the authorized packaging/policy files using Git's
attribute normalization, including all committed migrations, contracts and tests.
Its Dockerfile checks are a restricted static lint; this mode does not run
Docker's parser or build. No arbitrary preexisting JAR can be registered as a verified build.

**P1 correction: container-capable Maven verification is blocked.** There is no
independently controlled platform approval mechanism integrated into this
verifier. Both the CLI and the build function reject before any Maven command,
including the wrapper version check. The following build invocation exits
non-zero, even when supplied with `--authorized-execution`:

```sh
./scripts/stg-1a-verify.sh build --authorized-execution
```

Caller flags, socket availability, environment variables and property files
cannot enable this path. `TESTCONTAINERS_RYUK_PRIVILEGED=false` is not the Java
privileged setting; Testcontainers 2.0.5 uses
`TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED` / `ryuk.container.privileged`, defaulting
to `true`. For that property, a non-empty environment override takes precedence
over `~/.testcontainers.properties`, then merged classpath
`testcontainers.properties`, then the default. Classpath properties merge with
first-write precedence (alphabetical URLs; `file:` before `jar:`). The verifier
does not assume that a partial scan establishes the effective Java classpath.

Neither setting the correct privileged variable to `false` nor setting
`TESTCONTAINERS_RYUK_DISABLED=true` grants execution authority. The gate rejects
all configurations, including unknown, conflicting and disabled Ryuk, without
changing any override or disabling cleanup. Future enabling work must integrate
an independently controlled, workload-specific approval channel and verify the
effective settings, privilege policy, daemon-socket mounts and a separately
approved cleanup arrangement when Ryuk is disabled. This correction supplies no
such runtime authorization. Static mode remains available. Offline policy tests:

```sh
python3 scripts/stg-1a-policy-test.py
```

The retained build implementation behind this closed gate requires a Java 25
JDK and, only after a future reviewed authorization integration, would run
`./mvnw -B clean verify` from `apps/api`. It clears no caches or unrelated files;
Maven clean removes only the API build output. Do not run it where an existing
`target` directory contains protected evidence. Export a verified copy first
under separate authority if preservation is needed. Build mode rejects build
injection environment variables, requires all default backend `*Test` suites to
have successful non-skipped reports, checks source before and after, and records
the exact source fingerprint, source commit, Java/Maven versions, build command,
log/report hashes and JAR SHA-256 under ignored `.local/stg-1a/`. It is backend
verification only; frontend, contracts and other release gates remain separate.
The evidence is a local trusted-operator record, not a signed supply-chain
attestation. Do not edit it or reuse it after source changes. Commit packaging
before an approved build so the source SHA describes the delivered source.

Check disk and inodes before executing any build or pulling layers. The build
helper requires at least 4 GiB and 50,000 inodes in the source filesystem, but
this is only a headroom gate: separately budget Maven/JDK downloads, Docker's
data root, PostgreSQL test volumes and retained evidence. Stop when capacity is
insufficient; this slice does not authorize cleanup or privileged operations.

Context mode validates an existing record and prints an exact `docker build` command
with source and JAR hash arguments. It does not execute that command. Once
container builds are explicitly authorized, execute that printed command from
the repository root. Its final context argument is **`apps/api`** and the image
platform is **`linux/amd64`**. Do not use the repository root as the build context.
`apps/api/.dockerignore` denies everything except Docker's control files and the
single executable JAR; source, secrets, keys, `.env`, Git, Maven settings, storage,
test reports, frontend assets, scratch and evidence directories are excluded.
The Dockerfile copies only the JAR, makes it root-owned/read-only and verifies
its SHA-256 during construction. Both provenance arguments are required. A
direct build without a valid hash fails. The operator must use the verified
context workflow to bind that hash to the successful build.

After an explicitly approved image build, these **container-executing** probes
can check identity, the contained JAR hash, Java version and actual UID:

```sh
./scripts/stg-1a-verify.sh image --authorized-execution --image source-os-api:stg-1a
```

Image mode resolves the tag once, uses the immutable local image ID thereafter,
and records the image config ID and any actual `RepoDigests` separately. The
local image ID is not a published registry manifest digest. No registry push is
authorized. Probe containers use no network, read-only root, no capabilities and
`no-new-privileges`. They do not start Spring Boot or prove application runtime
acceptance. Records go to `.local/stg-1a/image-provenance.json`.

## External runtime configuration

| Variable | Contract |
| --- | --- |
| `DB_URL` | External PostgreSQL 18 JDBC URL, with approved TLS/network configuration |
| `DB_USER`, `DB_PASSWORD` | External secret configuration; never build arguments or image layers |
| `OIDC_ISSUER_URI` | Existing HTTPS issuer/discovery contract |
| `OIDC_AUDIENCE` | Existing required access-token audience |
| `CORS_ORIGINS` | Existing exact frontend-origin allowlist; never wildcard authenticated origins |
| `SERVER_PORT` | Spring Boot port, default 8080; set explicitly to the host's assigned port |
| `STORAGE_ROOT` | Defaults to `/var/lib/sourceos/storage`; temporary synthetic files only |
| `JAVA_TOOL_OPTIONS` | Trusted operator JVM options, if needed; contains no secrets |

No `local` Spring profile is configured. Do not enable it in hosted staging or
production. Existing non-local JWT issuer, audience, expiry and exact CORS
validation are unchanged. `X-Dev-Subject` cannot replace production JWT
authentication; execution must verify this before acceptance. The host's `PORT`
variable is not automatically translated: configure `SERVER_PORT` directly.
No shell wrapper or implicit port precedence is introduced. Malformed ports are
handled by existing Spring binding; actual failure behavior remains to be tested.

The Java process runs as UID/GID `10001:10001` using an exec-form entrypoint,
with no shell between the runtime and JVM. The base entrypoint is overridden
and its CMD cleared. Signals and exit status reach the JVM directly; logs go
to stdout/stderr. The existing Spring Boot 4.1 default graceful shutdown is
retained. An approved runtime test must confirm SIGTERM handling and the host's
termination grace must exceed the application's shutdown timeout (configure
`SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE` deliberately if needed).

Health endpoints remain `/actuator/health/liveness` and
`/actuator/health/readiness` on `SERVER_PORT`; readiness includes `readinessState`
and `db`. Configure the future host to probe readiness. There is no image-level
health command or new endpoint. DB readiness does not prove browser login or
object-storage readiness. Runtime host/TLS/proxy configuration is future work.

Use a read-only root filesystem where supported, a writable temporary `/tmp`,
and a narrowly scoped writable `/var/lib/sourceos` mount owned by UID/GID 10001
for isolated synthetic tests. Mount ownership must be prepared by the approved
runner; do not add privileges to fix permissions. A read-only root without
these exceptions can fail local storage initialization or JVM/Tomcat temp I/O.
No container filesystem or mount is a production durability solution here.

## Database, storage and acceptance boundaries

PostgreSQL is external and must be version 18. Existing Flyway V1–V23 startup
migrations and JPA validation remain unchanged. This image embeds no database,
H2, SQL initialization script or migration bypass. Migration coordination,
backups, restore and operator credentials require separate deployment work.

STG-2 has **two** private-file dependencies: the development-oriented local
`StoragePort` adapter and PatternRelease's fixed bounded reader backed directly
by local storage. An R2 adapter for `StoragePort` alone does not migrate release
downloads. Neither path changes here. Real private uploads and deployment remain
blocked until the separately reviewed integration is complete. Browser OIDC
PKCE/refresh/logout integration remains another separate staging dependency.

Before runtime acceptance in an explicitly approved isolated environment, run
the unchanged required backend/architecture/frontend/contract regressions and
test the actual container against PostgreSQL 18 and an approved HTTPS OIDC
fixture. Verify healthy readiness, configured port, stdout/stderr, non-root JVM,
SIGTERM/grace/exit status, safe missing configuration failures, invalid CORS
rejection, unauthenticated 401, rejection of development identity substitution,
valid/invalid issuer/audience tokens and scoped writable paths. Preserve full
tests and genuine expiry durations. Image probes do not replace these gates.

## Prior planning and retained evidence

The prior `STG-Next-Slice-Codex-Spec.md` proposal was inspected through the
recorded creation command in the earlier chat, rather than a copy of its file.
Its recorded SHA-256 was
`d0a0d366c2f85eccf6fab11ddb4ce86b06294746b3fc6613e6b87c327528780b`.
Matching scope: external verified JAR, pinned Java 25 JRE, non-root execution,
configuration, ports/signals, narrow context and unchanged business/security
code. The implementation request adds an explicit verifier, detailed provenance,
four named files and A–P reporting. It names this document
`staging-runtime-packaging.md` rather than the proposal's `runtime-packaging.md`.
Direct `SERVER_PORT` configuration makes the proposal's optional wrapper
unnecessary. The latest fresh-workspace instruction authorizes this new machine
and leaves old independent-review evidence in place; it does not grant workload
execution, CI or deployment authority.

The seven original planning files were recorded in the old environment at
`/tmp/source-os-cloud-staging-readiness-20261123` location: architecture report,
readiness gap matrix, provider comparison, cost estimate, implementation roadmap,
next-slice specification and architecture-review manifest. They were not copied,
rewritten or rehashed here. Their current accessibility/integrity is NOT VERIFIED.
The five historical archives and historical references for ten protected files
were not transferred. This workspace verifies all 664 committed baseline files;
that does not establish integrity of absent uncommitted historical artifacts.
Phase 3G remains PAUSED / DEFECT-STOP and no finding or parent defect is closed.
