# Build context MUST be apps/api (see .dockerignore and staging-runtime-packaging.md).
# Verified Docker Official Image manifest for linux/amd64; no build tools added.
FROM eclipse-temurin:25-jre-noble@sha256:334f294a3edd3fc7c2a7b12ed0f4b3f43c2e9bd39de2867996b4ae6a652721bf

ARG SOURCE_REVISION
ARG JAR_SHA256
LABEL org.opencontainers.image.source="https://github.com/Croco-JY/codex"
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
LABEL com.sourceos.jar.sha256="${JAR_SHA256}"

RUN groupadd --gid 10001 sourceos && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin sourceos
WORKDIR /app
COPY --chown=0:0 --chmod=0444 target/source-os-api-0.0.1-SNAPSHOT.jar /app/source-os-api.jar
RUN test "${#SOURCE_REVISION}" -eq 40 && test "${#JAR_SHA256}" -eq 64 && printf '%s  /app/source-os-api.jar\n' "$JAR_SHA256" | sha256sum --check --strict && mkdir -p /var/lib/sourceos && chown 10001:10001 /var/lib/sourceos

# Temporary/synthetic local storage only; STG-2 must replace BOTH file paths.
ENV STORAGE_ROOT=/var/lib/sourceos/storage
ENV SERVER_PORT=8080
EXPOSE 8080
USER 10001:10001
# Bypass the base image's shell entrypoint so the JVM is PID 1.
ENTRYPOINT ["java", "-jar", "/app/source-os-api.jar"]
CMD []
