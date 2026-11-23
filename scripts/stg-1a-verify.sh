#!/usr/bin/env bash
# Static by default. Executing build/image modes requires explicit workload authority.
set -euo pipefail
export STG_1A_REPO_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
exec python3 - "$@" <<'PY'
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

BASELINE = 'd648d7aff2418adc728b1274632f6c7df2be9ab3'
BASE_IMAGE = 'eclipse-temurin:25-jre-noble@sha256:334f294a3edd3fc7c2a7b12ed0f4b3f43c2e9bd39de2867996b4ae6a652721bf'
ALLOWED = {'apps/api/Dockerfile', 'apps/api/.dockerignore',
           'scripts/stg-1a-verify.sh', 'docs/staging-runtime-packaging.md'}
JAR_PATH = 'apps/api/target/source-os-api-0.0.1-SNAPSHOT.jar'
ROOT = Path(os.environ['STG_1A_REPO_ROOT'])
EVIDENCE = ROOT / '.local/stg-1a'

def require(condition, message):
    if not condition:
        raise ValueError(message)

def run(args, cwd=None):
    return subprocess.check_output(args, cwd=ROOT if cwd is None else cwd,
                                   stderr=subprocess.STDOUT, text=True).strip()

def git(*args):
    return run(['git', *args])

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def source_state():
    require(git('remote', 'get-url', 'origin') == 'https://github.com/Croco-JY/codex.git',
            'Unexpected origin')
    git('merge-base', '--is-ancestor', BASELINE, 'HEAD')
    require(git('branch', '--show-current') == 'stg-1a-java25-runtime', 'Wrong working branch')
    changed = set(git('diff', '--name-only', BASELINE, '--').splitlines())
    require(changed <= ALLOWED, 'Out-of-scope tracked source or file-mode change')
    baseline = git('ls-tree', '-r', BASELINE).splitlines()
    for line in baseline:
        meta, path = line.split('\t', 1)
        if path not in ALLOWED:
            require((ROOT / path).is_file(), 'Missing protected source: ' + path)
            require(git('hash-object', '--path=' + path, path) == meta.split()[2],
                    'Out-of-scope source change: ' + path)
    paths = git('ls-files', '-c', '-o', '--exclude-standard').splitlines()
    baseline_paths = {line.split('\t', 1)[1] for line in baseline}
    require(set(paths) <= baseline_paths | ALLOWED, 'Unexpected source files outside packaging scope')
    files = {p: digest(ROOT / p) for p in sorted(set(paths))}
    fingerprint = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return {'source_revision': git('rev-parse', 'HEAD'), 'baseline': BASELINE,
            'source_fingerprint_sha256': fingerprint, 'files_sha256': files}

def static_checks():
    state = source_state()
    docker = (ROOT / 'apps/api/Dockerfile').read_text()
    instructions = [line for line in docker.splitlines() if line and not line.startswith('#')]
    require(instructions[0] == 'FROM ' + BASE_IMAGE, 'Base image digest/platform contract changed')
    require('USER 10001:10001' in instructions, 'Dedicated non-root user required')
    entry = next(line[11:] for line in instructions if line.startswith('ENTRYPOINT '))
    require(json.loads(entry) == ['java', '-jar', '/app/source-os-api.jar'], 'JVM must be PID 1')
    require('CMD []' in instructions, 'Inherited base CMD must be cleared')
    require('ENV SERVER_PORT=8080' in instructions and 'EXPOSE 8080' in instructions, 'Port contract changed')
    copies = [line for line in instructions if line.startswith('COPY ')]
    require(copies == ['COPY --chown=0:0 --chmod=0444 target/source-os-api-0.0.1-SNAPSHOT.jar /app/source-os-api.jar'],
            'Only the exact JAR may enter the image')
    require('sha256sum --check --strict' in docker, 'Build must check JAR hash')
    require(not any(line.startswith(('ADD ', 'VOLUME ', 'HEALTHCHECK ')) for line in instructions),
            'Unexpected runtime instruction')
    for line in instructions:
        require(line.split()[0] in {'FROM','ARG','LABEL','RUN','WORKDIR','COPY','ENV','EXPOSE','USER','ENTRYPOINT','CMD'},
                'Unsupported Dockerfile instruction')
    ignore = [s for s in (ROOT / 'apps/api/.dockerignore').read_text().splitlines() if s and not s.startswith('#')]
    require(ignore == ['**','!Dockerfile','!.dockerignore','!target/','target/**',
                       '!target/source-os-api-0.0.1-SNAPSHOT.jar'], 'Build context allowlist changed')
    ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
    pom = ET.parse(ROOT / 'apps/api/pom.xml').getroot()
    require(pom.findtext('m:artifactId', namespaces=ns) == 'source-os-api' and
            pom.findtext('m:version', namespaces=ns) == '0.0.1-SNAPSHOT', 'JAR filename must be reconciled')
    require(pom.findtext('m:properties/m:java.version', namespaces=ns) == '25', 'Java 25 required')
    config = (ROOT / 'apps/api/src/main/resources/application.yml').read_text()
    require('include: readinessState,db' in config and 'enabled: true' in config, 'Readiness contract changed')
    require('SPRING_PROFILES_ACTIVE' not in docker and 'X-Dev-Subject' not in docker, 'Development runtime default forbidden')
    print('PASSED: baseline preservation, packaging static lint, runtime configuration and context allowlist')
    print('NOT VERIFIED: Docker parser/build, actual Java runtime, non-root process, readiness, SIGTERM and authentication')
    return state

