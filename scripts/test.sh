#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd apps/api && ./mvnw -B verify)
(cd apps/web && pnpm typecheck && pnpm test && pnpm build)
# Start local API first via scripts/dev.sh in another terminal.
(cd apps/web && pnpm e2e)
