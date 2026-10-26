import importlib.util
import json
import os
import pathlib
import tempfile
import types
import unittest
import fcntl


RUNNER = pathlib.Path("~/bin/chami-packet/releases/20260913-audit-v1/packet_run.py")
QUEUE = pathlib.Path("~/bin/packet-queue-run")


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None:
        from importlib.machinery import SourceFileLoader
        spec = importlib.util.spec_from_loader(name, SourceFileLoader(name, str(path)))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class PacketEvidenceTests(unittest.TestCase):
    def test_confirmed_failure_is_private_and_bound(self):
        runner = load(RUNNER, "packet_runner_test")
        with tempfile.TemporaryDirectory() as tmp:
            diagnostics = pathlib.Path(tmp)
            evidence = {"route": "local/model", "terminality": "CONFIRMED",
                        "timed_out": False, "direct_child_exited": True,
                        "pipes_eof": True, "process_group_alive": False,
                        "returncode": 7}
            result = runner._retain_execution_result(
                diagnostics, "a" * 64, evidence, outcome="CONFIRMED_FAILURE_BLOCKED")
            saved = json.loads(next(diagnostics.glob("execution-result-*.json")).read_text())
            self.assertEqual(result["outcome"], "CONFIRMED_FAILURE_BLOCKED")
            self.assertEqual(saved["packet_sha256"], "a" * 64)
            self.assertEqual(saved["route"], "local/model")

    def test_changed_packet_is_not_overwritten(self):
        runner = load(RUNNER, "packet_runner_test_changed")
        with tempfile.TemporaryDirectory() as tmp:
            packet = pathlib.Path(tmp) / "x.packet.md"
            original = "---\nstatus: executing\n---\n"
            packet.write_text(original)
            expected = runner.hashlib.sha256(packet.read_bytes()).hexdigest()
            packet.write_text(original + "changed\n")
            self.assertFalse(runner._mark_confirmed_failure(packet, expected))
            self.assertIn("changed", packet.read_text())


class QueueContractTests(unittest.TestCase):
    def test_default_tier_is_local_and_all_unreachable_is_nonzero(self):
        queue = load(QUEUE, "packet_queue_test")
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            home = root / "home"
            home.mkdir()
            packet = root / "a.packet.md"
            packet.write_text("---\nstatus: ready\n---\n")
            q = root / "queue.json"
            q.write_text(json.dumps({"entries": [{"packet": str(packet)}], "window_hours": 1}))
            queue.HOME = home
            queue.PACKET_RUN = root / "fake-packet-run"
            queue.PACKET_RUN.write_text("#!/bin/sh\nexit 3\n")
            queue.PACKET_RUN.chmod(0o755)
            old = os.sys.argv
            try:
                os.sys.argv = [str(QUEUE), "--queue", str(q)]
                self.assertEqual(queue.main(), 1)
            finally:
                os.sys.argv = old
            log = next((home / "pipeline-runs").glob("queue-*/run.log"))
            self.assertIn("tier=local", log.read_text())


