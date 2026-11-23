"""Offline tests. GitHub, Docker and Maven are represented by test doubles."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch
import io
import json
import tarfile
import tempfile

from cryptography.hazmat.primitives.asymmetric import rsa
import jwt

import controller as c

NOW = 1_800_000_000
WORKFLOW_SHA = "a" * 40
RUN = "224499"
ENV_ID = 9
REVIEWER = 41
ACTOR = 42


def timestamp(offset):
    return datetime.fromtimestamp(NOW + offset, timezone.utc).isoformat()


def claims(**changes):
    return {
        "iss": c.ISSUER, "aud": c.AUDIENCE, "iat": NOW - 10, "nbf": NOW - 10, "exp": NOW + 110,
        "repository_id": str(c.REPO_ID), "repository_owner_id": str(c.OWNER_ID),
        "event_name": "workflow_dispatch", "ref": c.REF, "environment": c.ENVIRONMENT,
        "runner_environment": "github-hosted", "workflow_ref": f"{c.REPO}/{c.WORKFLOW}@{c.REF}",
        "workflow_sha": WORKFLOW_SHA, "sha": WORKFLOW_SHA, "run_id": RUN, "run_attempt": "1",
        "actor_id": str(ACTOR),
    } | changes


class SecurityTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.signer = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.signer.public_key()))
        cls.jwks = {"keys": [jwk | {"kid": "test", "alg": "RS256", "use": "sig"}]}

    def verify(self, payload, signer=None):
        data = {c.ISSUER + "/.well-known/openid-configuration": {
            "issuer": c.ISSUER, "jwks_uri": c.JWKS, "id_token_signing_alg_values_supported": ["RS256"]},
            c.JWKS: self.jwks}
        token = jwt.encode(payload, signer or self.signer, algorithm="RS256", headers={"kid": "test"})
        return c.verified_claims(token, data.__getitem__, NOW)

    def test_valid_signature(self):
        self.assertEqual(self.verify(claims()), claims())

    def test_invalid_signature(self):
        with self.assertRaises(c.Blocked):
            self.verify(claims(), self.other)

    def test_wrong_token_issuer_or_audience(self):
        for override in ({"iss": "https://example.invalid"}, {"aud": "other"},
                         {"aud": [c.AUDIENCE]}):
            with self.subTest(override=override), self.assertRaises(c.Blocked):
                self.verify(claims(**override))

    def test_unacceptable_algorithm_or_malformed_token(self):
        meta = {"issuer": c.ISSUER, "jwks_uri": c.JWKS, "id_token_signing_alg_values_supported": ["RS256"]}
        for token in ("broken", jwt.encode(claims(), "x" * 32, algorithm="HS256", headers={"kid": "test"})):
            with self.subTest(token_type=len(token)), self.assertRaises(c.Blocked):
                c.verified_claims(token, lambda _: meta, NOW)

    def test_invalid_jwks_discovery(self):
        token = jwt.encode(claims(), self.signer, algorithm="RS256", headers={"kid": "test"})
        with self.assertRaises(c.Blocked):
            c.verified_claims(token, lambda _: {"issuer": c.ISSUER, "jwks_uri": "https://example.invalid"},
                              NOW)

    def test_oidc_time_checks_and_missing_claim(self):
        for override in ({"exp": NOW - 31}, {"nbf": NOW + 31}, {"iat": NOW + 31},
                         {"exp": NOW + 700}, {"iat": str(NOW)}, {"nbf": None}):
            with self.subTest(override=override), self.assertRaises(c.Blocked):
                self.verify(claims(**override))
        payload = claims()
        del payload["iat"]
        with self.assertRaises(c.Blocked):
            self.verify(payload)

    def test_oidc_request_token_is_never_forwarded_to_arbitrary_origin(self):
        with patch.object(c, "admin_file") as controlled, patch.object(c.ssl, "create_default_context") as tls:
            gh = c.GitHub("mock-token")
        controlled.assert_called_once_with(c.SYSTEM_CA, "System CA bundle")
        tls.assert_called_once_with(cafile=str(c.SYSTEM_CA))
        gh.read = Mock(return_value={"value": "jwt"})
        for url in ("http://pipelines.actions.githubusercontent.com/test",
                    "https://pipelines.actions.githubusercontent.com.evil.invalid/test",
                    "https://attacker@pipelines.actions.githubusercontent.com/test",
                    "https://pipelines.actions.githubusercontent.com/test?audience=foo"):
            with self.subTest(url=url), self.assertRaises(c.Blocked):
                gh.request_token(url, "request-token")
        gh.read.assert_not_called()
        self.assertEqual(gh.request_token("https://pipelines.actions.githubusercontent.com/example", "request"), "jwt")


class ApprovalTests(TestCase):
    def setUp(self):
        self.run_path = "/actions/runs/" + RUN
        self.env_path = "/environments/stg-1a-runtime"
        self.policy = {"environment_id": ENV_ID, "reviewer_ids": [REVIEWER],
                       "workflow_sha": WORKFLOW_SHA, "candidate_sha": c.CANDIDATE,
                       "runner_label": "ubuntu-24.04", "ryuk_enabled": True, "ryuk_privileged": False,
                       "admin_bypass_disabled": True, "socket": str(c.SOCKET),
                       "cleanup": "ryuk-and-owned-inventory"}
        run = {"id": int(RUN), "run_attempt": 1, "head_sha": WORKFLOW_SHA,
               "head_branch": "main", "event": "workflow_dispatch", "path": c.WORKFLOW,
               "status": "in_progress", "repository": {"id": c.REPO_ID},
               "actor": {"id": ACTOR}, "triggering_actor": {"id": ACTOR}, "created_at": timestamp(-60)}
        self.rows = {
            self.run_path: run, self.run_path + "/attempts/1": deepcopy(run),
            self.run_path + "/attempts/1/jobs": {"total_count": 1, "jobs": [{
                "name": "verify", "head_sha": WORKFLOW_SHA, "run_id": int(RUN),
                "status": "in_progress", "run_attempt": 1, "labels": ["ubuntu-24.04"],
                "id": 1001, "runner_id": 1002, "runner_name": "GitHub Actions 1002"}]},
            self.run_path + "/approvals": [{
                "state": "approved", "environments": [{"id": ENV_ID}],
                "user": {"id": REVIEWER, "login": "reviewer"}}],
            self.env_path: {"id": ENV_ID, "name": c.ENVIRONMENT, "updated_at": timestamp(-120),
                            "deployment_branch_policy": {
                                "protected_branches": False, "custom_branch_policies": True},
                            "protection_rules": [{"type": "required_reviewers", "prevent_self_review": True,
                                                   "reviewers": [{"type": "User", "reviewer": {"id": REVIEWER}}]}]},
            self.env_path + "/deployment-branch-policies": {
                "total_count": 1, "branch_policies": [{"name": "main", "type": "branch"}]},
            self.env_path + "/variables/STG1A_RUNTIME_POLICY": {
                "name": "STG1A_RUNTIME_POLICY", "updated_at": timestamp(-100), "value": json.dumps(self.policy)},
            "/git/ref/heads/" + c.BRANCH: {
                "ref": "refs/heads/" + c.BRANCH, "object": {"type": "commit", "sha": c.CANDIDATE}},
            "/collaborators/reviewer/permission": {"permission": "write", "user": {"id": REVIEWER}},
        }

    def accept(self, **changes):
        return c.authorize(claims(**changes), self.rows.__getitem__, WORKFLOW_SHA, RUN, NOW)

    def test_exact_first_attempt_independent_approval(self):
        auth = self.accept()
        self.assertEqual((auth.reviewer_id, auth.run_id, auth.policy["candidate_sha"]),
                         (REVIEWER, RUN, c.CANDIDATE))

    def test_wrong_workflow_ref(self):
        with self.assertRaises(c.Blocked):
            self.accept(workflow_ref="different.yml")

    def test_wrong_workflow_sha(self):
        with self.assertRaises(c.Blocked):
            self.accept(workflow_sha="b" * 40)

    def test_wrong_repository_or_owner(self):
        for change in ({"repository_id": "8"}, {"repository_owner_id": "9"}):
            with self.subTest(change=change), self.assertRaises(c.Blocked):
                self.accept(**change)

    def test_wrong_environment(self):
        with self.assertRaises(c.Blocked):
            self.accept(environment="other")

    def test_wrong_run_or_attempt(self):
        for change in ({"run_id": "8"}, {"run_attempt": "2"}):
            with self.subTest(change=change), self.assertRaises(c.Blocked):
                self.accept(**change)

    def test_missing_approval(self):
        self.rows[self.run_path + "/approvals"] = []
        with self.assertRaises(c.Blocked):
            self.accept()

    def test_unprotected_environment(self):
        self.rows[self.env_path]["protection_rules"] = []
        with self.assertRaises(c.Blocked):
            self.accept()

    def test_cannot_accept_admin_bypass(self):
        self.rows["/collaborators/reviewer/permission"]["permission"] = "admin"
        with self.assertRaises(c.Blocked):
            self.accept()

    def test_self_approval_is_not_independent(self):
        self.rows[self.run_path + "/approvals"][0]["user"]["id"] = ACTOR
        with self.assertRaises(c.Blocked):
            self.accept()

    def test_rejected_or_ambiguous_review(self):
        history = self.rows[self.run_path + "/approvals"]
        history[0]["state"] = "rejected"
        with self.assertRaises(c.Blocked):
            self.accept()
        history.append(deepcopy(history[0]) | {"state": "approved"})
        with self.assertRaises(c.Blocked):
            self.accept()

    def test_changed_or_stale_policy(self):
        self.rows[self.env_path + "/variables/STG1A_RUNTIME_POLICY"]["updated_at"] = timestamp(-20)
        with self.assertRaises(c.Blocked):
            self.accept()

    def test_missing_api_permission_blocks(self):
        def denied(path):
            if path.endswith("/approvals"):
                raise c.Blocked("GitHub evidence unavailable (403)")
            return self.rows[path]
        with self.assertRaises(c.Blocked):
            c.authorize(claims(), denied, WORKFLOW_SHA, RUN, NOW)

    def test_forged_runner_environment_and_job_assignment(self):
        with self.assertRaises(c.Blocked):
            self.accept(runner_environment="self-hosted")
        self.rows[self.run_path + "/attempts/1/jobs"]["jobs"][0]["labels"] = ["self-hosted"]
        with patch.dict(c.os.environ, {"RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_RUN_ID": RUN}):
            with self.assertRaises(c.Blocked):
                self.accept()

    def test_unallowlisted_workflow_sha(self):
        self.policy["workflow_sha"] = "f" * 40
        self.rows[self.env_path + "/variables/STG1A_RUNTIME_POLICY"]["value"] = json.dumps(self.policy)
        with self.assertRaises(c.Blocked):
            self.accept()

    def test_policy_disables_ryuk_or_enables_privilege(self):
        for key, val in (("ryuk_enabled", False), ("ryuk_privileged", True)):
            with self.subTest(key=key):
                value = self.policy | {key: val}
                self.rows[self.env_path + "/variables/STG1A_RUNTIME_POLICY"]["value"] = json.dumps(value)
                with self.assertRaises(c.Blocked):
                    self.accept()

    def test_remote_wrong_candidate(self):
        self.rows["/git/ref/heads/" + c.BRANCH]["object"]["sha"] = "b" * 40
        with self.assertRaises(c.Blocked):
            self.accept()


class WorkloadTests(TestCase):
    def setUp(self):
        self.auth = c.Authorization(RUN, WORKFLOW_SHA, ENV_ID, REVIEWER, ACTOR, {})
        self.executor = Mock(return_value=(0, ""))
        self.cmd = c.Commands(self.auth, Path("/fake/home"), Path("/fake/java"), Path("/fake/root"),
                              executor=self.executor)

    def test_unapproved_maven_never_executes(self):
        self.cmd.auth = None
        with self.assertRaises(c.Blocked):
            self.cmd.maven(c.MAVEN)
        self.executor.assert_not_called()

    def test_unapproved_docker_never_executes(self):
        self.cmd.auth = None
        with self.assertRaises(c.Blocked):
            self.cmd.docker("info")
        self.executor.assert_not_called()

    def test_caller_authorization_markers_cannot_open_main(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(c.os.environ, {
            "RUNNER_TEMP": tmp, "GITHUB_ACTIONS": "true", "GITHUB_RUN_ID": RUN,
            "STG1A_PLATFORM_APPROVED": "true", "TESTCONTAINERS_RYUK_DISABLED": "true",
        }, clear=True), patch.object(c, "execute", self.executor):
            self.assertEqual(c.main(), 1)
            data = json.loads((Path(tmp)/"stg-1a-evidence/result.json").read_bytes())
            self.assertEqual(data["stages"], {})
            self.assertEqual(data["verdict"], "RUNTIME VERIFICATION BLOCKED")
        self.executor.assert_not_called()

    def test_prohibited_docker_operations_and_maven_options(self):
        for args in (("run",), ("system", "prune"), ("create", "--privileged"),
                     ("create", "--network=host"), ("create", "--mount=type=bind"),
                     ("create", "-v", "/:/root"), ("create", "--pid=host"),
                     ("network", "create", "--driver=host"), ("image", "prune"),
                     ("create", "--cap-add=SYS_ADMIN"), ("buildx", "create")):
            with self.subTest(args=args), self.assertRaises(c.Blocked):
                self.cmd.docker(*args)
        with self.assertRaises(c.Blocked):
            self.cmd.maven(("./mvnw", "-DskipTests", "verify"))
        self.executor.assert_not_called()

    def test_workload_drops_tokens_and_privilege_overrides(self):
        with patch.dict(c.os.environ, {"GITHUB_TOKEN": "secret",
                                     "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "secret",
                                     "STG1A_REVIEW_TOKEN": "secret",
                                     "TESTCONTAINERS_RYUK_DISABLED": "true",
                                     "TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED": "true"}):
            self.cmd.maven(c.MAVEN)
        argv, _, env, _ = self.executor.call_args.args
        self.assertEqual(argv[-len(c.MAVEN):], list(c.MAVEN))
        self.assertNotIn("secret", repr(self.executor.call_args))
        self.assertNotIn("TESTCONTAINERS_RYUK_DISABLED", repr(self.executor.call_args))
        self.assertIn("TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED=false", argv)
        self.assertEqual(env, {"PATH": "/usr/bin:/bin"})
        self.assertIn("-i", argv)

    def test_insufficient_disk_or_inodes_and_shared_mount_sum(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            limits = {"a": {"bytes": 5, "inodes": 5}, "b": {"bytes": 5, "inodes": 5}}
            for free_bytes, free_inodes in ((10, 15), (15, 10), (11, 11)):
                measure = lambda _: SimpleNamespace(f_bavail=free_bytes, f_frsize=1, f_favail=free_inodes)
                rows = c.capacity({"a": p, "b": p}, limits, {"bytes": 1, "inodes": 1}, measure)
                self.assertEqual((len(rows), rows[0]["required_bytes"], rows[0]["required_inodes"]), (1, 11, 11))
                if (free_bytes, free_inodes) == (11, 11):
                    c.check_capacity(rows)
                else:
                    with self.assertRaises(c.Blocked):
                        c.check_capacity(rows)

    def test_unknown_storage_blocks(self):
        with self.assertRaises(c.Blocked):
            c.capacity({"a": Path("/tmp")}, {}, {"bytes": 1, "inodes": 1})

    def test_candidate_valid_wrong_sha_dirty_or_attached(self):
        answers = {("rev-parse", "HEAD"): c.CANDIDATE, ("rev-parse", "--abbrev-ref", "HEAD"): "HEAD",
                   ("status", "--porcelain", "--untracked-files=all"): "",
                   ("remote", "get-url", "origin"): "https://github.com/" + c.REPO}
        c.validate_checkout(Path("/fake"), lambda *keys: answers[keys])
        for key, val in ((("rev-parse", "HEAD"), "b" * 40),
                         (("rev-parse", "--abbrev-ref", "HEAD"), "main"),
                         (("status", "--porcelain", "--untracked-files=all"), "?? unexpected")):
            with self.subTest(key=key), self.assertRaises(c.Blocked):
                c.validate_checkout(Path("/fake"), lambda *keys: (answers | {key: val})[keys])

    def test_cleanup_refuses_unowned_and_unsafe_ids(self):
        inv = c.Inventory(self.cmd, RUN)
        with self.assertRaises(c.Blocked):
            inv.add("container", "somebody-elses-name")
        identity = "a" * 64
        inv.add("container", identity)
        row = {"Id": identity, "Config": {"Labels": {"com.sourceos.stg1a.run": "different"}}}
        self.executor.return_value = 0, json.dumps([row])
        with self.assertRaises(c.Blocked):
            inv.cleanup()
        self.assertEqual(self.executor.call_count, 1)

    def test_cleanup_safe_with_empty_inventory(self):
        c.Inventory(self.cmd, RUN).cleanup()
        self.executor.assert_not_called()

    def test_cleanup_verifies_removal(self):
        inv = c.Inventory(self.cmd, RUN)
        identity = inv.add("container", "a" * 64)
        row = {"Id": identity, "Config": {"Labels": {"com.sourceos.stg1a.run": RUN}}}
        self.executor.side_effect = [(0, json.dumps([row])), (0, ""), (1, "No such container")]
        self.assertEqual(inv.cleanup()["verified_owned_resources"], 1)

    def test_evidence_hash_and_false_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            data = {"stages": {}, "blockers": []}
            with self.assertRaises(c.Blocked):
                c.finish_evidence(out, data, True)
            c.finish_evidence(out, data, False)
            (out / "result.json").write_text("tampered")
            with self.assertRaises(c.Blocked):
                c.verify_evidence(out)

    def test_all_stages_and_cross_checked_evidence_required_for_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            stages = {name: {"passed": True} for name in c.STAGES}
            evidence = {"stages": stages, "blockers": [], "candidate_sha": c.CANDIDATE,
                        "controller_sha": WORKFLOW_SHA, "attempt": 1, "reviewer_id": REVIEWER,
                        "environment_id": ENV_ID, "run_id": RUN, "approval_ref": "/approvals",
                        "capacity_samples": {"start": [1], "export": [1]}, "capacity_peak": [1]}
            with self.assertRaises(c.Blocked):
                c.finish_evidence(out, evidence, True)
            jar = "a" * 64
            stages["maven"] |= {"tests": 59, "suites": 40, "failures": 0, "errors": 0, "skipped": 0,
                                "ryuk_privileged": False, "ryuk_cleanup_verified": True, "sha256": jar}
            stages["image"] |= {"packaged_jar_sha256": "b" * 64, "oci_manifest": "sha256:" + "b" * 64,
                                "runtime_id": "sha256:" + "c" * 64, "uid": 10001, "gid": 10001}
            stages["postgres"] |= {"migrations": 23}
            stages["readiness"] |= {"healthy": 200, "database_disconnected": 503,
                                    "liveness_after_disconnect": 200}
            stages["configuration"] |= {"cases": ["db", "issuer", "audience", "cors"],
                                        "unauthenticated": 401, "development_header": 401, "local_profile": False}
            stages["shutdown"] |= {"exit_code": 143, "oom": False}
            stages["cleanup"] |= {"verified_owned_resources": 12}
            with self.assertRaises(c.Blocked):
                c.finish_evidence(out, evidence, True)
            stages["image"]["packaged_jar_sha256"] = jar
            c.finish_evidence(out, evidence, True)
            c.verify_evidence(out)
            self.assertEqual(evidence["verdict"], "RUNTIME VERIFIED")

    def test_storage_low_water_retains_concurrent_peaks(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            def measure(n, i):
                return SimpleNamespace(f_bavail=n, f_frsize=1, f_favail=i)
            samples = Mock(side_effect=[measure(20, 15), measure(9, 8), measure(19, 14)])
            monitor = c.StorageMonitor({"workspace": path}, {"bytes": 10, "inodes": 2}, samples)
            monitor.start()
            monitor.sample()
            row, = monitor.finish()
            self.assertTrue(monitor.failed)
            self.assertEqual(row["peak_growth"], {"bytes": 11, "inodes": 7})

    def test_actual_ryuk_inspection_rejects_privilege_or_extra_socket_mount(self):
        approvals = {"Privileged": False, "NetworkMode": "default",
                     "Binds": [str(c.SOCKET) + ":/var/run/docker.sock:rw"]}
        details = {"HostConfig": approvals, "State": {"Running": True}}
        self.assertTrue(c.validate_ryuk(details))
        for change in ({"Privileged": True}, {"NetworkMode": "host"},
                       {"Binds": approvals["Binds"] + ["/:/host"]},
                       {"Mounts": [{"Source": "/private"}]}, {"CapAdd": ["SYS_ADMIN"]}):
            with self.subTest(change=change), self.assertRaises(c.Blocked):
                c.validate_ryuk(details | {"HostConfig": approvals | change})

    def test_hash_of_tracked_git_object_rejects_substitution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracked = root / "tracked"
            tracked.write_text("fixed content")
            blob = c.hashlib.sha1(b"blob 13\0fixed content", usedforsecurity=False).hexdigest()
            listing = f"100644 blob {blob}\ttracked\0"
            self.assertIn("tracked", c.source_bytes(root, listing))
            tracked.write_text("other content")
            with self.assertRaises(c.Blocked):
                c.source_bytes(root, listing)

    def test_profile_hash_and_authorizer_policy_are_both_required(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(c, "admin_file"):
            root = Path(tmp)
            profile, policy_file = root / "profile.json", root / "policy.json"
            policy_file.write_text('{"test":"docker authorizer policy"}')
            body = {"schema": 1, "workload_user": c.USER, "socket": str(c.SOCKET),
                    "docker_authorizer": "stg-policy", "docker_policy_sha256": c.sha256(policy_file)}
            profile.write_text(json.dumps(body))
            policy = {"profile_sha256": c.sha256(profile)}
            self.assertEqual(c.load_profile(policy, profile, policy_file), body)
            policy_file.write_text("{}")
            with self.assertRaises(c.Blocked):
                c.load_profile(policy, profile, policy_file)

    def test_oci_manifest_and_config_digest_independent(self):
        def encode(value):
            data = json.dumps(value).encode()
            return data, "sha256:" + c.hashlib.sha256(data).hexdigest()
        config, image_id = encode({"architecture": "amd64", "os": "linux"})
        manifest, digest = encode({"config": {"digest": image_id}})
        index, _ = encode({"manifests": [{"digest": digest}]})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"fixture.tar"
            def write(config_bytes):
                with tarfile.open(path, "w") as archive:
                    for name, data in (("index.json", index), ("blobs/sha256/" + digest[7:], manifest),
                                       ("blobs/sha256/" + image_id[7:], config_bytes)):
                        member = tarfile.TarInfo(name)
                        member.size = len(data)
                        archive.addfile(member, io.BytesIO(data))
            write(config)
            self.assertEqual(c.oci_identity(path), (digest, image_id))
            write(config + b"x")
            with self.assertRaises(c.Blocked):
                c.oci_identity(path)


if __name__ == "__main__":
    main()
