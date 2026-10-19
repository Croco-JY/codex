#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p /workspace/tools /workspace/.cache .local
export UV_CACHE_DIR=/workspace/.cache/uv
export UV_PYTHON_INSTALL_DIR=/workspace/tools/python
export UV_PYTHON_BIN_DIR=/workspace/tools/python-bin
export UV_SYSTEM_CERTS=true
uv python install 3.14.8
export PATH="/workspace/tools/python/cpython-3.14.8-linux-x86_64-gnu/bin:$PATH"
export JAVA_HOME=/workspace/tools/jdk-25.0.4.1
if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  curl -fsSL https://download.oracle.com/java/25/archive/jdk-25.0.4.1_linux-x64_bin.tar.gz -o /tmp/source-jdk.tar.gz
  python3 - <<'PY'
import hashlib,tarfile
assert hashlib.sha256(open('/tmp/source-jdk.tar.gz','rb').read()).hexdigest()=='dd7e7f51d23bcffe85f1a439577ce1c0190a33417b34afdb338f9b3897bdeaec', 'JDK checksum mismatch'
with tarfile.open('/tmp/source-jdk.tar.gz') as t:t.extractall('/workspace/tools',filter='data')
PY
fi
export PATH="$JAVA_HOME/bin:/workspace/tools/pnpm/node_modules/.bin:$PATH"
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]] || { echo 'Node 24 LTS is required'; exit 1; }
if [[ "$(pnpm --version)" != 11.25.0 ]]; then
  npm --cache /workspace/.cache/npm install --prefix /workspace/tools/pnpm pnpm@11.25.0
fi
python3 - <<'PY'
import os,urllib.parse,xml.etree.ElementTree as E
from pathlib import Path
u=urllib.parse.urlparse(os.environ.get('HTTPS_PROXY',os.environ.get('https_proxy','')))
r=E.Element('settings')
if u.hostname:
 p=E.SubElement(E.SubElement(r,'proxies'),'proxy')
 for k,v in {'id':'cloud-proxy','active':'true','protocol':'http','host':u.hostname,'port':str(u.port or 80),'nonProxyHosts':'localhost|127.0.0.1'}.items():E.SubElement(p,k).text=v
# Proxy host metadata only; never copy authentication values.
E.ElementTree(r).write('/workspace/.cache/maven-settings.xml')
PY
cat > .local/cloud-env.sh <<'ENV'
export JAVA_HOME=/workspace/tools/jdk-25.0.4.1
export PATH="$JAVA_HOME/bin:/workspace/tools/python/cpython-3.14.8-linux-x86_64-gnu/bin:/workspace/tools/pnpm/node_modules/.bin:/workspace/tools/terraform:$PATH"
export UV_CACHE_DIR=/workspace/.cache/uv
export UV_PYTHON_INSTALL_DIR=/workspace/tools/python
export UV_PYTHON_BIN_DIR=/workspace/tools/python-bin
export UV_SYSTEM_CERTS=true
export MAVEN_USER_HOME=/workspace/.cache/maven
export MAVEN_ARGS='-s /workspace/.cache/maven-settings.xml -Dmaven.repo.local=/workspace/.cache/m2'
export MAVEN_OPTS="${MAVEN_OPTS:-} -Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts"
if [[ -x /usr/bin/chromium ]]; then export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium; fi
ENV
source .local/cloud-env.sh
(cd apps/api && ./mvnw -B -DskipTests package)
(cd apps/web && pnpm install --frozen-lockfile --store-dir /workspace/.cache/pnpm && pnpm build)
docker compose pull
# Runtime services restart through start_skill, not by assuming retained processes.