class PacketMainHarnessTests(unittest.TestCase):
    def setUp(self):
        self.runner = load(RUNNER, "packet_runner_main_harness")

    def _case(self, evidence=None, error=None, mutate=None, preflight_mutate=False):
        root = tempfile.TemporaryDirectory()
        base = pathlib.Path(root.name)
        project = base / "project"
        project.mkdir()
        packet = base / "case.packet.md"
        packet.write_text(
            f"---\npacket: case\nproject_root: {project}\nstatus: ready\n---\n"
            "## Context\n\n### P1 — bounded case\n- **accept**: true\n"
            "## Packet acceptance\ntrue\n")
        calls = []
        original_run, original_bounded, original_tool = self.runner.subprocess.run, self.runner.run_bounded, self.runner.tool

        def fake_run(cmd, **kwargs):
            calls.append(list(cmd))
            name = pathlib.Path(cmd[1]).name if len(cmd) > 1 else ""
            if name == "packet-root":
                return types.SimpleNamespace(returncode=0, stdout=str(project) + "\n", stderr="")
            if name == "packet-lint":
                return types.SimpleNamespace(returncode=0, stdout="lint ok", stderr="")
            if name == "chami-tier":
                if "resolve" in cmd:
                    return types.SimpleNamespace(returncode=0, stdout="fake-model\n", stderr="")
                if preflight_mutate:
                    packet.write_text(packet.read_text() + "preflight external\n")
                return types.SimpleNamespace(returncode=0, stdout="probe ok", stderr="")
            if name == "packet-receipt":
                return types.SimpleNamespace(returncode=0, stdout="receipt", stderr="")
            raise AssertionError(cmd)

        def fake_bounded(*args, **kwargs):
            if mutate:
                mutate(packet)
            if error:
                raise error
            return dict(evidence)

        self.runner.subprocess.run, self.runner.run_bounded, self.runner.tool = fake_run, fake_bounded, lambda name: base / name
        try:
            rc = self.runner.main([str(packet)])
            return root, packet, calls, rc
        finally:
            self.runner.subprocess.run, self.runner.run_bounded, self.runner.tool = original_run, original_bounded, original_tool

    def _evidence(self, **overrides):
        result = {"route": "local/fake-model", "terminality": "CONFIRMED", "timed_out": False,
                  "direct_child_exited": True, "pipes_eof": True, "process_group_alive": False,
                  "returncode": 0, "stdout": "", "stderr": ""}
        result.update(overrides)
        return result

    def test_confirmed_timeout_and_nonzero_block_without_receipt(self):
        for evidence in (self._evidence(timed_out=True, returncode=-15), self._evidence(returncode=9)):
            root, packet, calls, rc = self._case(evidence)
            self.assertEqual(rc, 1)
            self.assertIn("status: blocked", packet.read_text())
            self.assertFalse(any("packet-receipt" in str(c) for c in calls))
            root.cleanup()

    def test_unconfirmed_malformed_changed_and_exception_stay_executing(self):
        cases = [
            (self._evidence(timed_out=True, direct_child_exited=False, process_group_alive=True), None, None),
            ({**self._evidence(), "route": "wrong/route"}, None, None),
            (self._evidence(returncode=7), None, lambda p: p.write_text(p.read_text() + "external\n")),
            (None, RuntimeError("private detail"), None),
        ]
        for evidence, error, mutate in cases:
            root, packet, calls, rc = self._case(evidence, error, mutate)
            self.assertIn(rc, (1,))
            self.assertIn("status: executing", packet.read_text())
            self.assertFalse(any("packet-receipt" in str(c) for c in calls))
            if evidence and evidence.get("route") == "wrong/route":
                saved = json.loads(next((packet.parent / "project" / ".packet-diagnostics").glob("execution-result-*.json")).read_text())
                self.assertEqual(saved["requested_route"], "local/fake-model")
                self.assertEqual(saved["observed_route"], "wrong/route")
            root.cleanup()

    def test_preflight_change_is_preserved_and_dispatch_is_refused(self):
        root, packet, calls, rc = self._case(self._evidence(), preflight_mutate=True)
        self.assertEqual(rc, 1)
        self.assertIn("status: ready", packet.read_text())
        self.assertIn("preflight external", packet.read_text())
        self.assertFalse(any("opencode" in str(c) for c in calls))
        root.cleanup()

    def test_success_is_only_case_that_calls_receipt(self):
        root, packet, calls, rc = self._case(self._evidence())
        self.assertEqual(rc, 0)
        self.assertTrue(any("packet-receipt" in str(c) for c in calls))
        root.cleanup()

    def test_repeated_sha_has_unique_attempt_evidence_and_lock_contention_refuses(self):
        runner = self.runner
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            ev = self._evidence(returncode=4)
            runner._retain_execution_result(d, "b" * 64, ev, outcome="CONFIRMED_FAILURE_BLOCKED")
            runner._retain_execution_result(d, "b" * 64, ev, outcome="CONFIRMED_FAILURE_BLOCKED")
            self.assertEqual(len(list(d.glob("execution-result-*.json"))), 2)
            lock = d / "x.packet.md.run-lock"
            fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o600)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                # The full main lock path is exercised by a ready packet in the
                # temporary directory; an already-held cooperating lock refuses.
                packet = d / "x.packet.md"
                packet.write_text(f"---\npacket: x\nproject_root: {d}\nstatus: ready\n---\n")
                old_home, old_tool = runner.HOME, runner.tool
                runner.HOME = d
                runner.tool = lambda name: d / name
                try:
                    self.assertEqual(runner.main([str(packet)]), 2)
                finally:
                    runner.HOME, runner.tool = old_home, old_tool
            finally:
                os.close(fd)


class QueueWaitHarnessTests(unittest.TestCase):
    def test_missing_packet_is_nonzero(self):
        queue = load(QUEUE, "packet_queue_missing_harness")
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            home = root / "home"; home.mkdir()
            q = root / "queue.json"
            q.write_text(json.dumps({"entries": [{"packet": str(root / "missing.packet.md")}], "window_hours": 1}))
            queue.HOME, queue.PACKET_RUN = home, root / "unused"
            old_argv = os.sys.argv
            try:
                os.sys.argv = [str(QUEUE), "--queue", str(q)]
                self.assertEqual(queue.main(), 1)
            finally:
                os.sys.argv = old_argv

    def test_removed_entry_during_wait_is_skipped_and_nonzero_without_dispatch(self):
        queue = load(QUEUE, "packet_queue_wait_harness")
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            home = root / "home"; home.mkdir()
            packet = root / "a.packet.md"; packet.write_text("---\nstatus: ready\n---\n")
            q = root / "queue.json"; q.write_text(json.dumps({"entries": [{"packet": str(packet), "at_minute": 0.1}], "window_hours": 1}))
            queue.HOME, queue.PACKET_RUN = home, root / "unused"
            class Clock:
                now = 100.0
                def time(self): return self.now
                def sleep(self, seconds):
                    self.now += seconds
                    q.write_text(json.dumps({"entries": [], "window_hours": 1}))
            clock = Clock()
            old_time, old_sleep, old_run = queue.time.time, queue.time.sleep, queue.run_one
            queue.time.time, queue.time.sleep = clock.time, clock.sleep
            queue.run_one = lambda *args: (_ for _ in ()).throw(AssertionError("must not dispatch"))
            old_argv = os.sys.argv
            try:
                os.sys.argv = [str(QUEUE), "--queue", str(q)]
                self.assertEqual(queue.main(), 1)
            finally:
                os.sys.argv = old_argv
                queue.time.time, queue.time.sleep, queue.run_one = old_time, old_sleep, old_run


if __name__ == "__main__":
    unittest.main()
