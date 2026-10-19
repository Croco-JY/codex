#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# API must already be running; output comes from Java DTOs, never a handwritten contract.
curl --fail --silent --show-error http://127.0.0.1:8080/v3/api-docs -o .local/openapi.raw.json
python3 - <<'PYTHON'
import json
from pathlib import Path
spec=json.loads(Path('.local/openapi.raw.json').read_text())
# Host is a deployment setting, not part of the API schema.
spec['servers']=[{'url':'/'}]
Path('docs/openapi.json').write_text(json.dumps(spec,indent=2,sort_keys=True)+'\n')
PYTHON
(cd apps/web && pnpm generate:api)
