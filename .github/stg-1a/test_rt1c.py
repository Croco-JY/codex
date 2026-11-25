"""Focused offline tests of the corrected controller boundaries."""
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

import controller as c
import test_controller as original


def socket_mount():
    return {"Type": "bind", "Source": str(c.SOCKET), "Destination": "/var/run/docker.sock", "RW": True}


class CorrectionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_git_configuration_rejected_before_process(self):
        metadata = self.root / ".git"
        metadata.mkdir()
        for content in ("[core]\nfsmonitor = /unused/helper", "[include]\npath = elsewhere",
                        "[filter \"sample\"]\nclean = /unused/filter", "[core]\nworktree = elsewhere"):
            (metadata / "config").write_text(content)
            with self.subTest(content=content), patch.object(c, "execute") as spy:
                with self.assertRaises(c.Blocked):
                    c.git_at(self.root, "status", "--porcelain", "--untracked-files=all")
                spy.assert_not_called()

    def test_confined_files(self):
        output = self.root / "target"
        output.mkdir()
        for name in ("api.jar", "report.xml", "report.txt"):
            (output / name).symlink_to(self.root / "outside")
            (self.root / "outside").write_bytes(b"outside")
            with self.assertRaises(c.Blocked):
                with c.confined(self.root, "target/" + name):
                    self.fail("external proof")
        (output / "reports").symlink_to(self.root)
        with self.assertRaises(c.Blocked):
            with c.confined(self.root, "target/reports/outside"):
                self.fail("nested redirection")

    def test_final_receipt_rejects_substitution(self):
        fixture = original.ApprovalTests()
        fixture.setUp()
        record = c.AuthorizedEvidence(fixture.accept(), {"stages": {}, "blockers": []})
        for field, value in (("attempt", 2), ("candidate_sha", "f" * 40), ("repository_id", 1),
                             ("policy_sha256", ""), ("reviewer_id", 55), ("approval_ref", "/elsewhere")):
            with self.subTest(field=field), patch.dict(record, {field: value}):
                with self.assertRaisesRegex(c.Blocked, "Final receipt"):
                    c.finish_evidence(self.root, record, True)

    def test_real_expiry_and_frozen_jar(self):
        api = self.root / "apps/api"
        package = api / "src/test/java/com/sourceos"
        package.mkdir(parents=True)
        (package / "PatternReleaseExpiryTest.java").touch()
        target = api / "target"
        reports = target / "surefire-reports"
        reports.mkdir(parents=True)
        db = target / "pattern-release-evidence"
        db.mkdir()
        proof = db / "expiry-real-15-minute-lock-wait.json"
        receipt = dict(consentIssued="2026-01-01T00:00:00Z", consentDeadline="2026-01-01T00:15:00Z",
                       transactionStarted="2026-01-01T00:14:59Z", lockReleased="2026-01-01T00:15:00Z",
                       result=409, partialReleaseRows=0, writerPid=1, blockingPid=2,
                       consumedConsentExpiredButReleaseStillAccessible=True)
        proof.write_text(json.dumps(receipt))
        case = f'<testcase name="{c.EXPIRY_CASE}" classname="{c.EXPIRY_CLASS}" time="901"/>'
        def report(body):
            (reports / "TEST-expiry.xml").write_text(
                f'<testsuite name="{c.EXPIRY_CLASS}" tests="1" failures="0" errors="0" skipped="0">{body}</testsuite>')
        report(case)
        with zipfile.ZipFile(api / c.JAR, "w") as jar:
            jar.writestr("META-INF/MANIFEST.MF", "Main-Class: org.springframework.boot.loader.launch.JarLauncher\n"
                         "Start-Class: com.sourceos.SourceOsApplication\n")
            jar.writestr("BOOT-INF/lib/test.jar", b"synthetic")
            jar.writestr("BOOT-INF/classes/com/sourceos/SourceOsApplication.class", bytes.fromhex("cafebabe00000045"))
        context = self.root / "context"
        (context / "target").mkdir(parents=True)
        data = c.jar_provenance(self.root, "25", "3.9.11", context)
        self.assertEqual(c.sha256(context / c.JAR), data["sha256"])
        self.assertEqual(data["expiry"]["seconds"], 901)
        for invalid in ("", case * 2, case.replace(c.EXPIRY_CASE, "similar"),
                        case.replace("/>", "><skipped/></testcase>"), case.replace("/>", ' disabled="true"/>'),
                        case.replace("901", "3"), case.replace("901", "NaN")):
            report(invalid)
            with self.subTest(body=invalid), self.assertRaises(c.Blocked):
                c.jar_provenance(self.root, "25", "3.9.11")
        report(case)
        proof.write_text(json.dumps(receipt | {"lockReleased": receipt["transactionStarted"]}))
        with self.assertRaises(c.Blocked):
            c.jar_provenance(self.root, "25", "3.9.11")

    def test_volume_cleanup(self):
        cid, volume = "a" * 64, "owned-volume"
        labels = {"com.sourceos.stg1a.run": "session"}
        for owner, residue in ((labels, False), (labels, True), ({}, False), (None, False)):
            with self.subTest(owner=owner, residue=residue):
                commands = Mock()
                def found(row):
                    return 0, json.dumps([row])
                commands.docker.side_effect = [
                    found({"Id": cid, "Config": {"Labels": labels}, "Mounts": [{"Type": "volume", "Name": volume}]}),
                    (0, ""), (1, "No such container"), found({"Name": volume, "Labels": owner})]
                if owner:
                    commands.docker.side_effect = list(commands.docker.side_effect) + [
                        (0, ""), found({"Name": volume, "Labels": owner}) if residue else (1, "No such volume")]
                inv = c.Inventory(commands, "session")
                inv.add("container", cid)
                if owner and not residue:
                    self.assertEqual(inv.cleanup()["verified_owned_resources"], 2)
                else:
                    with self.assertRaises(c.Blocked): inv.cleanup()
                removal = [call for call in commands.docker.call_args_list if call.args[:2] == ("volume", "rm")]
                self.assertEqual(bool(removal), bool(owner))

    def test_mixed_cleanup_continues(self):
        owned, unknown = "a" * 64, "b" * 64
        commands = Mock()
        def docker(*args, **kwargs):
            if args[0] == "rm":
                self.assertEqual(args[-1], owned)
                return 0, ""
            if commands.docker.call_count == 4:
                return 1, "No such container"
            return 0, json.dumps([{"Id": args[-1], "Mounts": [], "Config": {
                "Labels": {"com.sourceos.stg1a.run": "session" if args[-1] == owned else "foreign"}}}])
        commands.docker.side_effect = docker
        inv = c.Inventory(commands, "session")
        inv.add("container", owned)
        inv.add("container", unknown)
        with self.assertRaisesRegex(c.Blocked, unknown): inv.cleanup()
        self.assertEqual(commands.docker.call_count, 4)

    def test_capacity_on_actual_destinations(self):
        scratch = self.root / "scratch"
        scratch.mkdir()
        alias = self.root / "alias"
        alias.symlink_to(scratch)
        reserve = {"bytes": 2, "inodes": 2}
        budgets = {"scratch": reserve, "docker": reserve}
        def sample(path):
            return SimpleNamespace(f_bavail=1 if path == Path("/dev/shm") else 100,
                                   f_frsize=1, f_favail=100)
        with self.assertRaises(c.Blocked):
            c.capacity({"scratch": alias, "docker": self.root}, budgets, reserve, sample)
        paths = {"scratch": scratch, "docker": Path("/dev/shm")}
        rows = c.capacity(paths, budgets, reserve, sample)
        self.assertEqual(len(rows), 2)
        with self.assertRaises(c.Blocked): c.check_capacity(rows)

    def test_ryuk_observation_lifecycle(self):
        import threading
        identity = "a" * 64
        for sequence, image, expected in (([None, False, True, True], "testcontainers/ryuk:0.14.0", True),
                                          ([None, None], "", False),
                                          ([True, True, False], "testcontainers/ryuk:0.14.0", False),
                                          ([True, True], "other", False)):
            timer = Mock()
            timer.is_set.side_effect = [False] * len(sequence) + [True]
            worker = Mock()
            worker.is_alive.return_value = False
            def thread(target, daemon):
                worker.start.side_effect = target
                return worker
            cmd = Mock()
            states = iter(sequence)
            current = None
            def docker(*args, **kwargs):
                nonlocal current
                if "--no-trunc" in args:
                    current = next(states)
                    return 0, identity if current is not None else ""
                if args[0] == "inspect":
                    row = {"Id": identity, "Name": "/testcontainers-ryuk-fixture", "Config": {"Image": image},
                           "HostConfig": {"Privileged": False, "NetworkMode": "bridge",
                                          "Binds": [str(c.SOCKET) + ":/var/run/docker.sock"]},
                           "Mounts": [socket_mount()], "State": {"Running": current}}
                    return 0, json.dumps([row])
                return 0, ""
            cmd.docker.side_effect = docker
            with self.subTest(sequence=sequence, image=image), patch.object(threading, "Thread", thread), \
                    patch.object(threading, "Event", return_value=timer):
                if expected: c.monitor_maven(cmd)
                else:
                    with self.assertRaises(c.Blocked): c.monitor_maven(cmd)


