"""Trusted STG-1A execution controller. Only main() connects to GitHub or launches commands."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import jwt

REPO = "Croco-JY/codex"
REPO_ID, OWNER_ID = 1408524936, 172395329
ENVIRONMENT = "stg-1a-runtime"
REF = "refs/heads/main"
WORKFLOW = ".github/workflows/stg-1a-runtime.yml"
CANDIDATE = "230faf61e68d468d26db04b8e7130125e443b280"
BRANCH = "stg-1a-java25-runtime"
ISSUER = "https://token.actions.githubusercontent.com"
AUDIENCE = "https://github.com/Croco-JY/codex/stg-1a-runtime"
JWKS = ISSUER + "/.well-known/jwks"
BASE = ("eclipse-temurin:25-jre-noble@sha256:"
        "334f294a3edd3fc7c2a7b12ed0f4b3f43c2e9bd39de2867996b4ae6a652721bf")
PG = ("postgres:18.3@sha256:"
      "7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db")
JAR = "target/source-os-api-0.0.1-SNAPSHOT.jar"
MAVEN = ("./mvnw", "-B", "clean", "verify")
SOCKET = Path("/run/stg-1a/docker.sock")
PROFILE = Path("/etc/stg-1a/profile.json")
DOCKER_POLICY = Path("/etc/stg-1a/docker-policy.json")
SYSTEM_CA = Path("/etc/ssl/certs/ca-certificates.crt")
USER = "stg1a-workload"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
SHA = re.compile(r"[0-9a-f]{40}")
PORT = "18080"
STAGES = ("source", "capacity", "docker_policy", "maven", "image", "postgres",
          "readiness", "configuration", "shutdown", "cleanup")


class Blocked(Exception):
    pass


def require(ok, message):
    if not ok:
        raise Blocked(message)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def utc(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class GitHub:
    def __init__(self, token):
        require(bool(token), "GitHub review API credential missing")
        self.token = token
        admin_file(SYSTEM_CA, "System CA bundle")
        # Explicit cafile ignores caller-controlled SSL_CERT_FILE and SSL_CERT_DIR.
        tls = ssl.create_default_context(cafile=str(SYSTEM_CA))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                                  urllib.request.HTTPSHandler(context=tls))

    def read(self, url, token=None):
        headers = {"Accept": "application/json", "User-Agent": "Source-OS-STG1A"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(url, headers=headers)
        try:
            with self.opener.open(request, timeout=15) as response:
                data = response.read(2 * 1024 * 1024 + 1)
                require(len(data) <= 2 * 1024 * 1024, "GitHub response exceeded size limit")
                return json.loads(data)
        except (urllib.error.URLError, ValueError, OSError) as exc:
            status = getattr(exc, "code", None)
            raise Blocked(f"GitHub evidence unavailable ({status or 'network or data error'})") from None

    def api(self, path):
        return self.read("https://api.github.com/repos/" + REPO + path, self.token)

    def request_token(self, url, request_token):
        parts = urllib.parse.urlsplit(url)
        require(parts.scheme == "https" and parts.netloc == "pipelines.actions.githubusercontent.com"
                and parts.path.startswith("/") and not parts.fragment and request_token,
                "GitHub OIDC request endpoint or credential rejected")
        query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        require(all(key != "audience" for key, _ in query), "OIDC request already sets an audience")
        query.append(("audience", AUDIENCE))
        return self.read(parts._replace(query=urllib.parse.urlencode(query)).geturl(),
                         request_token)["value"]


def verified_claims(token, read, now):
    try:
        require(isinstance(token, str) and len(token) <= 16000, "Malformed OIDC token")
        meta = read(ISSUER + "/.well-known/openid-configuration")
        require(meta["issuer"] == ISSUER and meta["jwks_uri"] == JWKS
                and "RS256" in meta["id_token_signing_alg_values_supported"],
                "Unexpected GitHub OIDC metadata")
        header = jwt.get_unverified_header(token)
        require(header.get("alg") == "RS256" and isinstance(header.get("kid"), str),
                "Unapproved OIDC algorithm or missing key ID")
        keys = [key for key in read(JWKS)["keys"]
                if key.get("kid") == header["kid"] and key.get("kty") == "RSA"
                and key.get("use", "sig") == "sig" and key.get("alg", "RS256") == "RS256"]
        require(len(keys) == 1, "Missing or ambiguous GitHub signing key")
        key = jwt.PyJWK.from_dict(keys[0], algorithm="RS256").key
        require(key.key_size >= 2048, "GitHub signing key is too small")
        claims = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER, audience=AUDIENCE,
                            options={"require": ["exp", "nbf", "iat", "iss", "aud"],
                                     "strict_aud": True, "verify_exp": False,
                                     "verify_iat": False, "verify_nbf": False})
        iat, nbf, exp = (claims[name] for name in ("iat", "nbf", "exp"))
        require(all(type(value) is int for value in (iat, nbf, exp))
                and iat <= now + 30 and nbf <= now + 30 and now < exp + 30
                and iat <= exp and nbf <= exp and 0 < exp - iat <= 600
                and now - iat <= 630, "Invalid OIDC validity window")
        return claims
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise Blocked("GitHub OIDC token or signing evidence could not be verified") from None


@dataclass(frozen=True)
class Authorization:
    run_id: str
    workflow_sha: str
    environment_id: int
    reviewer_id: int
    actor_id: int
    policy: dict
    job_id: int = 0
    runner_id: int = 0
    runner_name: str = ""


def authorize(claims, api, workflow_sha, run_id, now):
    required = {"repository_id": str(REPO_ID), "repository_owner_id": str(OWNER_ID),
                "event_name": "workflow_dispatch", "ref": REF, "environment": ENVIRONMENT,
                "runner_environment": "github-hosted", "workflow_ref": f"{REPO}/{WORKFLOW}@{REF}",
                "workflow_sha": workflow_sha, "sha": workflow_sha,
                "run_id": run_id, "run_attempt": "1"}
    require(SHA.fullmatch(workflow_sha) and re.fullmatch(r"[1-9][0-9]{0,19}", run_id)
            and all(claims.get(k) == v for k, v in required.items()),
            "GitHub OIDC claims do not match this exact run and workflow")
    run_path = "/actions/runs/" + run_id
    run = api(run_path)
    attempt = api(run_path + "/attempts/1")
    for record in (run, attempt):
        require(record["id"] == int(run_id) and record["run_attempt"] == 1
                and record["head_branch"] == "main" and record["head_sha"] == workflow_sha
                and record["event"] == "workflow_dispatch" and record["path"] == WORKFLOW
                and record["repository"]["id"] == REPO_ID
                and record["status"] == "in_progress",
                "GitHub API run or first-attempt identity mismatch")
    actor = run["actor"]["id"]
    require(run["triggering_actor"]["id"] == actor and claims.get("actor_id") == str(actor)
            and actor == attempt["actor"]["id"] == attempt["triggering_actor"]["id"]
            and -30 <= now - utc(run["created_at"]) <= 86400,
            "Unexpected dispatcher or stale run")
    path = "/environments/" + ENVIRONMENT
    environment = api(path)
    saved = api(path + "/variables/STG1A_RUNTIME_POLICY")
    require(saved["name"] == "STG1A_RUNTIME_POLICY"
            and utc(saved["updated_at"]) <= utc(run["created_at"]),
            "GitHub runtime policy is missing or changed after dispatch")
    policy = json.loads(saved["value"])
    require(environment["name"] == ENVIRONMENT and environment["id"] == policy["environment_id"]
            and utc(environment["updated_at"]) <= utc(run["created_at"])
            and environment["deployment_branch_policy"] == {
                "protected_branches": False, "custom_branch_policies": True},
            "GitHub Environment identity or branch protection mismatch")
    # REST does not document the admin bypass toggle. A genuine, approved
    # decision by a non-admin reviewer is required independently below.
    require(environment.get("can_admins_bypass", False) is False
            and policy["admin_bypass_disabled"] is True, "Admin bypass policy rejected")
    branches = api(path + "/deployment-branch-policies")
    require(branches["total_count"] == 1 and len(branches["branch_policies"]) == 1
            and branches["branch_policies"][0]["name"] == "main"
            and branches["branch_policies"][0]["type"] == "branch",
            "GitHub Environment must admit only the main branch")
    rules = environment["protection_rules"]
    require(len(rules) == 1 and rules[0]["type"] == "required_reviewers"
            and rules[0]["prevent_self_review"] is True, "GitHub Environment reviewer policy is incomplete")
    reviewers = rules[0]["reviewers"]
    require(reviewers and all(r["type"] == "User" for r in reviewers)
            and sorted(r["reviewer"]["id"] for r in reviewers) == sorted(policy["reviewer_ids"]),
            "GitHub Environment reviewers differ from approved policy")
    require(policy["workflow_sha"] == workflow_sha and policy["candidate_sha"] == CANDIDATE
            and policy["runner_label"] == "ubuntu-24.04" and policy["ryuk_enabled"] is True
            and policy["ryuk_privileged"] is False and policy["socket"] == str(SOCKET)
            and policy["cleanup"] == "ryuk-and-owned-inventory",
            "Workflow, candidate, runner or Docker workload is outside approved policy")
    remote = api("/git/ref/heads/" + BRANCH)
    require(remote["ref"] == "refs/heads/" + BRANCH and remote["object"]["type"] == "commit"
            and remote["object"]["sha"] == CANDIDATE, "Remote candidate ref does not match approved SHA")
    jobs = api(run_path + "/attempts/1/jobs")
    require(jobs["total_count"] == 1 and len(jobs["jobs"]) == 1, "Unexpected jobs in approved attempt")
    job = jobs["jobs"][0]
    require(job["name"] == "verify" and job["head_sha"] == workflow_sha
            and job["run_attempt"] == 1 and job["run_id"] == int(run_id) and job["status"] == "in_progress"
            and job["labels"] == ["ubuntu-24.04"]
            and type(job["id"]) is int and job["id"] > 0
            and type(job["runner_id"]) is int and job["runner_id"] > 0
            and re.fullmatch(r"GitHub Actions [0-9]+", job["runner_name"]),
            "Runner assignment is not the approved verification job")
    history = api(run_path + "/approvals")
    decisions = [row for row in history
                 if any(entry["id"] == environment["id"] for entry in row["environments"])]
    require(len(decisions) == 1 and decisions[0]["state"] == "approved",
            "A unique approved Environment decision for this first attempt is required")
    reviewer = decisions[0]["user"]
    require(reviewer["id"] in policy["reviewer_ids"] and reviewer["id"] not in (actor, OWNER_ID)
            and re.fullmatch(r"[A-Za-z0-9-]{1,39}", reviewer["login"]),
            "Independent reviewer approval is required")
    permission = api("/collaborators/" + reviewer["login"] + "/permission")
    require(permission["user"]["id"] == reviewer["id"]
            and permission["permission"] in ("read", "triage", "write"),
            "Reviewer eligibility or administrator bypass cannot be ruled out")
    return Authorization(run_id, workflow_sha, environment["id"], reviewer["id"], actor, policy,
                         job["id"], job["runner_id"], job["runner_name"])


def capacity(paths, budgets, reserve, measure=os.statvfs):
    require(set(paths) == set(budgets) and set(reserve) == {"bytes", "inodes"}
            and all(type(v) is int and v > 0 for v in reserve.values()),
            "Qualified mount budget is missing")
    mounts = {}
    for name, path in paths.items():
        budget = budgets[name]
        require(set(budget) == {"bytes", "inodes"} and all(type(v) is int and v > 0 for v in budget.values()),
                "Storage qualification must include bytes and inodes")
        fs = measure(path)
        key = path.stat().st_dev
        row = mounts.setdefault(key, {"paths": [], "required_bytes": reserve["bytes"],
                                     "required_inodes": reserve["inodes"],
                                     "free_bytes": fs.f_bavail * fs.f_frsize, "free_inodes": fs.f_favail})
        row["paths"].append(name)
        row["free_bytes"] = min(row["free_bytes"], fs.f_bavail * fs.f_frsize)
        row["free_inodes"] = min(row["free_inodes"], fs.f_favail)
        row["required_bytes"] += budget["bytes"]
        row["required_inodes"] += budget["inodes"]
    return list(mounts.values())


def check_capacity(rows):
    require(all(r["free_bytes"] >= r["required_bytes"] and r["free_inodes"] >= r["required_inodes"]
                for r in rows), "Insufficient free bytes or inodes on a workload filesystem")


class StorageMonitor:
    """Measure concurrent low-water marks by device while the workload runs."""

    def __init__(self, paths, reserve, measure=os.statvfs):
        import threading
        self.paths, self.reserve, self.measure = paths, reserve, measure
        self.done = threading.Event()
        self.worker = threading.Thread(target=self.watch, daemon=True)
        self.rows = {}
        self.failed = False

    def sample(self):
        for name, path in self.paths.items():
            fs = self.measure(path)
            device = path.stat().st_dev
            available = {"bytes": fs.f_bavail * fs.f_frsize, "inodes": fs.f_favail}
            row = self.rows.setdefault(device, {"paths": set(), "initial": available.copy(),
                                                "low_water": available.copy()})
            row["paths"].add(name)
            for key in available:
                row["low_water"][key] = min(row["low_water"][key], available[key])
                self.failed |= available[key] < self.reserve[key]

    def watch(self):
        try:
            while not self.done.wait(1):
                self.sample()
        except (OSError, ValueError):
            self.failed = True

    def start(self):
        self.sample()
        self.worker.start()

    def finish(self):
        self.done.set()
        self.worker.join(10)
        require(not self.worker.is_alive(), "Storage monitoring did not finish")
        self.sample()
        return [{"paths": sorted(row["paths"]), "initial": row["initial"],
                 "low_water": row["low_water"],
                 "peak_growth": {key: max(0, row["initial"][key] - row["low_water"][key])
                                 for key in row["initial"]}}
                for row in self.rows.values()]


def admin_file(path, label):
    require(path.is_file() and not path.is_symlink(), label + " unavailable")
    for component in (path, *path.parents):
        info = component.stat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, label + " must be controlled by the runner")


def load_profile(policy, path=PROFILE, docker_policy=DOCKER_POLICY):
    admin_file(path, "Qualified Docker runner profile")
    require(sha256(path) == policy["profile_sha256"], "Runner profile identity is outside approved policy")
    profile = json.loads(path.read_bytes())
    require(profile["schema"] == 1 and profile["workload_user"] == USER
            and profile["socket"] == str(SOCKET)
            and re.fullmatch(r"[A-Za-z0-9_.-]+", profile["docker_authorizer"]),
            "Qualified execution profile is incomplete")
    admin_file(docker_policy, "Docker authorization policy")
    require(sha256(docker_policy) == profile["docker_policy_sha256"],
            "Docker authorization policy differs from qualified profile")
    return profile


def clean_env(home, java):
    return {"HOME": str(home), "PATH": str(java / "bin") + ":/usr/bin:/bin",
            "JAVA_HOME": str(java), "MAVEN_USER_HOME": str(home / ".m2"),
            "JAVA_TOOL_OPTIONS": "-Duser.home=" + str(home),
            "LANG": "C.UTF-8", "TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED": "false",
            "DOCKER_HOST": "unix://" + str(SOCKET),
            "TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE": str(SOCKET)}


def execute(args, cwd, env, limit):
    with tempfile.TemporaryFile() as output:
        proc = subprocess.Popen(args, cwd=cwd, env=env, stdout=output,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            proc.wait(timeout=limit)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=15)
            raise Blocked("A workload command exceeded its time limit") from None
        size = output.tell()
        output.seek(max(0, size - 1024 * 1024))
        return proc.returncode, output.read().decode("utf-8", errors="replace")


class Commands:
    DOCKER = frozenset({"info", "ps", "events", "inspect", "pull", "buildx", "image",
                        "network", "volume", "create", "cp", "start", "exec", "logs", "kill", "wait", "rm"})

    def __init__(self, authorization, home, java, root, executor=execute):
        self.auth, self.env, self.root = authorization, clean_env(home, java), root
        self.executor = executor

    def call(self, args, cwd=None, limit=60, allow_failure=False):
        require(isinstance(self.auth, Authorization), "Unapproved workload command")
        code, output = self.executor(["/usr/bin/sudo", "-n", "-u", USER, "--",
                                      "/usr/bin/env", "-i",
                                      *(f"{k}={v}" for k, v in self.env.items()), *args],
                                     cwd or self.root, {"PATH": "/usr/bin:/bin"}, limit)
        require(allow_failure or code == 0, f"Workload command failed at {Path(args[0]).name} (exit {code})")
        return code, output.strip()

    def maven(self, args, limit=3600):
        require(tuple(args) in (("./mvnw", "-version"), MAVEN), "Unapproved Maven operation")
        return self.call(args, self.root / "apps/api", limit)[1]

    def docker(self, *args, limit=60, allow_failure=False):
        require(args and args[0] in self.DOCKER and "prune" not in args
                and not any(a == "--privileged" or a.startswith(("--privileged=", "--network=host",
                                                                  "--net=host", "--mount", "--volume="))
                            or a.startswith(("--volumes-from", "--device", "--cap-add", "--pid=host",
                                                "--ipc=host", "--driver=host", "--network=container:",
                                                "--net=container:"))
                            or a in ("-v", "--volume", "--network", "--net", "--pid", "--ipc", "--driver")
                            or (a == "--volumes" and args[0] != "rm") for a in args)
                and not (args[0] == "image" and args[1:2] not in (("inspect",), ("load",), ("rm",)))
                and not (args[0] == "network" and args[1:2] not in (
                    ("create",), ("inspect",), ("disconnect",), ("rm",), ("ls",)))
                and not (args[0] == "volume" and args[1:2] != ("ls",))
                and not (args[0] == "buildx" and args[1:2] != ("build",)),
                "Prohibited Docker operation")
        return self.call(("/usr/bin/docker", *args), limit=limit, allow_failure=allow_failure)


def validate_checkout(root, git):
    require(git("rev-parse", "HEAD") == CANDIDATE
            and git("rev-parse", "--abbrev-ref", "HEAD") == "HEAD"
            and git("status", "--porcelain", "--untracked-files=all") == "",
            "Candidate must be the exact clean detached checkout")
    require(git("remote", "get-url", "origin").removesuffix(".git") == "https://github.com/" + REPO,
            "Unexpected candidate origin")


def source_bytes(root, listing):
    recorded = {}
    for row in listing.split("\0"):
        if not row:
            continue
        metadata, filename = row.split("\t", 1)
        mode, kind, oid = metadata.split()
        path = root / filename
        require(kind == "blob" and mode in ("100644", "100755")
                and path.is_file() and not path.is_symlink()
                and path.resolve().is_relative_to(root)
                and bool(path.stat().st_mode & stat.S_IXUSR) == (mode == "100755"),
                "Unexpected candidate file type or mode")
        content = path.read_bytes()
        # The accepted tree's only explicit CRLF checkout file is the Windows wrapper.
        canonical = content.replace(b"\r\n", b"\n") if filename == "apps/api/mvnw.cmd" else content
        obj = hashlib.sha1(f"blob {len(canonical)}\0".encode() + canonical, usedforsecurity=False)
        require(obj.hexdigest() == oid, "Candidate tracked bytes differ from the accepted object")
        recorded[filename] = hashlib.sha256(content).hexdigest()
    require(recorded, "Empty candidate tree")
    return recorded


def write_evidence(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")


def finish_evidence(directory, evidence, success):
    complete = set(evidence["stages"]) == set(STAGES) and all(
        isinstance(result, dict) and result.get("passed") is True
        for result in evidence["stages"].values())
    if success:
        require(complete and not evidence["blockers"], "Incomplete verification cannot pass")
        stages = evidence["stages"]
        maven, image = stages["maven"], stages["image"]
        require(evidence.get("candidate_sha") == CANDIDATE and evidence.get("attempt") == 1
                and SHA.fullmatch(evidence.get("controller_sha", ""))
                and all(evidence.get(field) for field in ("reviewer_id", "environment_id", "run_id", "approval_ref"))
                and set(evidence.get("capacity_samples", {})) == {"start", "export"}
                and bool(evidence.get("capacity_peak"))
                and maven.get("suites", 0) > 0 and maven.get("tests", 0) > 0
                and all(maven.get(key) == 0 for key in ("failures", "errors", "skipped"))
                and maven.get("ryuk_privileged") is False and maven.get("ryuk_cleanup_verified") is True
                and re.fullmatch(r"[0-9a-f]{64}", maven.get("sha256", ""))
                and image.get("packaged_jar_sha256") == maven["sha256"]
                and all(DIGEST.fullmatch(image.get(key, "")) for key in ("oci_manifest", "runtime_id"))
                and (image.get("uid"), image.get("gid")) == (10001, 10001)
                and stages["postgres"].get("migrations") == 23
                and stages["readiness"].get("healthy") == 200
                and stages["readiness"].get("database_disconnected") == 503
                and stages["readiness"].get("liveness_after_disconnect") == 200
                and stages["configuration"].get("cases") == ["db", "issuer", "audience", "cors"]
                and stages["configuration"].get("unauthenticated") == 401
                and stages["configuration"].get("development_header") == 401
                and stages["configuration"].get("local_profile") is False
                and stages["shutdown"].get("exit_code") in (0, 143)
                and stages["shutdown"].get("oom") is False
                and stages["cleanup"].get("verified_owned_resources", 0) > 0,
                "Required runtime evidence is incomplete or inconsistent")
    evidence["verdict"] = "RUNTIME VERIFIED" if success else "RUNTIME VERIFICATION BLOCKED"
    evidence["skips"] = [name for name in STAGES if name not in evidence["stages"]]
    result = directory / "result.json"
    write_evidence(result, evidence)
    write_evidence(directory / "sha256.json", {"result.json": sha256(result)})
    verify_evidence(directory)


def verify_evidence(directory):
    manifest = json.loads((directory / "sha256.json").read_bytes())
    require(set(manifest) == {"result.json"} and manifest["result.json"] == sha256(directory / "result.json"),
            "Evidence hash mismatch")


def jar_provenance(root, java, maven):
    import zipfile
    api = root / "apps/api"
    expected = {".".join(p.relative_to(api / "src/test/java").with_suffix("").parts)
                for p in (api / "src/test/java").rglob("*Test.java")}
    reports = list((api / "target/surefire-reports").glob("TEST-*.xml"))
    totals = dict.fromkeys(("tests", "failures", "errors", "skipped"), 0)
    observed = set()
    for path in reports:
        suite = ET.parse(path).getroot()
        name = suite.attrib["name"]
        require(name not in observed and int(suite.attrib["tests"]) > 0, "Invalid Surefire suite")
        observed.add(name)
        for key in totals:
            count = int(suite.attrib[key])
            require(count > 0 if key == "tests" else count == 0, "Non-passing Surefire suite")
            totals[key] += count
    require(expected and expected <= observed and all(totals[k] == 0 for k in ("failures", "errors", "skipped"))
            and "com.sourceos.PatternReleaseExpiryTest" in observed, "Incomplete backend or real-expiry regression")
    artifact = api / JAR
    require(artifact.is_file() and not artifact.is_symlink(), "Executable JAR is absent")
    with zipfile.ZipFile(artifact) as archive:
        manifest = archive.read("META-INF/MANIFEST.MF").decode().replace("\r\n", "\n")
        require(archive.testzip() is None
                and "Main-Class: org.springframework.boot.loader.launch.JarLauncher\n" in manifest
                and "Start-Class: com.sourceos.SourceOsApplication\n" in manifest
                and any(name.startswith("BOOT-INF/lib/") for name in archive.namelist())
                and archive.read("BOOT-INF/classes/com/sourceos/SourceOsApplication.class")[:8]
                == bytes.fromhex("cafebabe00000045"), "Unexpected executable JAR")
    return {"passed": True, "sha256": sha256(artifact), "java_version": java,
            "maven_version": maven, "suites": len(observed), **totals}


def oci_identity(path):
    import tarfile
    with tarfile.open(path) as archive:
        def read(name):
            member = archive.getmember(name)
            require(member.isfile() and member.size <= 4 * 1024 * 1024, "Invalid OCI metadata")
            return archive.extractfile(member).read()
        def blob(digest):
            require(DIGEST.fullmatch(digest), "Invalid OCI digest")
            raw = read("blobs/sha256/" + digest[7:])
            require("sha256:" + hashlib.sha256(raw).hexdigest() == digest, "OCI digest mismatch")
            return json.loads(raw)
        entries = json.loads(read("index.json"))["manifests"]
        require(len(entries) == 1, "OCI export must have exactly one manifest")
        digest = entries[0]["digest"]
        config = blob(digest)["config"]["digest"]
        metadata = blob(config)
        require(metadata["architecture"] == "amd64" and metadata["os"] == "linux",
                "Incorrect OCI platform")
        return digest, config


class Inventory:
    def __init__(self, commands, label):
        self.commands, self.label = commands, label
        self.resources = []

    def add(self, kind, identity):
        require(kind in ("container", "network", "image"), "Unexpected Docker resource kind")
        require(re.fullmatch(r"[0-9a-f]{64}", identity), "Docker did not return an immutable resource ID")
        self.resources.append((kind, identity))
        return identity

    def cleanup(self):
        for kind, identity in reversed(self.resources):
            result, text = self.commands.docker("inspect", "--type=" + kind, identity, allow_failure=True)
            if result:
                require("no such" in text.lower(), "Could not resolve resource ownership")
                continue
            row, = json.loads(text)
            labels = row["Config"]["Labels"] if kind == "container" else (
                row["Labels"] if kind == "network" else row["Config"]["Labels"])
            require(labels.get("com.sourceos.stg1a.run") == self.label
                    and row.get("Id", row.get("ID", "")).removeprefix("sha256:") == identity,
                    "Cleanup refused an unowned or substituted resource")
            if kind == "container":
                self.commands.docker("rm", "-f", "--volumes", identity)
            else:
                self.commands.docker(kind, "rm", identity)
            code, output = self.commands.docker("inspect", "--type=" + kind, identity, allow_failure=True)
            require(code != 0 and "no such" in output.lower(), "Cleanup could not verify resource removal")
        return {"passed": True, "verified_owned_resources": len(self.resources)}


def validate_ryuk(details):
    host = details["HostConfig"]
    bind = str(SOCKET) + ":/var/run/docker.sock"
    require(host["Privileged"] is False and host["NetworkMode"] != "host"
            and host["Binds"] in ([bind], [bind + ":rw"])
            and not host.get("Mounts") and not host.get("CapAdd") and not host.get("Devices"),
            "Ryuk did not use the approved Docker policy")
    return details["State"]["Running"] is True


def monitor_maven(commands):
    import threading

    done = threading.Event()
    observed = {}
    errors = []

    def inspect_ryuk():
        while not done.is_set():
            try:
                _, names = commands.docker("ps", "-aq", "--no-trunc",
                                           "--filter=label=org.testcontainers=true", limit=10)
                for identity in names.splitlines():
                    if identity in observed:
                        continue
                    require(re.fullmatch(r"[0-9a-f]{64}", identity), "Unexpected Testcontainers identity")
                    code, data = commands.docker("inspect", "--type=container", identity,
                                                 limit=10, allow_failure=True)
                    if code:
                        continue
                    row, = json.loads(data)
                    if row["Name"].startswith("/testcontainers-ryuk-"):
                        observed[identity] = validate_ryuk(row)
            except (Blocked, ValueError, KeyError, TypeError, OSError) as error:
                errors.append(error)
                return
            done.wait(0.4)

    observer = threading.Thread(target=inspect_ryuk, daemon=True)
    observer.start()
    try:
        commands.maven(MAVEN)
    finally:
        done.set()
        observer.join(20)
    require(not observer.is_alive() and not errors and len(observed) == 1 and all(observed.values()),
            "Non-privileged Ryuk was not verified during Maven")
    until = time.monotonic() + 30
    for _ in range(31):
        _, containers = commands.docker("ps", "-aq", "--filter=label=org.testcontainers=true", limit=10)
        _, networks = commands.docker("network", "ls", "-q", "--filter=label=org.testcontainers=true", limit=10)
        _, volumes = commands.docker("volume", "ls", "-q", "--filter=label=org.testcontainers=true", limit=10)
        if not (containers or networks or volumes):
            return
        if time.monotonic() >= until:
            break
        time.sleep(1)
    raise Blocked("Ryuk cleanup left Testcontainers resources")


# Runs only in the reviewed, digest-pinned Python fixture.
OIDC_FIXTURE = """import json
import ssl
from http.server import BaseHTTPRequestHandler, HTTPServer

