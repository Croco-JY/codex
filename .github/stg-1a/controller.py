"""Trusted STG-1A execution controller. Only main() connects to GitHub or launches commands."""
from contextlib import ExitStack, contextmanager
import datetime
import io
import math
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
    require(jobs["total_count"] == len(jobs["jobs"]) == 2, "Unexpected jobs in approved attempt")
    context_job, job = sorted(jobs["jobs"], key=lambda item: item["name"])
    require(context_job["name"] == "context" and context_job["conclusion"] == "success"
            and context_job["head_sha"] == workflow_sha and context_job["run_id"] == int(run_id)
            and context_job["run_attempt"] == 1, "Dispatch context check did not pass")
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
        require(path == path.resolve(strict=True), "Redirected capacity measurement")
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
        self.paths, self.reserve, self.measure = paths.copy(), reserve, measure
        self.mounts = {}
        self.done = threading.Event()
        self.worker = threading.Thread(target=self.watch, daemon=True)
        self.lock = threading.Lock()
        self.phase = "preparation"
        self.errors = []
        self.rows = {}
        self.failed = False

    def sample(self, phase=None, paths=None):
        with self.lock:
            if paths is not None:
                self.paths = paths.copy()
            if phase:
                self.phase = phase
            for name, path in self.paths.items():
                try:
                    require(path == path.resolve(strict=True), "Storage path redirected")
                    fd = os.open(path, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        device = os.fstat(fd).st_dev
                        info = Path(f"/proc/self/fdinfo/{fd}").read_text()
                        mount_id = re.search(r"^mnt_id:\s*(\d+)$", info, re.M)
                        require(mount_id, "Mount identity unavailable")
                        mount = (device, int(mount_id[1]))
                        require(self.mounts.setdefault(name, mount) == mount, "Workload mount changed")
                        fs = self.measure(path)
                    finally:
                        os.close(fd)
                    available = {"bytes": fs.f_bavail * fs.f_frsize, "inodes": fs.f_favail}
                    require(min(available.values()) >= 0, "Unknown filesystem capacity")
                except (Blocked, OSError, ValueError) as exc:
                    self.failed = True
                    self.errors.append(f"{self.phase}/{name}: {type(exc).__name__}")
                    raise
                row = self.rows.setdefault(device, {"paths": set(), "initial": available.copy(),
                                                    "low_water": available.copy(), "phases": {}})
                row["paths"].add(name)
                phase_low = row["phases"].setdefault(self.phase, available.copy())
                row["final"] = available
                for key in available:
                    row["low_water"][key] = min(row["low_water"][key], available[key])
                    phase_low[key] = min(phase_low[key], available[key])
                    self.failed |= available[key] < self.reserve[key]

    def watch(self):
        try:
            while not self.done.wait(1):
                self.sample()
        except (Blocked, OSError, ValueError):
            self.failed = True
        finally:
            if not self.done.is_set():
                self.failed = True
                self.errors.append("Storage sampling worker stopped unexpectedly")

    def start(self):
        self.sample()
        self.worker.start()

    def finish(self):
        self.done.set()
        self.worker.join(10)
        require(not self.worker.is_alive(), "Storage monitoring did not finish")
        self.sample("final")
        require(not self.errors, "Storage peak unavailable after measurement failure")
        return [{"device": device, "paths": sorted(row["paths"]), "initial": row["initial"],
                 "mount_ids": sorted({self.mounts[name][1] for name in row["paths"]}),
                 "final": row["final"], "phase_low_water": row["phases"],
                 "low_water": row["low_water"],
                 "peak_growth": {key: max(0, row["initial"][key] - row["low_water"][key])
                                 for key in row["initial"]}}
                for device, row in self.rows.items()]


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
    with tempfile.TemporaryFile(dir="/tmp") as output:
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
                            or (a.startswith("--tmpfs") and a != "--tmpfs=/var/lib/postgresql:rw,nosuid,nodev,noexec,size=1m")
                            or a in ("-v", "--volume", "--network", "--net", "--pid", "--ipc", "--driver")
                            or (a == "--volumes" and args[0] != "rm") for a in args)
                and not (args[0] == "image" and args[1:2] not in (("inspect",), ("load",), ("rm",), ("ls",)))
                and not (args[0] == "network" and args[1:2] not in (
                    ("create",), ("inspect",), ("disconnect",), ("rm",), ("ls",)))
                and not (args[0] == "volume" and args[1:2] not in (("ls",), ("rm",)))
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