class FinalThreeTests(unittest.TestCase):
    def test_absence_requires_unambiguous_daemon_response(self):
        commands = Mock()
        inv = c.Inventory(commands, "run")
        name = "session-data"
        commands.docker.return_value = (1, "[]\nError: No such volume: session-data")
        self.assertIsNone(inv.inspect("volume", name))
        for response in ((0, "[null]"), (0, ""), (0, "[]"), (0, "{}"), (0, "broken"),
                         (0, "[{}, {}]"), (1, "permission denied: No such volume"),
                         (1, "Error: No such volume: another"), (1, "transport error")):
            commands.docker.return_value = response
            with self.subTest(response=response), self.assertRaises(c.Blocked):
                inv.inspect("volume", name)

    def test_invalid_ownership_never_removes(self):
        commands = Mock()
        inv = c.Inventory(commands, "run")
        inv.add("volume", "session-data")
        for row in ({}, {"Name": "session-data", "Labels": ["invalid"]},
                    {"Name": "other", "Labels": {"com.sourceos.stg1a.run": "run"}}):
            commands.docker.reset_mock()
            commands.docker.return_value = (0, json.dumps([row]))
            with self.subTest(row=row), self.assertRaises(c.Blocked):
                inv.cleanup()
            commands.docker.assert_called_once_with("inspect", "--type=volume", "session-data",
                                                    allow_failure=True)

    def test_separate_devices_and_phase_peaks(self):
        paths = {"scratch": Path("/tmp"), "docker": Path("/dev/shm")}
        free = {"scratch": 1000, "docker": 500}
        def measure(path):
            value = free["scratch" if path == paths["scratch"] else "docker"]
            return SimpleNamespace(f_bavail=value, f_frsize=1, f_favail=value)
        monitor = c.StorageMonitor(paths, {"bytes": 1, "inodes": 1}, measure)
        monitor.start()
        try:
            free.update(scratch=400, docker=480)
            monitor.sample("maven")
            free.update(scratch=850, docker=350)
            monitor.sample("image")
        finally:
            rows = monitor.finish()
        by_path = {row["paths"][0]: row for row in rows}
        self.assertEqual(by_path["scratch"]["peak_growth"]["bytes"], 600)
        self.assertEqual(by_path["docker"]["peak_growth"]["bytes"], 150)
        self.assertEqual(by_path["scratch"]["final"]["bytes"], 850)
        self.assertEqual(by_path["scratch"]["phase_low_water"]["image"]["bytes"], 850)
        self.assertFalse(monitor.worker.is_alive())

    def test_measurement_gap_invalidates_peak(self):
        good = SimpleNamespace(f_bavail=100, f_frsize=1, f_favail=20)
        measure = Mock(side_effect=[good, OSError("fixture"), good])
        monitor = c.StorageMonitor({"scratch": Path("/tmp")}, {"bytes": 1, "inodes": 1}, measure)
        monitor.start()
        with self.assertRaises(OSError):
            monitor.sample("maven")
        with self.assertRaisesRegex(c.Blocked, "unavailable"):
            monitor.finish()
        self.assertTrue(monitor.failed)
        self.assertFalse(monitor.worker.is_alive())
        self.assertIn("maven/scratch: OSError", monitor.errors)

    def test_ryuk_teardown_checks_exact_identity_after_completion(self):
        import threading
        identity = "1" * 64
        for fault in ("none", "timeout", "missing", "still-present"):
            with self.subTest(fault=fault):
                timer = Mock()
                timer.is_set.side_effect = [False, False, False, True]
                worker = Mock()
                worker.is_alive.return_value = False
                def thread(target, daemon):
                    worker.start.side_effect = target
                    return worker
                commands = Mock()
                samples = []
                completed = []
                commands.maven.side_effect = lambda argv: completed.append(True)
                def docker(*args, **kwargs):
                    if "--no-trunc" in args:
                        if fault == "missing" and len(samples) == 2:
                            return 0, ""
                        return 0, identity
                    if args[0] == "inspect":
                        samples.append(True)
                        if fault == "timeout" and len(samples) == 3:
                            raise TimeoutError("fixture")
                        row = {"Id": identity, "Name": "/testcontainers-ryuk-session",
                               "Config": {"Image": "testcontainers/ryuk:0.14.0"},
                               "HostConfig": {"Privileged": False, "NetworkMode": "bridge",
                                              "Binds": [str(c.SOCKET) + ":/var/run/docker.sock"]},
                               "Mounts": [socket_mount()], "State": {"Running": True}}
                        return 0, json.dumps([row])
                    if "--filter=id=" + identity in args:
                        self.assertEqual(completed, [True])
                        return 0, identity if fault == "still-present" else ""
                    return 0, ""
                commands.docker.side_effect = docker
                with patch.object(threading, "Thread", thread), patch.object(threading, "Event", return_value=timer):
                    if fault == "none":
                        c.monitor_maven(commands)
                        commands.docker.assert_called_with("ps", "-aq", "--filter=id=" + identity, limit=10)
                    else:
                        with self.assertRaises(c.Blocked):
                            c.monitor_maven(commands)