issuer = 'https://oidc:8443'
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/.well-known/openid-configuration':
            data = dict(issuer=issuer, jwks_uri=issuer+'/jwks',
                        authorization_endpoint=issuer+'/authorize',
                        token_endpoint=issuer+'/token', response_types_supported=['code'],
                        subject_types_supported=['public'], id_token_signing_alg_values_supported=['RS256'])
        elif self.path == '/jwks':
            data = json.load(open("/tmp/stg-jwks.json"))
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

server = HTTPServer(('0.0.0.0', 8443), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('/tmp/stg-cert.pem', '/tmp/stg-key.pem')
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
"""


def poll(check, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.5)
    raise Blocked("A runtime assertion timed out")


def runtime_fixtures(commands, inventory, image_id, fixture, directory, java, stages):
    import secrets

    label = "com.sourceos.stg1a.run=" + inventory.label
    net = inventory.add("network", commands.docker("network", "create", "--internal",
                                                   "--label", label, "stg1a-" + inventory.label)[1])

    def create(image, *args, entry=(), envfile=None):
        flags = ["--label", label, "--network=" + net, "--cap-drop=ALL",
                 "--security-opt=no-new-privileges"]
        if envfile is not None:
            flags += ["--env-file", str(envfile)]
        return inventory.add("container", commands.docker("create", *flags, *args, image, *entry)[1])

    def env_file(name, values):
        path = directory / name
        path.touch(mode=0o600)
        path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
        code, _ = execute(("/usr/bin/sudo", "-n", "--", "/usr/bin/chown", "--",
                           str(pwd.getpwnam(USER).pw_uid), str(path)),
                          directory, {"PATH": "/usr/bin:/bin"}, 15)
        require(code == 0, "Synthetic fixture file could not be isolated")
        return path

    password = secrets.token_hex(24)
    db_env = env_file("pg.env", {"POSTGRES_DB": "source_os", "POSTGRES_USER": "source_os",
                                 "POSTGRES_PASSWORD": password, "PGDATA": "/tmp/stg-pgdata"})
    # The fixture starts as the image's postgres UID, so no root entrypoint capabilities are needed.
    db = create(PG, "--network-alias", "pg", "--user", "postgres", envfile=db_env)
    commands.docker("start", db)
    poll(lambda: commands.docker("exec", db, "pg_isready", "-h", "127.0.0.1", "-U",
                                 "source_os", "-d", "source_os", limit=5, allow_failure=True)[0] == 0, 90)

    generated = directory / "generated"
    cert, key = generated / "stg-cert.pem", generated / "stg-key.pem"
    trust = generated / "stg-trust.p12"
    # Generate synthetic fixture material without sending it to logs or evidence.
    commands.call(("/usr/bin/openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                   "-days", "1", "-subj", "/CN=oidc", "-addext", "subjectAltName=DNS:oidc",
                   "-keyout", str(key), "-out", str(cert)))
    commands.call((str(java / "bin/keytool"), "-importcert", "-noprompt", "-alias", "stg-oidc",
                   "-file", str(cert), "-storetype", "PKCS12", "-keystore", str(trust),
                   "-storepass", "stg-fixture-only"))
    _, modulus = commands.call(("/usr/bin/openssl", "rsa", "-in", str(key), "-noout", "-modulus"))
    require(re.fullmatch(r"Modulus=[a-fA-F0-9]{512}", modulus), "Synthetic OIDC signing key is invalid")
    from base64 import urlsafe_b64encode
    rsa_n = urlsafe_b64encode(bytes.fromhex(modulus.split("=", 1)[1])).rstrip(b"=").decode()
    jwks = directory / "stg-jwks.json"
    write_evidence(jwks, {"keys": [{"kty": "RSA", "kid": "stg1a", "use": "sig",
                                    "alg": "RS256", "n": rsa_n, "e": "AQAB"}]})
    commands.call(("/usr/bin/chmod", "0644", str(trust)))
    program = directory / "fixture.py"
    program.write_text(OIDC_FIXTURE)
    oidc = create(fixture, "--network-alias", "oidc",
                  entry=("python3", "/tmp/fixture.py"))
    for path in (program, cert, key, jwks):
        commands.docker("cp", str(path), oidc + ":/tmp/" + path.name)
    commands.docker("start", oidc)
    poll(lambda: commands.docker("exec", oidc, "python3", "-c",
                                 "import socket; socket.create_connection(('127.0.0.1',8443),2).close()",
                                 allow_failure=True, limit=5)[0] == 0, 30)

    good = {"DB_URL": "jdbc:postgresql://pg:5432/source_os", "DB_USER": "source_os",
            "DB_PASSWORD": password, "OIDC_ISSUER_URI": "https://oidc:8443",
            "OIDC_AUDIENCE": "stg-1a", "SERVER_PORT": PORT,
            "JAVA_TOOL_OPTIONS": "-Djavax.net.ssl.trustStore=/tmp/stg-trust.p12 "
                                 "-Djavax.net.ssl.trustStorePassword=stg-fixture-only",
            "SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE": "15s"}
    def api(name, env):
        identity = create(image_id, "--network-alias=api-" + name, envfile=env_file(name + ".env", env))
        commands.docker("cp", str(trust), identity + ":/tmp/stg-trust.p12")
        commands.docker("start", identity)
        return identity

    # Keep every service inside the bridge. The fixture probes the configured API port.
    probe = """import http.client,json,sys
try:
    conn=http.client.HTTPConnection(sys.argv[1],int(sys.argv[2]),timeout=3)
    conn.request('GET',sys.argv[3],headers=json.loads(sys.argv[4]))
    response=conn.getresponse()
    print(json.dumps([response.status,response.read(16384).decode() if response.status==200 else '']))
except (OSError,http.client.HTTPException):
    print('[0,""]')
"""
    def request(alias, path, headers=None):
        _, payload = commands.docker("exec", oidc, "python3", "-c", probe, alias, PORT,
                                     path, json.dumps(headers or {}), limit=8)
        return json.loads(payload)

    def ready(url):
        code, body = request(url, "/actuator/health/readiness")
        return code == 200 and json.loads(body)["status"] == "UP"

    live = api("positive", good)
    url = "api-positive"
    poll(lambda: ready(url), 180)
    _, ids = commands.docker("exec", live, "sh", "-c",
                              "cat /proc/1/status; tr '\\000' ' ' </proc/1/cmdline")
    require(re.search(r"^Uid:\s+10001\s+10001\s+10001\s+10001$", ids, re.M)
            and re.search(r"^Gid:\s+10001\s+10001\s+10001\s+10001$", ids, re.M)
            and "java -jar /app/source-os-api.jar" in ids, "Java PID 1 identity is incorrect")
    _, migrations = commands.docker("exec", db, "psql", "-U", "source_os", "-d", "source_os", "-Atc",
                                    "SELECT version FROM flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank")
    require(migrations.splitlines() == [str(n) for n in range(1, 24)], "Flyway V1–V23 verification failed")
    stages["postgres"] = {"passed": True, "migrations": 23}
    require(request(url, "/api/organizations")[0] == 401
            and request(url, "/api/organizations", {"X-Dev-Subject": "synthetic"})[0] == 401,
            "Non-local authentication did not reject an unauthenticated request")
    _, healthy_log = commands.docker("logs", live)
    require("No active profile set" in healthy_log, "Default non-local profile startup evidence missing")
    for case, absent, extra, diagnostic in (
        ("db", ("DB_URL", "DB_USER", "DB_PASSWORD"), {}, r"DB_URL|jdbcUrl|Failed to configure a DataSource"),
        ("issuer", ("OIDC_ISSUER_URI",), {}, r"OIDC HTTPS issuer and audience are required"),
        ("audience", ("OIDC_AUDIENCE",), {}, r"OIDC HTTPS issuer and audience are required"),
        ("cors", (), {"CORS_ORIGINS": "*"}, r"Explicit CORS origins required"),
    ):
        env = {k: v for k, v in good.items() if k not in absent} | extra
        failed = api(case, env)
        _, code = commands.docker("wait", failed, limit=90)
        _, log = commands.docker("logs", failed)
        require(code == "1" and re.search(diagnostic, log, re.I)
                and "Started SourceOsApplication" not in log, "Expected configuration failure missing: " + case)
    stages["configuration"] = {"passed": True, "cases": ["db", "issuer", "audience", "cors"],
                               "unauthenticated": 401, "development_header": 401, "local_profile": False}

    commands.docker("kill", "--signal=TERM", live)
    _, code = commands.docker("wait", live, limit=35)
    _, log = commands.docker("logs", live)
    _, status = commands.docker("inspect", "--format={{json .State}}", live)
    state = json.loads(status)
    require(code in ("0", "143") and state["OOMKilled"] is False and state["Running"] is False
            and "Graceful shutdown complete" in log, "SIGTERM did not complete graceful shutdown")
    stages["shutdown"] = {"passed": True, "exit_code": int(code), "oom": False}
    api("database-disconnection", good)
    disconnected_url = "api-database-disconnection"
    poll(lambda: ready(disconnected_url), 180)
    commands.docker("network", "disconnect", net, db)
    poll(lambda: request(disconnected_url, "/actuator/health/readiness")[0] == 503, 90)
    require(request(disconnected_url, "/actuator/health/liveness")[0] == 200,
            "Database disconnect stopped API liveness")
    stages["readiness"] = {"passed": True, "container_port": int(PORT), "healthy": 200,
                           "database_disconnected": 503, "liveness_after_disconnect": 200}


def git_at(root, *args):
    env = {"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}
    code, output = execute(("/usr/bin/git", *args), root, env, 20)
    require(code == 0, "Trusted Git source inspection failed")
    return output.strip()


def verify_profile(commands, profile):
    code, raw = commands.docker("info", "--format={{json .}}")
    info = json.loads(raw)
    require(code == 0 and info["OSType"] == "linux" and info["Architecture"] in ("x86_64", "amd64")
            and info["DockerRootDir"] == profile["docker_root"]
            and info["Plugins"]["Authorization"] == [profile["docker_authorizer"]]
            and info["Driver"] == profile["driver"] and info["Containers"] == 0
            and info["Images"] == 0, "Docker daemon is not the qualified clean enforcement profile")
    return {"passed": True, "driver": info["Driver"], "server_version": info["ServerVersion"],
            "authorizer": profile["docker_authorizer"]}


def verify_image(cmd, inventory, auth, fixture_directory, jar, profile, storage_check):
    base_layers = None
    for image in (BASE, PG, auth.policy["fixture_image"]):
        cmd.docker("pull", "--platform=linux/amd64", image, limit=300)
        _, raw = cmd.docker("image", "inspect", image)
        row, = json.loads(raw)
        digest = image.split("@", 1)[1]
        require(row["Architecture"] == "amd64" and row["Os"] == "linux"
                and any(ref.endswith("@" + digest) for ref in row["RepoDigests"]),
                "Pulled platform or manifest did not match the reviewed pin")
        if image == BASE:
            base_layers = row["RootFS"]["Layers"]
            require(base_layers and all(DIGEST.fullmatch(x) for x in base_layers),
                    "Pinned base layer identities unavailable")
    storage_check()
    archive = fixture_directory / "generated" / "image.oci.tar"
    tag = "source-os-stg1a:" + inventory.label
    cmd.docker("buildx", "build", "--builder=" + profile["builder"], "--platform=linux/amd64",
               "--network=none", "--provenance=false", "--sbom=false",
               "--build-arg", "SOURCE_REVISION=" + CANDIDATE, "--build-arg", "JAR_SHA256=" + jar,
               "--label", "com.sourceos.stg1a.run=" + inventory.label, "--tag", tag,
               "--output=type=oci,dest=" + str(archive), str(cmd.root / "apps/api"), limit=600)
    manifest, image_id = oci_identity(archive)
    cmd.docker("image", "load", "--input=" + str(archive), limit=300)
    _, raw = cmd.docker("image", "inspect", image_id)
    row, = json.loads(raw)
    config = row["Config"]
    require(row["Id"] == image_id and config["Labels"]["com.sourceos.stg1a.run"] == inventory.label,
            "Loaded image is not the verified owned OCI output")
    require(row["RootFS"]["Layers"][:len(base_layers)] == base_layers,
            "Built image does not start with the pinned base layers")
    inventory.add("image", image_id[7:])
    require(config["User"] == "10001:10001"
            and config["Entrypoint"] == ["java", "-jar", "/app/source-os-api.jar"] and not config["Cmd"]
            and config["Labels"]["org.opencontainers.image.revision"] == CANDIDATE
            and config["Labels"]["com.sourceos.jar.sha256"] == jar,
            "Runtime image identity, provenance labels or entrypoint differ")
    probe = inventory.add("container", cmd.docker("create", "--network=none", "--cap-drop=ALL",
                          "--security-opt=no-new-privileges", "--read-only",
                          "--label", "com.sourceos.stg1a.run=" + inventory.label,
                          "--entrypoint=/usr/bin/sha256sum", image_id, "/app/source-os-api.jar")[1])
    _, output = cmd.docker("start", "-a", probe)
    require(output.split() == [jar, "/app/source-os-api.jar"], "Packaged JAR digest differs")
    probe = inventory.add("container", cmd.docker("create", "--network=none", "--cap-drop=ALL",
                          "--security-opt=no-new-privileges", "--read-only",
                          "--label", "com.sourceos.stg1a.run=" + inventory.label,
                          "--entrypoint=/opt/java/openjdk/bin/java", image_id, "-version")[1])
    _, output = cmd.docker("start", "-a", probe)
    require(re.search(r'openjdk version "25(?:\.|")', output), "Image did not run Java 25")
    return {"passed": True, "oci_manifest": manifest, "runtime_id": image_id,
            "base": BASE, "packaged_jar_sha256": jar, "uid": 10001, "gid": 10001,
            "runtime_java": output.splitlines()[0]}


def verified_capacity(evidence, paths, policy, phase):
    rows = capacity(paths, policy["storage"][phase], policy["reserve"])
    evidence["capacity_samples"][phase] = rows
    check_capacity(rows)


def prepare_workspace(source, scratch, account, authorization):
    require(isinstance(authorization, Authorization), "Unapproved workload workspace preparation")
    work = scratch / "candidate"
    shutil.copytree(source, work, symlinks=True)
    home = scratch / "home"
    temp = scratch / "fixtures"
    home.mkdir(mode=0o700)
    temp.mkdir(mode=0o755)
    generated = temp / "generated"
    generated.mkdir(mode=0o755)
    scratch.chmod(0o711)
    for path in (work, home, generated):
        code, _ = execute(("/usr/bin/sudo", "-n", "--", "/usr/bin/chown", "-R", "-h", "--",
                           f"{account.pw_uid}:{account.pw_gid}", str(path)),
                          scratch, {"PATH": "/usr/bin:/bin"}, 90)
        require(code == 0, "Workload UID isolation could not be established")
    return work, home, temp


def main():
    # The workflow supplies paths and transport credentials. Authorization comes from
    # GitHub-signed claims and authenticated server records, never a local flag or file.
    workdir = Path(__file__).resolve().parents[2]
    out = Path(os.environ["RUNNER_TEMP"]) / "stg-1a-evidence"
    out.mkdir(mode=0o700, exist_ok=False)
    evidence = {"candidate_sha": CANDIDATE, "attempt": 1, "stages": {},
                "blockers": [], "capacity_samples": {}}
    inventory = None
    monitor = None
    error = None
    scratch = None
    ryuk_cleanup = False
    try:
        gh = GitHub(os.environ.get("STG1A_REVIEW_TOKEN"))
        token = gh.request_token(os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", ""),
                                 os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN"))
        now = time.time()
        auth = authorize(verified_claims(token, gh.read, now), gh.api, git_at(workdir, "rev-parse", "HEAD"),
                         os.environ.get("GITHUB_RUN_ID", ""), now)
        del token
        gh.token = None
        for key in ("STG1A_REVIEW_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
                    "ACTIONS_RUNTIME_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"):
            os.environ.pop(key, None)
        evidence.update(controller_sha=auth.workflow_sha, run_id=auth.run_id,
                        environment_id=auth.environment_id, reviewer_id=auth.reviewer_id,
                        dispatcher_id=auth.actor_id, approval_ref=f"/actions/runs/{auth.run_id}/approvals",
                        job_id=auth.job_id, runner_id=auth.runner_id, runner_name=auth.runner_name)
        source = workdir.parent / "candidate"
        validate_checkout(source, lambda *args: git_at(source, *args))
        require(git_at(source, "rev-parse", "HEAD:apps/api/Dockerfile")
                == git_at(source, "hash-object", str(source / "apps/api/Dockerfile")),
                "Candidate Dockerfile differs from accepted Git object")
        listing = git_at(source, "ls-tree", "-rz", "HEAD")
        snapshot = source_bytes(source, listing)
        require(not git_at(source, "clean", "-ndx"), "Unexpected ignored material in candidate checkout")
        evidence["stages"]["source"] = {"passed": True, "detached": True, "clean": True,
                                          "tracked_files": len(snapshot)}
        policy = auth.policy
        require(re.fullmatch(r"python:[\w.-]+@sha256:[0-9a-f]{64}", policy["fixture_image"]),
                "Qualified pinned OIDC fixture image is missing")
        profile = load_profile(policy)
        require(re.fullmatch(r"[A-Za-z0-9_.-]+", profile["builder"]), "Approved OCI builder is unavailable")
        require(stat.S_ISSOCK(SOCKET.stat().st_mode) and not SOCKET.is_symlink()
                and SOCKET.parent.stat().st_uid == 0 and not SOCKET.parent.stat().st_mode & 0o022,
                "Qualified Docker socket unavailable")
        account = pwd.getpwnam(USER)
        require(account.pw_uid == 10002 and account.pw_uid != os.getuid(), "Isolated workload UID unavailable")
        java = Path(os.environ["JAVA_HOME"]).resolve()
        require((java / "bin/java").is_file() and re.fullmatch(r"[A-Za-z0-9/._+-]+", str(java)),
                "Reviewed Java installation path is unavailable")
        paths = {"workspace": source, "maven": Path("/tmp"),
                 "docker": Path(profile["docker_root"]), "oci": Path("/tmp"), "evidence": out}
        verified_capacity(evidence, paths, policy, "start")
        monitor = StorageMonitor(paths, policy["reserve"])
        monitor.start()
        evidence["stages"]["capacity"] = {"passed": True, "runner_label": policy["runner_label"],
                                           "profile_sha256": policy["profile_sha256"]}
        scratch = Path(tempfile.mkdtemp(prefix="stg1a-"))
        root, home, fixture = prepare_workspace(source, scratch, account, auth)
        require(source_bytes(root, listing) == snapshot, "Isolated copy changed the accepted source")
        commands = Commands(auth, home, java, root)
        inventory = Inventory(commands, auth.run_id + "-1")
        evidence["stages"]["docker_policy"] = verify_profile(commands, profile)
        _, java_version = commands.call((str(java / "bin/java"), "-version"))
        require(re.search(r'(?:openjdk|java) version "25(?:\.|")', java_version), "Build runtime is not Java 25")
        maven = commands.maven(("./mvnw", "-version"), 180)
        require("Apache Maven 3.9.11 " in maven and re.search(r"Java version: 25(?:\.|,)", maven),
                "Maven wrapper or its Java runtime was not pinned")
        monitor_maven(commands)
        ryuk_cleanup = True
        require(not monitor.failed, "Filesystem reserve was exceeded during Maven")
        code, git_state = commands.call(("/usr/bin/git", "status", "--porcelain", "--untracked-files=all"))
        require(code == 0 and not git_state, "Maven modified the approved source checkout")
        require(commands.call(("/usr/bin/git", "rev-parse", "HEAD"))[1] == CANDIDATE
                and source_bytes(root, listing) == snapshot, "Maven source revision or tracked bytes changed")
        java_release = next(line for line in java_version.splitlines()
                            if re.search(r'(?:openjdk|java) version "25(?:\.|")', line))
        jar = jar_provenance(root, java_release, "3.9.11")
        jar["ryuk_privileged"] = False
        jar["ryuk_cleanup_verified"] = True
        evidence["stages"]["maven"] = jar
        image = verify_image(commands, inventory, auth, fixture, jar["sha256"], profile,
                             lambda: verified_capacity(evidence, paths, policy, "export"))
        require(not monitor.failed, "Filesystem reserve was exceeded during image build")
        evidence["stages"]["image"] = image
        runtime_fixtures(commands, inventory, image["runtime_id"], policy["fixture_image"],
                         fixture, java, evidence["stages"])
    except (Blocked, KeyError, OSError, TypeError, ValueError, OverflowError, ET.ParseError) as exc:
        error = str(exc) if isinstance(exc, Blocked) else f"Required runtime evidence invalid ({type(exc).__name__})"
        evidence["blockers"].append(error)
    finally:
        if monitor is not None and monitor.worker.ident is not None:
            try:
                evidence["capacity_peak"] = monitor.finish()
                require(not monitor.failed, "Filesystem reserve was exceeded during runtime")
            except (Blocked, OSError):
                evidence["blockers"].append("Filesystem peak or reserve could not be verified")
        if inventory is not None:
            try:
                cleanup = inventory.cleanup() if inventory.resources else {"verified_owned_resources": 0}
                require(ryuk_cleanup, "Testcontainers cleanup is unverified")
                evidence["stages"]["cleanup"] = cleanup | {"passed": True}
            except (Blocked, OSError, ValueError, TypeError, KeyError):
                evidence["blockers"].append("Owned Docker or Testcontainers cleanup could not be verified")
        if scratch is not None:
            # Temp area is the fixed controller-created root. Never prune the daemon.
            try:
                code, _ = execute(("/usr/bin/sudo", "-n", "--", "/usr/bin/rm", "-rf", "--", str(scratch)),
                                  workdir, {"PATH": "/usr/bin:/bin"}, 60)
                require(code == 0 and not scratch.exists(), "Workload temporary files remain")
            except (Blocked, OSError):
                evidence["blockers"].append("Workload temporary-file cleanup could not be verified")
        success = not evidence["blockers"] and set(evidence["stages"]) == set(STAGES)
        if not success and not evidence["blockers"]:
            evidence["blockers"].append("Required runtime stage was not completed")
        try:
            finish_evidence(out, evidence, success)
        except Blocked:
            success = False
            evidence["blockers"].append("Runtime evidence did not satisfy final acceptance checks")
            finish_evidence(out, evidence, False)
    for blocker in evidence["blockers"]:
        print(blocker, file=sys.stderr)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