@contextmanager
def confined(root, relative, *, directory=False):
    """Open every component relative to a pinned directory descriptor on Linux."""
    parts = Path(relative).parts
    require(root.is_absolute() and parts and not Path(relative).is_absolute()
            and ".." not in parts, "Invalid artifact path")
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with ExitStack() as stack:
        try:
            fd = os.open("/", flags | os.O_DIRECTORY)
            stack.callback(os.close, fd)
            for part in (*root.parts[1:], *parts[:-1]):
                fd = os.open(part, flags | os.O_DIRECTORY, dir_fd=fd)
                stack.callback(os.close, fd)
            fd = os.open(parts[-1], flags | (os.O_DIRECTORY if directory else 0), dir_fd=fd)
            stack.callback(os.close, fd)
            mode = os.fstat(fd).st_mode
            require(stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode),
                    "Unexpected artifact type")
            if not directory:
                require(os.fstat(fd).st_nlink == 1, "Shared artifact inode")
        except OSError as exc:
            raise Blocked("Required confined artifact is missing or redirected") from exc
        yield fd if directory else stack.enter_context(os.fdopen(fd, "rb", closefd=False))


def source_bytes(root, listing):
    recorded = {}
    for row in listing.split("\0"):
        if not row:
            continue
        metadata, filename = row.split("\t", 1)
        mode, kind, oid = metadata.split()
        with confined(root, filename) as stream:
            require(kind == "blob" and mode in ("100644", "100755")
                    and bool(os.fstat(stream.fileno()).st_mode & stat.S_IXUSR) == (mode == "100755"),
                    "Unexpected tracked file mode")
            content = stream.read()
        # The accepted tree's only explicit CRLF checkout file is the Windows wrapper.
        canonical = content.replace(b"\r\n", b"\n") if filename == "apps/api/mvnw.cmd" else content
        obj = hashlib.sha1(f"blob {len(canonical)}\0".encode() + canonical, usedforsecurity=False)
        require(obj.hexdigest() == oid, "Candidate tracked bytes differ from the accepted object")
        recorded[filename] = hashlib.sha256(content).hexdigest()
    require(recorded, "Empty candidate tree")
    return recorded


def check_working_files(root, snapshot, *, built=False):
    dirs_expected = {str(parent) for name in snapshot for parent in Path(name).parents}
    for folder, dirs, files in os.walk(root):
        if not built and Path(folder) == root:
            dirs.remove(".git")
        if built and Path(folder) == root / "apps/api" and "target" in dirs:
            dirs.remove("target")
        for name in dirs + files:
            path = Path(folder) / name
            relative = str(path.relative_to(root))
            require(not path.is_symlink() and relative in (dirs_expected if name in dirs else snapshot),
                    "Unexpected file in candidate workspace")