def inspect_jar(path):
    require(path.is_file() and not path.is_symlink(), 'Expected regular executable JAR is absent')
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        require(len(names) == len(set(names)), 'Duplicate JAR entries')
        require(z.testzip() is None, 'Corrupt JAR')
        manifest = z.read('META-INF/MANIFEST.MF').decode().replace('\r\n', '\n').replace('\n ', '')
        attrs = dict(line.split(': ', 1) for line in manifest.splitlines() if ': ' in line)
        require(attrs.get('Main-Class') == 'org.springframework.boot.loader.launch.JarLauncher', 'Not executable Spring Boot JAR')
        require(attrs.get('Start-Class') == 'com.sourceos.SourceOsApplication', 'Wrong Spring application')
        require(any(n.startswith('BOOT-INF/lib/') and n.endswith('.jar') for n in names), 'Missing runtime dependencies')
        main = z.read('BOOT-INF/classes/com/sourceos/SourceOsApplication.class')
        require(main[:4] == bytes.fromhex('cafebabe') and int.from_bytes(main[6:8], 'big') == 69,
                'Application class must target Java 25')
        props = z.read('META-INF/maven/com.sourceos/source-os-api/pom.properties').decode()
        values = dict(line.split('=', 1) for line in props.splitlines() if '=' in line and not line.startswith('#'))
        require(values.get('groupId') == 'com.sourceos' and values.get('artifactId') == 'source-os-api' and
                values.get('version') == '0.0.1-SNAPSHOT', 'Unexpected Maven artifact')
    return digest(path)

def verify_build_record(state):
    path = EVIDENCE / 'jar-provenance.json'
    require(path.is_file(), 'NOT VERIFIED: no authorized Maven build/provenance; packaging context is unavailable')
    record = json.loads(path.read_text())
    require(record['source'] == state, 'Source changed since the verified Maven build; rebuild required')
    require(record['build_command'] == ['./mvnw', '-B', 'clean', 'verify'] and record['build_exit_code'] == 0,
            'Successful full Maven verification required')
    require(record['jar_path'] == JAR_PATH and record['jar_sha256'] == inspect_jar(ROOT / JAR_PATH),
            'Stale or substituted JAR; rebuild required')
    require(record['build_log_sha256'] == digest(EVIDENCE / 'maven-verify.log'), 'Build evidence changed')
    require(record['test_reports_sha256'] == test_reports(), 'Test evidence changed')
    require(record['java_major'] == 25 and 'Apache Maven 3.9.11' in record['maven_version'], 'Unexpected build tooling')
    return record

def test_reports():
    reports = sorted((ROOT / 'apps/api/target/surefire-reports').glob('TEST-*.xml'))
    require(reports, 'No backend test reports; skipped verification is not provenance')
    executed = set()
    for path in reports:
        suite = ET.parse(path).getroot()
        require(int(suite.get('tests', '0')) > 0 and all(int(suite.get(k, '0')) == 0
                for k in ('failures','errors','skipped')), 'Incomplete or unsuccessful test suite: ' + path.name)
        executed.add(suite.get('name'))
    # The unchanged baseline uses Maven default *Test discovery, with no disabled tests.
    for path in (ROOT / 'apps/api/src/test/java').rglob('*Test.java'):
        name = '.'.join(path.relative_to(ROOT / 'apps/api/src/test/java').with_suffix('').parts)
        require(name in executed, 'Missing backend test suite: ' + name)
    return {p.name: digest(p) for p in reports}