class FinalTwoTests(unittest.TestCase):
    def test_prior_inventory_survives_container_loss(self):
        identity = "1" * 64
        anonymous = "a" * 64
        labels = {"com.sourceos.stg1a.run": "session"}
        mounts = [{"Type": "volume", "Name": name} for name in ("named", anonymous)]
        row = {"Id": identity, "Config": {"Labels": labels}, "Mounts": mounts}
        for owner in (labels, {}, None):
            with self.subTest(owner=owner):
                cmd = Mock()
                inv = c.Inventory(cmd, "session")
                cmd.docker.return_value = (0, json.dumps([row]))
                inv.track_created(identity)
                self.assertEqual(set(inv.resources), {("container", identity), ("volume", "named"),
                                                      ("volume", anonymous)})
                volumes = {anonymous: labels, "named": owner}
                checked_absent = []
                def docker(*args, **kwargs):
                    name = args[-1]
                    if args[:2] == ("inspect", "--type=container"):
                        return 1, "No such container: " + identity
                    if args[:2] == ("volume", "rm"):
                        self.assertEqual(volumes[name], labels)
                        del volumes[name]
                        return 0, ""
                    self.assertEqual(args[:2], ("inspect", "--type=volume"))
                    if name in volumes:
                        return 0, json.dumps([{"Name": name, "Labels": volumes[name]}])
                    checked_absent.append(name)
                    return 1, "No such volume: " + name
                cmd.docker.side_effect = docker
                if owner == labels:
                    self.assertTrue(inv.cleanup()["passed"])
                    self.assertCountEqual(checked_absent, ["named", anonymous])
                    self.assertEqual(volumes, {})
                else:
                    with self.assertRaisesRegex(c.Blocked, "volume named"):
                        inv.cleanup()
                    self.assertEqual(volumes, {"named": owner})
                    self.assertEqual(checked_absent, [anonymous])

    def test_unknown_inventory_blocks_absent_container(self):
        cmd = Mock()
        identity = "2" * 64
        inv = c.Inventory(cmd, "session")
        cmd.docker.return_value = (1, "No such container: " + identity)
        with self.assertRaises(c.Blocked):
            inv.track_created(identity)
        with self.assertRaisesRegex(c.Blocked, "unresolved attachment inventory"):
            inv.cleanup()

    def test_inventory_must_be_complete_and_consistent_before_removal(self):
        cmd = Mock()
        identity = "3" * 64
        row = {"Id": identity, "Config": {"Labels": {"com.sourceos.stg1a.run": "session"}}}
        for changed in (None, [{"Type": "volume"}], [{"Type": "volume", "Name": "different"}]):
            with self.subTest(changed=changed):
                inv = c.Inventory(cmd, "session")
                cmd.docker.reset_mock()
                cmd.docker.side_effect = [(0, json.dumps([row | {"Mounts": mounts}]))
                                          for mounts in ([], changed)]
                inv.track_created(identity)
                with self.assertRaises(c.Blocked):
                    inv.remove("container", identity)
                self.assertEqual([call.args[0] for call in cmd.docker.call_args_list],
                                 ["inspect", "inspect"])

    def test_effective_socket_allowlist(self):
        mount = socket_mount()
        host = {"Privileged": False, "NetworkMode": "bridge",
                "Binds": [str(c.SOCKET) + ":/var/run/docker.sock:rw"]}
        row = {"State": {"Running": True}, "HostConfig": host}
        for inherited in (None, []):
            self.assertTrue(c.validate_ryuk(row | {"HostConfig": host | {"VolumesFrom": inherited},
                                                   "Mounts": [mount]}))
        for evidence in ({}, {"Mounts": None}, {"Mounts": []}, {"Mounts": [mount, mount]},
                         {"Mounts": [mount, mount | {"Type": "volume", "Name": "extra"}]},
                         *({"Mounts": [mount | change]} for change in (
                             {"Type": "volume"}, {"Source": "/other"}, {"Destination": "/other"},
                             {"RW": False}, {"Mode": "ro"})),
                         *({"Mounts": [mount], "HostConfig": host | change} for change in (
                             {"VolumesFrom": ["inherited"]}, {"Mounts": [{"Type": "volume"}]},
                             {"Binds": []}, {"Privileged": True}))):
            with self.subTest(evidence=evidence), self.assertRaises(c.Blocked):
                c.validate_ryuk(row | evidence)