def write_evidence(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write("\n")


class AuthorizedEvidence(dict):
    """Keep the authenticated server decision separate from serialized stage data."""

    def __init__(self, auth, stages):
        super().__init__(stages)
        self.auth = auth
        self.update(self.receipt())

    def receipt(self):
        auth = self.auth
        return dict(repository_id=REPO_ID, workflow_ref=f"{REPO}/{WORKFLOW}@{REF}",
                    controller_sha=auth.workflow_sha, candidate_sha=auth.policy["candidate_sha"],
                    environment=ENVIRONMENT, environment_id=auth.environment_id,
                    decision="approved", approval_ref=f"/actions/runs/{auth.run_id}/approvals",
                    policy_sha256=hashlib.sha256(json.dumps(auth.policy, sort_keys=True).encode()).hexdigest(),
                    dispatcher_id=auth.actor_id, reviewer_id=auth.reviewer_id, run_id=auth.run_id,
                    attempt=1, job_id=auth.job_id, runner_id=auth.runner_id, runner_name=auth.runner_name)


def finish_evidence(directory, evidence, success):
    complete = set(evidence["stages"]) == set(STAGES) and all(
        isinstance(result, dict) and result.get("passed") is True
        for result in evidence["stages"].values())
    if success:
        require(isinstance(evidence, AuthorizedEvidence) and
                all(evidence.get(k) == v for k, v in evidence.receipt().items()),
                "Final receipt differs from the independently authorized run")
        require(complete and not evidence["blockers"], "Incomplete verification cannot pass")
        stages = evidence["stages"]
        maven, image = stages["maven"], stages["image"]
        require(evidence.get("candidate_sha") == CANDIDATE and evidence.get("attempt") == 1
                and SHA.fullmatch(evidence.get("controller_sha", ""))
                and all(evidence.get(field) for field in ("reviewer_id", "environment_id", "run_id", "approval_ref"))
                and set(evidence.get("capacity_samples", {})) == {"start", "export"}
                and bool(evidence.get("capacity_peak"))
                and maven.get("expiry", {}).get("method") == EXPIRY_CASE
                and maven["expiry"].get("class") == EXPIRY_CLASS
                and maven["expiry"].get("deadline_seconds") == 900
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
    with confined(directory, "sha256.json") as stream:
        manifest = json.load(stream)
    require(set(manifest) == {"result.json"}, "Unexpected evidence manifest")
    (directory / "result.json").lstat()
    with confined(directory, "result.json") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    require(manifest["result.json"] == digest,
            "Evidence hash mismatch")


EXPIRY_CLASS = "com.sourceos.PatternReleaseExpiryTest"
EXPIRY_CASE = "actualConsentDeadlineAfterObservedLockWaitAndConsumedConsentExpiry"


def expiry_evidence(root, duration):
    with confined(root, "apps/api/target/pattern-release-evidence/expiry-real-15-minute-lock-wait.json") as f:
        result = json.load(f)
    issued, deadline, started, released = (
        utc(result[key]) for key in ("consentIssued", "consentDeadline", "transactionStarted", "lockReleased"))
    require(abs(deadline - issued - 900) < 0.000001 and issued <= started < deadline <= released
            and math.isfinite(duration) and 899.999 <= duration <= 1020
            and released - issued <= duration + 0.001
            and result["result"] == 409 and result["partialReleaseRows"] == 0
            and result["consumedConsentExpiredButReleaseStillAccessible"] is True
            and all(type(result[k]) is int and result[k] > 0 for k in ("writerPid", "blockingPid"))
            and result["writerPid"] != result["blockingPid"], "Contradictory real expiry evidence")
    return {"class": EXPIRY_CLASS, "method": EXPIRY_CASE, "seconds": duration,
            "deadline_seconds": 900, "database_times": {k: result[k] for k in
                ("consentIssued", "consentDeadline", "transactionStarted", "lockReleased")}}


def jar_provenance(root, java, maven, context=None, expected=None):
    import zipfile
    prefix = Path("apps/api/src/test/java")
    if expected is None:
        expected = [str(p.relative_to(root)) for p in (root / prefix).rglob("*Test.java")]
    suites = {".".join(Path(name).relative_to(prefix).with_suffix("").parts)
              for name in expected if Path(name).is_relative_to(prefix) and name.endswith("Test.java")}
    report_dir = Path("apps/api/target/surefire-reports")
    with confined(root, report_dir, directory=True) as fd:
        reports = sorted(os.listdir(fd))
    expiry = None
    totals = dict.fromkeys(("tests", "failures", "errors", "skipped"), 0)
    observed = set()
    for report in reports:
        with confined(root, report_dir / report) as stream:
            if not (report.startswith("TEST-") and report.endswith(".xml")):
                continue
            suite = ET.parse(stream).getroot()
        cases = suite.findall("testcase")
        require(suite.tag == "testsuite" and len(cases) == int(suite.attrib["tests"])
                and all(case.find("failure") is None and case.find("error") is None
                        and case.find("skipped") is None and case.find("disabled") is None
                        and case.get("disabled", "false") == "false"
                        and case.get("status", "passed") in ("passed", "run")
                        for case in cases), "Missing or non-passing Surefire testcase")
        for case in cases:
            if case.get("classname") == EXPIRY_CLASS or case.get("name") == EXPIRY_CASE:
                require(suite.get("name") == EXPIRY_CLASS, "Substituted expiry suite")
        if suite.get("name") == EXPIRY_CLASS:
            require(len(cases) == 1 and cases[0].get("classname") == EXPIRY_CLASS
                    and cases[0].get("name") == EXPIRY_CASE and not expiry,
                    "Required genuine expiry testcase is missing or duplicated")
            expiry = expiry_evidence(root, float(cases[0].get("time", "nan")))
        name = suite.attrib["name"]
        require(name not in observed and int(suite.attrib["tests"]) > 0, "Invalid Surefire suite")
        observed.add(name)
        for key in totals:
            count = int(suite.attrib[key])
            require(count > 0 if key == "tests" else count == 0, "Non-passing Surefire suite")
            totals[key] += count
    require(suites and suites <= observed and all(totals[k] == 0 for k in ("failures", "errors", "skipped"))
            and "com.sourceos.PatternReleaseExpiryTest" in observed, "Incomplete backend or real-expiry regression")
    require(expiry, "Missing real expiry evidence")
    with confined(root, Path("apps/api") / JAR) as stream:
        content = stream.read()
    if context is not None:
        (context / JAR).write_bytes(content)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        manifest = archive.read("META-INF/MANIFEST.MF").decode().replace("\r\n", "\n")
        require(archive.testzip() is None
                and "Main-Class: org.springframework.boot.loader.launch.JarLauncher\n" in manifest
                and "Start-Class: com.sourceos.SourceOsApplication\n" in manifest
                and any(name.startswith("BOOT-INF/lib/") for name in archive.namelist())
                and archive.read("BOOT-INF/classes/com/sourceos/SourceOsApplication.class")[:8]
                == bytes.fromhex("cafebabe00000045"), "Unexpected executable JAR")
    return {"passed": True, "sha256": hashlib.sha256(content).hexdigest(), "expiry": expiry, "java_version": java,
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
        self.container_mounts = {}

    def add(self, kind, identity):
        require(kind in ("container", "network", "image", "volume"), "Unexpected Docker resource kind")
        valid = r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}" if kind == "volume" else r"[0-9a-f]{64}"
        require(re.fullmatch(valid, identity), "Invalid Docker resource identity")
        if (kind, identity) not in self.resources:
            self.resources.append((kind, identity))
        return identity

    def track_created(self, identity):
        # Register the ID first so cleanup still accounts for a failed first inspect.
        self.add("container", identity)
        require(self.inspect("container", identity) is not None,
                "Created container disappeared before attachment inventory: " + identity)
        return identity

    def record_mounts(self, identity, row):
        require((row["Config"]["Labels"] or {}).get("com.sourceos.stg1a.run") == self.label,
                "Cannot inventory an unowned container")
        mounts = row.get("Mounts")
        require(isinstance(mounts, list), "Missing effective container mounts")
        volumes = set()
        for mount in mounts:
            require(isinstance(mount, dict) and mount.get("Type") in ("bind", "volume", "tmpfs"),
                    "Unknown effective container mount")
            if mount["Type"] == "volume":
                name = mount.get("Name")
                require(isinstance(name, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", name),
                        "Unidentified attached volume")
                volumes.add(name)
        snapshot = tuple(sorted(json.dumps(mount, sort_keys=True) for mount in mounts))
        require(self.container_mounts.setdefault(identity, snapshot) == snapshot,
                "Effective attachments differ from the recorded container inventory")
        for name in sorted(volumes):
            self.add("volume", name)

    def inspect(self, kind, identity):
        code, text = self.commands.docker("inspect", "--type=" + kind, identity, allow_failure=True)
        if code:
            require(not re.search(r"denied|unauthorized|forbidden", text, re.I),
                    "Docker denied resource inspection")
            missing = (r"(?:\[\]\s*)?(?:Error(?: response from daemon)?:\s*)?No such "
                       + rf"(?:object|{kind})(?::\s*{re.escape(identity)})?")
            require(code == 1 and re.fullmatch(missing, text.strip(), re.I),
                    "Could not confirm resource absence")
            return None
        try:
            rows = json.loads(text)
        except ValueError as exc:
            raise Blocked("Malformed Docker inspection JSON") from exc
        require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict),
                "Missing or ambiguous Docker inspection object")
        row = rows[0]
        actual = row.get("Name") if kind == "volume" else row.get("Id", row.get("ID"))
        require(isinstance(actual, str)
                and (actual.removeprefix("sha256:") if kind == "image" else actual) == identity,
                "Resource inspection identity mismatch")
        metadata = row.get("Config") if kind in ("container", "image") else row
        require(isinstance(metadata, dict) and "Labels" in metadata
                and (metadata["Labels"] is None or isinstance(metadata["Labels"], dict)),
                "Malformed ownership evidence")
        if kind == "container":
            self.record_mounts(identity, row)
        return row

    def remove(self, kind, identity):
        row = self.inspect(kind, identity)
        if row is None:
            require(kind != "container" or identity in self.container_mounts,
                    "Container absent with unresolved attachment inventory")
            return
        labels = row["Config"]["Labels"] if kind in ("container", "image") else row["Labels"]
        require(labels and labels.get("com.sourceos.stg1a.run") == self.label,
                "Ownership or identity mismatch")
        if kind == "container":
            # Never implicitly delete an attached volume before inspecting its label.
            self.commands.docker("rm", "-f", identity)
        else:
            # Non-forced volume rm also checks attachments atomically at the daemon.
            self.commands.docker(kind, "rm", identity)
        require(self.inspect(kind, identity) is None, "Resource still present after removal")

    def cleanup_session(self, report=None):
        # A create/load may succeed before its CLI reply reaches the controller.
        # Discover such resources, still requiring a fresh ownership inspection.
        if report is None:
            report = {}
        outcomes = []
        residual = []
        scans_failed = []
        report.pop("verified_owned_resources", None)
        report.update(passed=False, resources=outcomes, residual=residual, scans_failed=scans_failed)
        errors = []
        selectors = {"container": ("ps", "-aq", "--no-trunc"),
                     "network": ("network", "ls", "-q", "--no-trunc"),
                     "image": ("image", "ls", "-q", "--no-trunc"),
                     "volume": ("volume", "ls", "-q")}

        def discover(phase):
            for kind, argv in selectors.items():
                incomplete = False
                try:
                    code, output = self.commands.docker(*argv, "--filter=label=com.sourceos.stg1a.run=" + self.label)
                    require(code == 0 and isinstance(output, str), "Invalid resource listing")
                    for line in output.splitlines():
                        try:
                            identity = self.add(kind, line.removeprefix("sha256:") if kind == "image" else line)
                        except Blocked:
                            incomplete = True
                            continue
                        if phase == "final":
                            residual.append({"kind": kind, "identity": identity})
                except InterruptedError:
                    raise
                except Exception:
                    incomplete = True
                if incomplete:
                    scans_failed.append({"phase": phase, "kind": kind})
                    errors.append(f"Incomplete {phase} inventory of {kind}")

        discover("initial")
        try:
            result = self.cleanup(outcomes)
        except Blocked as exc:
            errors.append(str(exc))
        discover("final")
        if residual:
            errors.append("Run-owned resources remain")
        require(not errors, "Session cleanup incomplete: " + "; ".join(errors))
        report.update(result)
        return report

    def cleanup(self, outcomes=None):
        if outcomes is None:
            outcomes = []
        failures = []
        for resource_kind in ("container", "network", "image", "volume"):
            for kind, identity in reversed(self.resources.copy()):
                if kind != resource_kind:
                    continue
                record = {"kind": kind, "identity": identity}
                try:
                    self.remove(kind, identity)
                except InterruptedError:
                    raise
                except Exception:
                    # Identity was validated by add(). Never serialize a decoder
                    # exception, daemon payload or arbitrary exception argument.
                    reason = "ownership or removal unverified"
                    if kind == "container" and identity not in self.container_mounts:
                        reason = "unresolved attachment inventory"
                    record.update(status="unresolved", reason=reason)
                    failures.append(f"{kind} {identity}: {reason}")
                else:
                    record["status"] = "confirmed_absent"
                outcomes.append(record)
        if failures:
            # Keep the human diagnostic bounded. The report retains every outcome.
            raise Blocked(f"Cleanup unresolved ({len(failures)}): " + "; ".join(failures[:4]))
        return {"passed": True, "verified_owned_resources": len(outcomes)}


def validate_ryuk(details):
    host = details["HostConfig"]
    bind = str(SOCKET) + ":/var/run/docker.sock"
    require(host["Privileged"] is False and host["NetworkMode"] in ("bridge", "default")
            and host["Binds"] in ([bind], [bind + ":rw"])
            and host.get("Mounts") in (None, []) and host.get("VolumesFrom") in (None, [])
            and not host.get("CapAdd") and not host.get("Devices"),
            "Ryuk did not use the approved Docker policy")
    effective = details.get("Mounts")
    require(isinstance(effective, list) and len(effective) == 1 and isinstance(effective[0], dict),
            "Expected exactly one effective Ryuk mount")
    mount = effective[0]
    require(mount.get("Type") == "bind" and mount.get("Source") == str(SOCKET)
            and mount.get("Destination") == "/var/run/docker.sock" and mount.get("RW") is True
            and mount.get("Mode", "") in ("", "rw"),
            "Effective Ryuk socket mount differs from approved bind")
    running = details["State"]["Running"]
    require(type(running) is bool, "Ryuk state is unavailable")
    return running


def monitor_maven(commands):
    import threading

    done = threading.Event()
    observed = {}
    last_running = {}
    samples = {}
    lifecycle = threading.Condition()
    state = "starting"

    def inspect_ryuk():
        nonlocal state
        try:
            with lifecycle:
                if state != "starting":
                    return
                state = "running"
                lifecycle.notify_all()
            while not done.is_set():
                _, names = commands.docker("ps", "-aq", "--no-trunc",
                                           "--filter=label=org.testcontainers=true", limit=10)
                listed = names.splitlines()
                require(len(set(listed)) == len(listed) and set(observed).issubset(listed),
                        "Tracked Ryuk disappeared during active observation")
                for identity in listed:
                    require(re.fullmatch(r"[0-9a-f]{64}", identity), "Unexpected Testcontainers identity")
                    code, data = commands.docker("inspect", "--type=container", identity,
                                                 limit=10, allow_failure=True)
                    require(code == 0, "Docker inspection unavailable during Testcontainers verification")
                    row, = json.loads(data)
                    require(isinstance(row, dict) and row.get("Id") == identity
                            and isinstance(row.get("Name"), str), "Invalid container inspection identity")
                    if identity in observed:
                        require(row["Name"].startswith("/testcontainers-ryuk-"), "Tracked Ryuk identity changed")
                    if row["Name"].startswith("/testcontainers-ryuk-"):
                        require(row["Id"] == identity and
                                row["Config"]["Image"] == "testcontainers/ryuk:0.14.0",
                                "Ryuk container or image identity mismatch")
                        running = validate_ryuk(row)
                        require(not observed.get(identity) or running, "Ryuk stopped during verification")
                        observed[identity] = running
                        if running:
                            samples[identity] = samples.get(identity, 0) + 1
                            last_running[identity] = time.monotonic()
                done.wait(0.4)
            with lifecycle:
                if state == "stop requested":
                    state = "completed normally"
        except Exception:
            # Do not copy decoder, daemon or workload-controlled text into evidence.
            with lifecycle:
                state = "inspection failed"
        finally:
            with lifecycle:
                if state not in ("completed normally", "inspection failed"):
                    state = "abnormal exit"
                lifecycle.notify_all()

    observer = threading.Thread(target=inspect_ryuk, daemon=True)
    observer.start()
    try:
        with lifecycle:
            require(lifecycle.wait_for(lambda: state != "starting", timeout=10)
                    and state == "running", "Ryuk observer did not enter active monitoring")
        commands.maven(MAVEN)
        with lifecycle:
            if state == "running":
                state = "stop requested"
    finally:
        done.set()
        observer.join(20)
        require(not observer.is_alive(), "Ryuk observer did not terminate within the deadline")
    with lifecycle:
        require(state == "completed normally", "Ryuk observer could not verify completion: " + state)
    require(len(observed) == 1 and all(observed.values())
            and all(samples[k] >= 2 and time.monotonic() - last_running[k] <= 30 for k in observed),
            "Non-privileged Ryuk was not verified during Maven")
    until = time.monotonic() + 30
    for _ in range(31):
        _, containers = commands.docker("ps", "-aq", "--filter=label=org.testcontainers=true", limit=10)
        _, networks = commands.docker("network", "ls", "-q", "--filter=label=org.testcontainers=true", limit=10)
        _, volumes = commands.docker("volume", "ls", "-q", "--filter=label=org.testcontainers=true", limit=10)
        if not (containers or networks or volumes):
            # Maven has completed. Confirm absence by immutable ID independently
            # of mutable labels, using an all-states container listing.
            identity, = observed
            _, remaining = commands.docker("ps", "-aq", "--filter=id=" + identity, limit=10)
            require(not remaining, "Tracked Ryuk remains after workload completion")
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
        return inventory.track_created(commands.docker("create", *flags, *args, image, *entry)[1])

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
    # Cover the image-declared VOLUME with an ephemeral empty tmpfs. PostgreSQL
    # stores the fixture database in PGDATA on its container writable layer.
    db = create(PG, "--network-alias", "pg", "--user", "postgres",
                "--tmpfs=/var/lib/postgresql:rw,nosuid,nodev,noexec,size=1m", envfile=db_env)
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
    allowed = {("status", "--porcelain", "--untracked-files=all"), ("rev-parse", "HEAD"),
               ("rev-parse", "--abbrev-ref", "HEAD"), ("remote", "get-url", "origin"),
               ("ls-tree", "-rz", "HEAD")}
    require(args in allowed and root == root.resolve(), "Unsafe Git inspection request")
    metadata = root / ".git"
    require(metadata.is_dir() and not metadata.is_symlink(), "Redirected Git metadata")
    for path in (root, metadata):
        require(path.stat().st_uid == os.getuid() and not path.stat().st_mode & 0o022,
                "Checkout is outside controller ownership")
    for directory, folders, files in os.walk(metadata):
        for name in folders + files:
            item = Path(directory) / name
            require(item.lstat().st_uid == os.getuid() and not item.lstat().st_mode & 0o022
                    and not item.is_symlink() and (item.is_dir() or item.is_file()),
                    "Indirect or special Git metadata")
    for name in ("commondir", "gitdir", "config.worktree", "objects/info/alternates",
                 "objects/info/http-alternates", "info/grafts", "modules"):
        require(not (metadata / name).exists(), "Unsupported Git metadata redirection")
    # Accept only simple literal settings emitted by checkout. Reject Git's
    # quoting, continuation and include syntaxes rather than reinterpreting them.
    section = ""
    settings = {
        "core": {"repositoryformatversion": "0", "filemode": "true", "bare": "false",
                 "logallrefupdates": "true", "fsmonitor": "(?:true|false)"},
        "gc": {"auto": "0"},
        'remote "origin"': {"url": r"https://github\.com/Croco-JY/codex(?:\.git)?",
                            "tagopt": "--no-tags", "fetch": r"[+a-zA-Z0-9*/:_-]+"},
        "branch": {"remote": "origin", "merge": r"refs/heads/[a-zA-Z0-9/_-]+"},
    }
    for line in (metadata / "config").read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            if re.fullmatch(r'branch "[A-Za-z0-9/_-]+"', section):
                section = "branch"
            require(section in settings, "Unapproved Git configuration section")
            continue
        key, sep, value = line.partition("=")
        pattern = settings.get(section, {}).get(key.strip().lower())
        require(sep and pattern and re.fullmatch(pattern, value.strip()),
                "Unapproved checkout-local Git configuration")
    env = {"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_ATTR_NOSYSTEM": "1", "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_REPLACE_OBJECTS": "1",
           "GIT_ALLOW_PROTOCOL": "", "GIT_NO_LAZY_FETCH": "1"}
    # Compare the index to HEAD without asking Git to traverse untrusted
    # working files, embedded repositories, attributes or submodule settings.
    # The caller separately verifies the complete working tree against pinned blobs.
    if args[0] == "status":
        args = ("diff-index", "--cached", "--name-only", "--no-ext-diff", "--no-textconv",
                "--ignore-submodules=all", "HEAD", "--")
    # Inspect the index without walking nested worktrees or invoking diff drivers.
    # source_bytes and check_working_files verify working files independently.
    if args[0] == "status":
        args = ("diff-index", "--cached", "--no-ext-diff", "--no-textconv",
                "--ignore-submodules=all", "--name-only", "HEAD", "--")
    command = ["/usr/bin/git", "--git-dir=" + str(metadata), "--work-tree=" + str(root),
               "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
               "-c", "submodule.recurse=false", "-c", "diff.ignoreSubmodules=all", *args]
    code, output = execute(command, root, env, 20)
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
    storage_check()
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
               "--output=type=oci,dest=" + str(archive), str(fixture_directory / "context"), limit=600)
    frozen = fixture_directory / "verified-image.oci.tar"
    with confined(fixture_directory, "generated/image.oci.tar") as src, frozen.open("xb") as dst:
        shutil.copyfileobj(src, dst)
    frozen.chmod(0o444)
    archive = frozen
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
    probe = inventory.track_created(cmd.docker("create", "--network=none", "--cap-drop=ALL",
                          "--security-opt=no-new-privileges", "--read-only",
                          "--label", "com.sourceos.stg1a.run=" + inventory.label,
                          "--entrypoint=/usr/bin/sha256sum", image_id, "/app/source-os-api.jar")[1])
    _, output = cmd.docker("start", "-a", probe)
    require(output.split() == [jar, "/app/source-os-api.jar"], "Packaged JAR digest differs")
    probe = inventory.track_created(cmd.docker("create", "--network=none", "--cap-drop=ALL",
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
    shutil.copytree(source, work, symlinks=True, ignore=shutil.ignore_patterns(".git"))
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
    require(out.parent == out.parent.resolve(), "Redirected evidence directory")
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
        evidence = AuthorizedEvidence(auth, evidence)
        source = workdir.parent / "candidate"
        validate_checkout(source, lambda *args: git_at(source, *args))
        listing = git_at(source, "ls-tree", "-rz", "HEAD")
        require(hashlib.sha256(listing.encode()).hexdigest() ==
                "c122ad649c61dcc6106a1e90b9001d782d18565c53b500d082e38818d5f8c593",
                "Candidate file listing differs from the accepted Git tree")
        snapshot = source_bytes(source, listing)
        check_working_files(source, snapshot)
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
        scratch = Path(tempfile.mkdtemp(prefix="stg1a-", dir="/tmp"))
        require(scratch == scratch.resolve(strict=True), "Redirected workload scratch")
        # The isolated target/cache and both OCI archive copies reside under scratch.
        # /tmp also covers JVM, CLI and controller temporary files on this runner.
        paths = {"workspace": source, "maven": scratch, "target": scratch,
                 "scratch": scratch, "temporary": Path("/tmp"),
                 "docker": Path(profile["docker_root"]), "oci": scratch, "evidence": out}
        verified_capacity(evidence, paths, policy, "start")
        evidence["stages"]["capacity"] = {"passed": True, "runner_label": policy["runner_label"],
                                           "profile_sha256": policy["profile_sha256"]}
        monitor = StorageMonitor(paths, policy["reserve"])
        monitor.start()
        root, home, fixture = prepare_workspace(source, scratch, account, auth)
        paths.update(maven=home, target=root / "apps/api", oci=fixture / "generated")
        monitor.sample("toolchain", paths)
        require(source_bytes(root, listing) == snapshot, "Isolated copy changed the accepted source")
        commands = Commands(auth, home, java, root)
        evidence["stages"]["docker_policy"] = verify_profile(commands, profile)
        inventory = Inventory(commands, auth.run_id + "-1")
        _, java_version = commands.call((str(java / "bin/java"), "-version"))
        require(re.search(r'(?:openjdk|java) version "25(?:\.|")', java_version), "Build runtime is not Java 25")
        maven = commands.maven(("./mvnw", "-version"), 180)
        require("Apache Maven 3.9.11 " in maven and re.search(r"Java version: 25(?:\.|,)", maven),
                "Maven wrapper or its Java runtime was not pinned")
        before_maven = capacity(paths, policy["storage"]["pre_maven"], policy["reserve"])
        check_capacity(before_maven)
        evidence["capacity_before_maven"] = before_maven
        monitor.sample("maven")
        monitor_maven(commands)
        ryuk_cleanup = True
        require(not monitor.failed, "Filesystem reserve was exceeded during Maven")
        monitor.sample("image")
        require(source_bytes(root, listing) == snapshot, "Maven modified tracked source")
        check_working_files(root, snapshot, built=True)
        java_release = next(line for line in java_version.splitlines()
                            if re.search(r'(?:openjdk|java) version "25(?:\.|")', line))
        context = fixture / "context"
        (context / "target").mkdir(parents=True)
        for name in ("Dockerfile", ".dockerignore"):
            with confined(source, Path("apps/api") / name) as stream:
                content = stream.read()
            require(hashlib.sha256(content).hexdigest() == snapshot["apps/api/" + name],
                    "Build context input changed")
            (context / name).write_bytes(content)
        jar = jar_provenance(root, java_release, "3.9.11", context, snapshot)
        for path in (context, context / "target"):
            path.chmod(0o755)
        for path in (context / JAR, context / "Dockerfile", context / ".dockerignore"):
            path.chmod(0o444)
        jar["ryuk_privileged"] = False
        jar["ryuk_cleanup_verified"] = True
        evidence["stages"]["maven"] = jar
        image = verify_image(commands, inventory, auth, fixture, jar["sha256"], profile,
                             lambda: verified_capacity(evidence, paths, policy, "export"))
        require(not monitor.failed, "Filesystem reserve was exceeded during image build")
        evidence["stages"]["image"] = image
        monitor.sample("runtime")
        runtime_fixtures(commands, inventory, image["runtime_id"], policy["fixture_image"],
                         fixture, java, evidence["stages"])
    except (Blocked, KeyError, OSError, TypeError, ValueError, OverflowError, ET.ParseError) as exc:
        error = str(exc) if isinstance(exc, Blocked) else f"Required runtime evidence invalid ({type(exc).__name__})"
        evidence["blockers"].append(error)
    finally:
        if inventory is not None:
            cleanup_report = {"passed": False}
            evidence["stages"]["cleanup"] = cleanup_report
            try:
                inventory.cleanup_session(cleanup_report)
                require(ryuk_cleanup, "Testcontainers cleanup is unverified")
            except Blocked as exc:
                cleanup_report["passed"] = False
                evidence["blockers"].append(str(exc))
            except (OSError, ValueError, TypeError, KeyError):
                cleanup_report["passed"] = False
                evidence["blockers"].append("Owned Docker or Testcontainers cleanup could not be verified")
        if monitor is not None:
            try:
                require(monitor.worker.ident is not None, "Storage sampling did not start")
                evidence["capacity_peak"] = monitor.finish()
                require(not monitor.failed, "Filesystem reserve was exceeded during runtime")
            except (Blocked, OSError):
                evidence["capacity_peak"] = None
                evidence["capacity_errors"] = list(monitor.errors) or ["Measurement or reserve unavailable"]
                evidence["blockers"].append("Filesystem peak or reserve could not be verified")
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