def build(state):
    require(not git('status', '--porcelain'), 'Commit reviewed packaging before building; source SHA must identify the complete source')
    for name in ('MAVEN_ARGS','MAVEN_OPTS','JAVA_TOOL_OPTIONS','JDK_JAVA_OPTIONS'):
        require(not os.environ.get(name), 'Clear build-injection environment variable: ' + name)
    space = os.statvfs(ROOT)
    require(space.f_bavail * space.f_frsize >= 4 * 1024**3 and space.f_favail >= 50000,
            'Insufficient build headroom (minimum 4 GiB and 50,000 inodes); separately check container storage')
    java = run(['java', '-XshowSettings:properties', '-version'])
    require(re.search(r'java.specification.version\s*=\s*25\s', java), 'An approved Java 25 JDK is required')
    maven = run(['./mvnw', '-version'], ROOT / 'apps/api')
    require('Apache Maven 3.9.11' in maven, 'Pinned Maven wrapper version required')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    # Invalidate any prior successful provenance BEFORE starting a new build.
    (EVIDENCE / 'jar-provenance.json').unlink(missing_ok=True)
    command = ['./mvnw', '-B', 'clean', 'verify']
    with (EVIDENCE / 'maven-verify.log').open('w') as log:
        result = subprocess.run(command, cwd=ROOT / 'apps/api', stdout=log, stderr=subprocess.STDOUT)
    require(result.returncode == 0, 'Maven verification failed; see .local/stg-1a/maven-verify.log')
    require(source_state() == state, 'Source changed during build')
    record = {'source': state, 'build_command': command, 'build_exit_code': result.returncode,
              'java_major': 25, 'java_version': java, 'maven_version': maven,
              'jar_path': JAR_PATH, 'jar_sha256': inspect_jar(ROOT / JAR_PATH),
              'build_log_sha256': digest(EVIDENCE / 'maven-verify.log'),
              'test_reports_sha256': test_reports(),
              'built_at': datetime.now(timezone.utc).isoformat()}
    (EVIDENCE / 'jar-provenance.json').write_text(json.dumps(record, indent=2) + '\n')
    print('PASSED: full Maven verification and executable JAR provenance recorded')

def context(state):
    record = verify_build_record(state)
    print('PASSED: exact JAR and source/build provenance; API-only context')
    print('Run only after container-build authorization (command is NOT executed):')
    print(shlex.join(['docker','build','--platform=linux/amd64','--build-arg',
                      'SOURCE_REVISION=' + state['source_revision'],'--build-arg',
                      'JAR_SHA256=' + record['jar_sha256'],'--tag','source-os-api:stg-1a','apps/api']))

def image(state, reference):
    record = verify_build_record(state)
    info = json.loads(run(['docker','image','inspect',reference]))[0]
    image_id = info['Id']
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', image_id), 'Invalid image ID')
    require(info['Architecture'] == 'amd64' and info['Os'] == 'linux', 'Wrong platform')
    cfg = info['Config']
    require(cfg['User'] == '10001:10001' and cfg['Entrypoint'] == ['java','-jar','/app/source-os-api.jar']
            and not cfg.get('Cmd'), 'Wrong runtime user or entrypoint')
    labels = cfg['Labels']
    require(labels['org.opencontainers.image.revision'] == state['source_revision'] and
            labels['com.sourceos.jar.sha256'] == record['jar_sha256'], 'Image provenance labels differ')
    # Pin subsequent inspections to image ID; never trust a mutable tag across commands.
    def probe(entry, *args):
        return run(['docker','run','--rm','--network=none','--read-only','--cap-drop=ALL',
                    '--security-opt=no-new-privileges','--entrypoint',entry,image_id,*args])
    require(probe('sha256sum','/app/source-os-api.jar').split()[0] == record['jar_sha256'], 'Packaged JAR mismatch')
    require(probe('id','-u') == '10001', 'Actual process is not the expected non-root user')
    java = probe('java','-XshowSettings:properties','-version')
    require(re.search(r'java.specification.version\s*=\s*25\s', java), 'Image is not Java 25')
    result = {'source_revision': state['source_revision'], 'jar_sha256': record['jar_sha256'],
              'image_id': image_id, 'repo_digests': info.get('RepoDigests', []),
              'base_image': BASE_IMAGE, 'java_version': java,
              'checked_at': datetime.now(timezone.utc).isoformat(),
              'runtime_acceptance': 'PENDING: application/DB/auth/readiness/port/SIGTERM/regressions'}
    (EVIDENCE / 'image-provenance.json').write_text(json.dumps(result, indent=2) + '\n')
    print('PASSED: image identity, JAR hash, Java 25 and non-root probe; provenance recorded')
    print('NOT VERIFIED: full runtime acceptance; local image ID is not a published manifest digest')

def main():
    parser = argparse.ArgumentParser(description='STG-1A static lint and explicitly gated provenance checks')
    parser.add_argument('mode', choices=['static','build','context','image'], nargs='?', default='static')
    parser.add_argument('--authorized-execution', action='store_true',
                        help='Assert separately obtained authority for this build/container workload')
    parser.add_argument('--image', help='Existing local image for explicitly authorized image probes')
    args = parser.parse_args()
    if args.mode in {'build','image'}:
        require(args.authorized_execution, 'NOT EXECUTED — AUTHORIZATION BLOCKED: explicit workload authority required')
    if args.mode == 'image':
        require(args.image, '--image is required')
    state = static_checks()
    if args.mode == 'build':
        build(state)
    elif args.mode == 'context':
        context(state)
    elif args.mode == 'image':
        image(state, args.image)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        # Subprocess output can contain configuration; keep it out of this error message.
        if isinstance(error, subprocess.CalledProcessError):
            print('FAILED: external command exited with status ' + str(error.returncode), file=sys.stderr)
        else:
            print(str(error), file=sys.stderr)
        sys.exit(1)
PY