class ObserverTests(unittest.TestCase):
    """Run the production observer thread. All daemon and workload replies are local."""
    def run_session(self, fault=None):
        import threading

        identity = "a" * 64
        row = {"Id": identity, "Name": "/testcontainers-ryuk-fixture",
               "Config": {"Image": "testcontainers/ryuk:0.14.0"},
               "State": {"Running": True}, "Mounts": [socket_mount()],
               "HostConfig": {"NetworkMode": "bridge", "Privileged": False,
                              "Binds": [str(c.SOCKET) + ":/var/run/docker.sock"]}}
        third = threading.Event()
        release = threading.Event()
        exited = threading.Event()
        threads = []
        teardown = []
        samples = []
        joined = []

        class Worker(threading.Thread):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                threads.append(self)

            def run(self):
                try:
                    super().run()
                finally:
                    exited.set()

            def join(self, timeout=None):
                joined.append(timeout)
                if fault != "join timeout":
                    release.set()
                super().join(0 if fault == "join timeout" else timeout)

        def docker(*args, **kwargs):
            if "--no-trunc" in args:
                return 0, identity
            if args[0] != "inspect":
                # The all-states, immutable-ID query is the last teardown checkpoint.
                teardown.append(args)
                return 0, ""
            samples.append(identity)
            if len(samples) == 3:
                third.set()
                if fault in ("join timeout", "shutdown decoder"):
                    self.assertTrue(release.wait(8))
                if fault == "no acknowledgment":
                    raise SystemExit()
                if fault == "denial":
                    return 1, "sensitive daemon message"
                if fault == "inherited":
                    row["HostConfig"]["VolumesFrom"] = ["other"]
                if fault == "disappearance":
                    row["Id"] = "b" * 64
                if fault in ("recursive decoder", "other decoder", "shutdown decoder"):
                    return 0, "decoder fixture"
            return 0, json.dumps([row])

        def maven(args):
            self.assertEqual(args, c.MAVEN)
            self.assertTrue(third.wait(8))
            if fault == "maven":
                raise c.Blocked("Maven fixture failed")
            if fault in ("recursive decoder", "other decoder", "denial", "no acknowledgment",
                         "inherited", "disappearance"):
                self.assertTrue(exited.wait(8))

        decode = json.loads
        def parse(text):
            if text == "decoder fixture":
                if fault == "recursive decoder":
                    raise RecursionError("sensitive decoder message")
                raise RuntimeError("sensitive decoder message")
            return decode(text)

        cmd = Mock()
        cmd.docker.side_effect = docker
        cmd.maven.side_effect = maven
        try:
            with patch.object(threading, "Thread", Worker), patch.object(json, "loads", parse):
                if fault is None:
                    c.monitor_maven(cmd)
                    self.assertEqual(teardown[-1], ("ps", "-aq", "--filter=id=" + identity))
                else:
                    with self.assertRaises(c.Blocked) as failure:
                        c.monitor_maven(cmd)
                    expected = {"join timeout": "within the deadline", "maven": "Maven fixture failed",
                                "no acknowledgment": "abnormal exit"}.get(fault, "inspection failed")
                    self.assertIn(expected, str(failure.exception))
                    self.assertNotIn("sensitive", str(failure.exception))
                    self.assertEqual(teardown, [])
            cmd.maven.assert_called_once()
            self.assertEqual(joined, [20])
            self.assertGreaterEqual(len(samples), 3)
        finally:
            release.set()
            for worker in threads:
                threading.Thread.join(worker, 8)
                self.assertFalse(worker.is_alive())

    def test_normal_completion_and_exact_teardown(self):
        self.run_session()

    def test_recursion_after_healthy_samples(self):
        self.run_session("recursive decoder")

    def test_other_decoder_failure_before_workload_completion(self):
        self.run_session("other decoder")

    def test_abnormal_exit_without_acknowledgment(self):
        self.run_session("no acknowledgment")

    def test_observer_still_alive_at_join_deadline(self):
        self.run_session("join timeout")

    def test_denial_cannot_be_overridden_by_empty_teardown(self):
        self.run_session("denial")

    def test_maven_failure_joins_worker(self):
        self.run_session("maven")

    def test_shutdown_race_rejects_inflight_decoder_failure(self):
        self.run_session("shutdown decoder")

    def test_inherited_mount_is_rejected_during_workload(self):
        self.run_session("inherited")

    def test_unverifiable_identity_is_rejected(self):
        self.run_session("disappearance")

    def test_sessions_do_not_share_terminal_state(self):
        self.run_session()
        self.run_session("denial")
        self.run_session()


