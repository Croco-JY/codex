#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --wait
mkdir -p .local
(cd apps/api && ./mvnw -B -DskipTests package)
SPRING_PROFILES_ACTIVE=local java -jar apps/api/target/source-os-api-0.0.1-SNAPSHOT.jar >.local/api.log 2>&1 &
api_pid=$!
web_pid=''
cleanup() {
  if [[ -n "$web_pid" ]]; then kill "$web_pid" 2>/dev/null || true; fi
  kill "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
for attempt in {1..90}; do
  if curl -fsS http://127.0.0.1:8080/actuator/health/readiness >/dev/null; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then cat .local/api.log; exit 1; fi
  if [[ "$attempt" == 90 ]]; then cat .local/api.log; exit 1; fi
  sleep 1
done
cd apps/web
node node_modules/vite/bin/vite.js --host 127.0.0.1 &
web_pid=$!
wait "$web_pid"