class CleanupIsolationTests(unittest.TestCase):
    def setUp(self):
        self.names = ["alpha", "bravo", "charlie"]
        self.present = dict.fromkeys(self.names)
        self.removals = []
        self.absent = []
        self.scans = []
        self.report = {}

    def run_cleanup(self, faults, *, final_fault=None):
        # Discovery lists all three initially; the production loop visits them in reverse.
        def docker(*args, **kwargs):
            if args[0] == "ps" or args[1] == "ls":
                kind = "container" if args[0] == "ps" else args[0]
                self.scans.append(kind)
                if kind == "volume":
                    if len(self.scans) == 8 and final_fault:
                        raise final_fault
                    return 0, "\n".join(self.present)
                return 0, ""
            name = args[-1]
            fault = faults.get(name)
            if args[:2] == ("volume", "rm"):
                self.removals.append(name)
                if fault == "removal":
                    raise RuntimeError("private daemon response")
                del self.present[name]
                return 0, ""
            if args[:2] != ("inspect", "--type=volume"):
                raise AssertionError("Unexpected fixture operation")
            if name not in self.present:
                if fault == "reinspect":
                    raise RecursionError("private post-removal response")
                self.absent.append(name)
                return 1, "No such volume: " + name
            if fault == "malformed":
                return 0, "[null]"
            if isinstance(fault, type):
                return 0, name  # Inject a decoder error for only this inspection.
            row = {"Name": name}
            if fault != "ownership":
                row["Labels"] = {"com.sourceos.stg1a.run": "run"}
            return 0, json.dumps([row])

        original_loads = json.loads
        def decode(text):
            error = faults.get(text)
            if isinstance(error, type):
                raise error("private decoder response")
            return original_loads(text)

        commands = Mock()
        commands.docker.side_effect = docker
        inventory = c.Inventory(commands, "run")
        with patch.object(json, "loads", decode):
            if faults or final_fault:
                with self.assertRaises(c.Blocked) as failure:
                    inventory.cleanup_session(self.report)
                self.assertFalse(self.report["passed"])
                self.assertNotIn("verified_owned_resources", self.report)
                self.assertNotIn("private", str(failure.exception) + json.dumps(self.report))
            else:
                result = inventory.cleanup_session(self.report)
                self.assertTrue(result["passed"])
                self.assertEqual(result["verified_owned_resources"], 3)
        healthy = set(self.names) - faults.keys()
        expected_removals = healthy | {name for name, fault in faults.items()
                                      if fault in ("removal", "reinspect")}
        self.assertCountEqual(self.removals, expected_removals)
        self.assertCountEqual(self.absent, healthy)
        self.assertEqual(self.scans, ["container", "network", "image", "volume"] * 2)
        self.assertEqual({r["identity"]: r["status"] for r in self.report["resources"]},
                         {name: "confirmed_absent" if name in healthy else "unresolved"
                          for name in self.names})
        self.assertCountEqual([r["identity"] for r in self.report["residual"]],
                              [] if final_fault else self.present.keys())
        self.assertEqual(self.report["scans_failed"],
                         [{"phase": "final", "kind": "volume"}] if final_fault else [])

    def test_depth_error_first(self):
        self.run_cleanup({"charlie": RecursionError})

    def test_depth_error_second(self):
        self.run_cleanup({"bravo": RecursionError})

    def test_malformed_row(self):
        self.run_cleanup({"bravo": "malformed"})

    def test_value_error(self):
        self.run_cleanup({"charlie": ValueError})

    def test_missing_ownership(self):
        self.run_cleanup({"charlie": "ownership"})

    def test_failed_removal(self):
        self.run_cleanup({"charlie": "removal"})

    def test_failed_absence_verification(self):
        self.run_cleanup({"charlie": "reinspect"})

    def test_multiple_failures(self):
        self.run_cleanup({"charlie": RuntimeError, "bravo": "ownership"})

    def test_final_scan_failure_retains_outcomes(self):
        self.run_cleanup({"bravo": "ownership"}, final_fault=RecursionError())

    def test_final_scan_alone_blocks_success(self):
        self.run_cleanup({}, final_fault=TypeError())

    def test_healthy_removals(self):
        self.run_cleanup({})

    def test_interrupt_propagates(self):
        for interruption in (KeyboardInterrupt, SystemExit, InterruptedError):
            commands = Mock()
            commands.docker.side_effect = interruption
            inventory = c.Inventory(commands, "run")
            inventory.add("volume", "alpha")
            with self.subTest(interruption=interruption), self.assertRaises(interruption):
                inventory.cleanup()
