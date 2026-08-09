from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


TOOLS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_DIR))

from agent_job_client import request  # noqa: E402
import agent_job_supervisor as supervisor_module  # noqa: E402
from agent_job_supervisor import Supervisor  # noqa: E402


def fake_command(job: dict[str, object]) -> tuple[list[str], str | None, dict[str, str]]:
    prompt = str(job["prompt"])
    if prompt == "complete":
        script = "import time; print('first', flush=True); time.sleep(.1); print('second', flush=True)"
    elif prompt == "delayed":
        script = "import time; time.sleep(1); print('delayed output', flush=True); time.sleep(.4)"
    elif prompt == "rapid-output":
        script = "import time; print('first', flush=True); time.sleep(.2); print('rapid second', flush=True); time.sleep(2)"
    elif prompt == "slow":
        script = "import time; print('started', flush=True); time.sleep(30)"
    else:
        script = "print('unknown', flush=True)"
    return [sys.executable, "-u", "-c", script], None, os.environ.copy()


class SupervisorIntegrationTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.workdir = root / "work"
        self.workdir.mkdir()
        self.old_roots = os.environ.get("AGENT_JOB_ALLOWED_ROOTS")
        self.old_allow_implement = os.environ.get("AGENT_JOB_ALLOW_IMPLEMENT")
        self.old_token_path = supervisor_module.IMPLEMENT_TOKEN_PATH
        os.environ["AGENT_JOB_ALLOWED_ROOTS"] = str(root)
        self.implement_token = root / "implement.token"
        self.implement_token.write_text("test-capability\n", encoding="utf-8")
        os.environ["AGENT_JOB_ALLOW_IMPLEMENT"] = "1"
        supervisor_module.IMPLEMENT_TOKEN_PATH = self.implement_token
        self.launch_counts: dict[str, int] = {}

        def counted_command(job: dict[str, object]) -> tuple[list[str], str | None, dict[str, str]]:
            job_id = str(job["job_id"])
            self.launch_counts[job_id] = self.launch_counts.get(job_id, 0) + 1
            return fake_command(job)

        self.supervisor = Supervisor(
            state_dir=root / "state",
            socket_path=root / "state" / "supervisor.sock",
            db_path=root / "state" / "jobs.sqlite3",
            log_dir=root / "state" / "logs",
            command_builder=counted_command,
            binary_finder=lambda provider: sys.executable,
        )
        self.supervisor.provider_limits = {"claude": 1, "kimi": 1, "codex": 1}
        self.server_task = asyncio.create_task(self.supervisor.serve())
        for _ in range(100):
            if self.supervisor.socket_path.exists():
                break
            await asyncio.sleep(.01)
        self.assertTrue(self.supervisor.socket_path.exists())

    async def asyncTearDown(self) -> None:
        self.server_task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await self.server_task
        if self.old_roots is None:
            os.environ.pop("AGENT_JOB_ALLOWED_ROOTS", None)
        else:
            os.environ["AGENT_JOB_ALLOWED_ROOTS"] = self.old_roots
        if self.old_allow_implement is None:
            os.environ.pop("AGENT_JOB_ALLOW_IMPLEMENT", None)
        else:
            os.environ["AGENT_JOB_ALLOW_IMPLEMENT"] = self.old_allow_implement
        supervisor_module.IMPLEMENT_TOKEN_PATH = self.old_token_path
        self.temp.cleanup()

    async def call(self, payload: dict[str, object]) -> dict[str, object]:
        return await asyncio.to_thread(request, payload, self.supervisor.socket_path)

    def spec(self, prompt: str) -> dict[str, object]:
        return {
            "action": "submit",
            "provider": "claude",
            "model": "test-model",
            "mode": "readonly",
            "workdir": str(self.workdir),
            "prompt": prompt,
            "timeout_seconds": 30,
            "soft_stall_seconds": 30,
            "max_turns": 1,
            "caller_depth": 0,
        }

    async def wait_for(self, job_id: str, statuses: set[str], timeout: float = 5) -> dict[str, object]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = await self.call({"action": "read", "job_id": job_id})
            job = result["job"]
            if job["status"] in statuses:
                return result
            await asyncio.sleep(.05)
        self.fail(f"Job {job_id} did not reach {statuses}")

    async def test_completion_and_cursor_reads(self) -> None:
        submitted = await self.call(self.spec("complete"))
        result = await self.wait_for(str(submitted["job_id"]), {"completed"})
        self.assertIn("first", result["output"])
        self.assertEqual("first\nsecond\n", result["stdout"])
        self.assertEqual("", result["stderr"])
        cursor = int(result["cursor"])
        again = await self.call({"action": "read", "job_id": submitted["job_id"], "cursor": cursor})
        self.assertEqual("", again["output"])
        self.assertNotIn("prompt", result["job"])

    async def test_owner_inbox_redelivers_until_exact_owner_acknowledges(self) -> None:
        spec = self.spec("complete")
        spec["owner"] = "codex:phase-6"
        submitted = await self.call(spec)
        await self.wait_for(str(submitted["job_id"]), {"completed"})

        first = await self.call({"action": "inbox", "owner": "codex:phase-6"})
        self.assertEqual(1, len(first["deliveries"]))
        delivery_id = first["deliveries"][0]["delivery_id"]
        self.assertEqual(submitted["job_id"], first["deliveries"][0]["job"]["job_id"])
        again = await self.call({"action": "inbox", "owner": "codex:phase-6"})
        self.assertEqual([delivery_id], [item["delivery_id"] for item in again["deliveries"]])

        await self.call({
            "action": "inbox", "owner": "different-owner",
            "ack_delivery_ids": [delivery_id],
        })
        still_pending = await self.call({"action": "inbox", "owner": "codex:phase-6"})
        self.assertEqual(1, len(still_pending["deliveries"]))
        acknowledged = await self.call({
            "action": "inbox", "owner": "codex:phase-6",
            "ack_delivery_ids": [delivery_id],
        })
        self.assertEqual([], acknowledged["deliveries"])

    async def test_server_side_wait_wakes_on_terminal_transition(self) -> None:
        submitted = await self.call(self.spec("slow"))
        await self.wait_for(str(submitted["job_id"]), {"running"})
        current = await self.call({
            "action": "read", "job_id": submitted["job_id"], "max_bytes": 64_000,
        })
        waiter = asyncio.create_task(self.call({
            "action": "read", "job_id": submitted["job_id"],
            "cursor": current["cursor"], "max_bytes": 64_000, "wait_seconds": 5,
        }))
        await asyncio.sleep(.1)
        await self.call({"action": "cancel", "job_id": submitted["job_id"]})
        result = await asyncio.wait_for(waiter, timeout=3)
        self.assertEqual("cancelled", result["job"]["status"])

    async def test_server_side_wait_wakes_on_new_output(self) -> None:
        submitted = await self.call(self.spec("delayed"))
        await self.wait_for(str(submitted["job_id"]), {"running"})
        current = await self.call({"action": "read", "job_id": submitted["job_id"]})
        result = await self.call({
            "action": "read", "job_id": submitted["job_id"],
            "cursor": current["cursor"], "max_bytes": 64_000, "wait_seconds": 3,
        })
        self.assertIn("delayed output", result["output"])
        await self.wait_for(str(submitted["job_id"]), {"completed"})

    async def test_server_side_wait_wakes_on_output_inside_timestamp_throttle(self) -> None:
        submitted = await self.call(self.spec("rapid-output"))
        await self.wait_for(str(submitted["job_id"]), {"running"})
        for _ in range(100):
            current = await self.call({"action": "read", "job_id": submitted["job_id"]})
            if "first" in current["output"]:
                break
            await asyncio.sleep(.01)
        else:
            self.fail("rapid fixture did not emit its first chunk")
        result = await self.call({
            "action": "read", "job_id": submitted["job_id"],
            "cursor": current["cursor"], "wait_seconds": 3,
        })
        self.assertIn("rapid second", result["output"])
        await self.call({"action": "cancel", "job_id": submitted["job_id"]})
        await self.wait_for(str(submitted["job_id"]), {"cancelled"})

    async def test_concurrent_waiters_share_transition_notification(self) -> None:
        submitted = await self.call(self.spec("slow"))
        await self.wait_for(str(submitted["job_id"]), {"running"})
        for _ in range(100):
            current = await self.call({"action": "read", "job_id": submitted["job_id"]})
            if "started" in current["output"]:
                break
            await asyncio.sleep(.01)
        else:
            self.fail("slow fixture did not emit its initial output")
        payload = {
            "action": "read", "job_id": submitted["job_id"],
            "cursor": current["cursor"], "wait_seconds": 5,
        }
        waiters = [asyncio.create_task(self.call(payload)) for _ in range(2)]
        await asyncio.sleep(.1)
        await self.call({"action": "cancel", "job_id": submitted["job_id"]})
        results = await asyncio.gather(*waiters)
        self.assertEqual(["cancelled", "cancelled"], [item["job"]["status"] for item in results])

    async def test_zero_max_turns_is_preserved_as_unlimited(self) -> None:
        spec = self.spec("complete")
        spec["max_turns"] = 0
        submitted = await self.call(spec)
        self.assertEqual(0, submitted["max_turns"])
        await self.wait_for(str(submitted["job_id"]), {"completed"})

    async def test_cancel_running_process_group(self) -> None:
        submitted = await self.call(self.spec("slow"))
        await self.wait_for(str(submitted["job_id"]), {"running"})
        await self.call({"action": "cancel", "job_id": submitted["job_id"]})
        result = await self.wait_for(str(submitted["job_id"]), {"cancelled"})
        self.assertEqual("cancelled", result["job"]["failure_kind"])

    async def test_quiet_running_job_is_classified_as_possibly_stalled(self) -> None:
        submitted = await self.call(self.spec("slow"))
        await self.wait_for(str(submitted["job_id"]), {"running"})
        self.supervisor.store.update(
            str(submitted["job_id"]), last_output_at=time.time() - 31, soft_stall_seconds=30
        )
        result = await self.call({"action": "read", "job_id": submitted["job_id"]})
        self.assertEqual("possibly_stalled", result["job"]["status"])
        self.assertGreaterEqual(result["job"]["seconds_without_output"], 30)
        await self.call({"action": "cancel", "job_id": submitted["job_id"]})
        await self.wait_for(str(submitted["job_id"]), {"cancelled"})

    async def test_provider_queue_is_machine_wide_within_daemon(self) -> None:
        first = await self.call(self.spec("slow"))
        second = await self.call(self.spec("complete"))
        await self.wait_for(str(first["job_id"]), {"running"})
        queued = await self.call({"action": "read", "job_id": second["job_id"]})
        self.assertEqual("queued", queued["job"]["status"])
        await self.call({"action": "cancel", "job_id": first["job_id"]})
        await self.wait_for(str(first["job_id"]), {"cancelled"})
        await self.wait_for(str(second["job_id"]), {"completed"})

    async def test_list_filters_owner_before_applying_limit(self) -> None:
        wanted = self.spec("complete")
        wanted["owner"] = "wanted:checkpoint"
        first = await self.call(wanted)
        await self.wait_for(str(first["job_id"]), {"completed"})
        other = self.spec("complete")
        other["owner"] = "other:checkpoint"
        second = await self.call(other)
        await self.wait_for(str(second["job_id"]), {"completed"})
        result = await self.call({"action": "list", "owner": "wanted", "limit": 1})
        self.assertEqual([first["job_id"]], [job["job_id"] for job in result["jobs"]])

    async def test_stalled_filter_is_applied_before_limit(self) -> None:
        self.supervisor.provider_limits["claude"] = 2
        stalled = await self.call(self.spec("slow"))
        await self.wait_for(str(stalled["job_id"]), {"running"})
        for _ in range(100):
            stored = self.supervisor.store.get(str(stalled["job_id"]))
            if stored["last_output_at"] > stored["started_at"]:
                break
            await asyncio.sleep(.01)
        self.supervisor.store.update(
            str(stalled["job_id"]), last_output_at=time.time() - 31, soft_stall_seconds=30
        )
        active = await self.call(self.spec("slow"))
        await self.wait_for(str(active["job_id"]), {"running"})
        result = await self.call({"action": "list", "status": "possibly_stalled", "limit": 1})
        self.assertEqual([stalled["job_id"]], [job["job_id"] for job in result["jobs"]])
        for job in (stalled, active):
            await self.call({"action": "cancel", "job_id": job["job_id"]})
            await self.wait_for(str(job["job_id"]), {"cancelled"})

    async def test_production_concurrency_never_launches_one_job_twice(self) -> None:
        self.supervisor.provider_limits["claude"] = 2
        submitted = await self.call(self.spec("slow"))
        await self.wait_for(str(submitted["job_id"]), {"running"})
        await asyncio.sleep(.75)
        self.assertEqual(1, self.launch_counts[str(submitted["job_id"])])
        await self.call({"action": "cancel", "job_id": submitted["job_id"]})
        await self.wait_for(str(submitted["job_id"]), {"cancelled"})

    async def test_scheduler_recovers_after_iteration_error(self) -> None:
        original_queued = self.supervisor.store.queued
        calls = 0

        def fail_once() -> list[dict[str, object]]:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("synthetic scheduler failure")
            return original_queued()

        self.supervisor.store.queued = fail_once  # type: ignore[method-assign]
        submitted = await self.call(self.spec("complete"))
        result = await self.wait_for(str(submitted["job_id"]), {"completed"}, timeout=5)
        self.assertEqual("completed", result["job"]["status"])

    async def test_submit_relative_deadline_expires_in_queue(self) -> None:
        first = await self.call(self.spec("slow"))
        second = await self.call(self.spec("complete"))
        await self.wait_for(str(first["job_id"]), {"running"})
        self.supervisor.store.update(
            str(second["job_id"]), created_at=time.time() - 31, timeout_seconds=30
        )
        await self.call({"action": "cancel", "job_id": first["job_id"]})
        await self.wait_for(str(first["job_id"]), {"cancelled"})
        result = await self.wait_for(str(second["job_id"]), {"failed"})
        self.assertEqual("queue_timeout", result["job"]["failure_kind"])

    async def test_cancelled_queued_job_never_launches(self) -> None:
        first = await self.call(self.spec("slow"))
        second = await self.call(self.spec("complete"))
        await self.wait_for(str(first["job_id"]), {"running"})
        cancelled = await self.call({"action": "cancel", "job_id": second["job_id"]})
        self.assertEqual("cancelled", cancelled["status"])
        await self.call({"action": "cancel", "job_id": first["job_id"]})
        await self.wait_for(str(first["job_id"]), {"cancelled"})
        await asyncio.sleep(.5)
        result = await self.call({"action": "read", "job_id": second["job_id"]})
        self.assertEqual("cancelled", result["job"]["status"])
        self.assertEqual("", result.get("stdout", ""))
        self.assertNotIn(str(second["job_id"]), self.supervisor.change_events)

    async def test_recursive_submission_is_rejected(self) -> None:
        spec = self.spec("complete")
        spec["caller_depth"] = 1
        with self.assertRaisesRegex(RuntimeError, "Recursive"):
            await self.call(spec)

    async def test_relative_workdir_is_rejected_by_daemon(self) -> None:
        spec = self.spec("complete")
        spec["workdir"] = "."
        with self.assertRaisesRegex(RuntimeError, "absolute path"):
            await self.call(spec)

    async def test_missing_allowed_roots_fail_closed(self) -> None:
        os.environ["AGENT_JOB_ALLOWED_ROOTS"] = str(Path(self.temp.name) / "missing")
        with self.assertRaisesRegex(RuntimeError, "fail-open"):
            await self.call(self.spec("complete"))
        os.environ["AGENT_JOB_ALLOWED_ROOTS"] = str(Path(self.temp.name))

    async def test_implementation_requires_capability(self) -> None:
        spec = self.spec("complete")
        spec["mode"] = "implement"
        with self.assertRaisesRegex(RuntimeError, "Invalid implementation capability"):
            await self.call(spec)
        spec["implement_capability"] = "test-capability"
        submitted = await self.call(spec)
        result = await self.wait_for(str(submitted["job_id"]), {"completed"})
        self.assertEqual("completed", result["job"]["status"])

    async def test_large_valid_prompt_crosses_socket_transport(self) -> None:
        spec = self.spec(("line with a quote: \"value\"\n" * 18_000)[:500_000])
        submitted = await self.call(spec)
        result = await self.wait_for(str(submitted["job_id"]), {"completed"})
        self.assertEqual(0, result["job"]["exit_code"])

    async def test_prompt_over_four_mib_is_rejected(self) -> None:
        spec = self.spec("x" * (supervisor_module.MAX_PROMPT_BYTES + 1))
        with self.assertRaisesRegex(RuntimeError, "Prompt must contain"):
            await self.call(spec)

    async def test_duplicate_idempotency_key_returns_original_job(self) -> None:
        spec = self.spec("complete")
        spec["idempotency_key"] = "same-request"
        first = await self.call(spec)
        second = await self.call(spec)
        self.assertEqual(first["job_id"], second["job_id"])
        jobs = await self.call({"action": "list", "limit": 50})
        matching = [job for job in jobs["jobs"] if job.get("idempotency_key") == "same-request"]
        self.assertEqual(1, len(matching))

    async def test_running_job_is_reconciled_after_restart(self) -> None:
        spec = self.spec("slow")
        spec["owner"] = "codex:restart-test"
        submitted = await self.call(spec)
        await self.wait_for(str(submitted["job_id"]), {"running"})
        job = self.supervisor.store.get(str(submitted["job_id"]))
        self.supervisor.store.update(str(submitted["job_id"]), pgid=None)
        reconciled = self.supervisor.store.reconcile()
        self.assertTrue(any(item["job_id"] == submitted["job_id"] for item in reconciled))
        current = self.supervisor.store.get(str(submitted["job_id"]))
        self.assertEqual("interrupted", current["status"])
        inbox = await self.call({"action": "inbox", "owner": "codex:restart-test"})
        self.assertEqual([submitted["job_id"]], [item["job"]["job_id"] for item in inbox["deliveries"]])
        # Restore running state so normal teardown owns and terminates the live test process.
        self.supervisor.store.update(str(submitted["job_id"]), status="running", pgid=job["pgid"])
        await self.call({"action": "cancel", "job_id": submitted["job_id"]})
        await self.wait_for(str(submitted["job_id"]), {"cancelled"})

    async def test_prune_removes_delivery_with_terminal_job(self) -> None:
        spec = self.spec("complete")
        spec["owner"] = "codex:prune-test"
        submitted = await self.call(spec)
        await self.wait_for(str(submitted["job_id"]), {"completed"})
        self.supervisor.store.update(str(submitted["job_id"]), finished_at=1)

        self.supervisor.store.prune(cutoff=2)

        inbox = await self.call({"action": "inbox", "owner": "codex:prune-test"})
        self.assertEqual([], inbox["deliveries"])
        with self.assertRaisesRegex(RuntimeError, "Unknown job id"):
            await self.call({"action": "read", "job_id": submitted["job_id"]})

    async def test_restart_cleanup_refuses_mismatched_process_identity(self) -> None:
        process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True
        )
        try:
            spec = self.spec("complete")
            spec.update({
                "soft_stall_seconds": 30,
                "idempotency_key": "identity-mismatch",
                "request_hash": "hash",
            })
            job_id = "identity-mismatch-job"
            self.supervisor.store.create(spec, job_id, self.supervisor.log_dir / f"{job_id}.log")
            self.supervisor.store.update(
                job_id, status="running", pid=process.pid, pgid=process.pid,
                binary_path=sys.executable, process_start="definitely-not-the-start-time",
            )
            await self.supervisor._cleanup_interrupted()
            self.assertIsNone(process.poll())
            job = self.supervisor.store.get(job_id)
            self.assertIn("identity did not match", job["message"])
        finally:
            process.terminate()
            process.wait(timeout=5)

    async def test_restart_cleanup_terminates_exact_recorded_process(self) -> None:
        process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True
        )
        spec = self.spec("complete")
        spec.update({
            "soft_stall_seconds": 30,
            "idempotency_key": "identity-match",
            "request_hash": "hash",
        })
        job_id = "identity-match-job"
        self.supervisor.store.create(spec, job_id, self.supervisor.log_dir / f"{job_id}.log")
        process_start = await self.supervisor._ps_field(process.pid, "lstart")
        live_command = await self.supervisor._ps_field(process.pid, "command")
        live_binary = str(Path(live_command.split()[0]).resolve())
        self.supervisor.store.update(
            job_id, status="running", pid=process.pid, pgid=process.pid,
            binary_path=live_binary, process_start=process_start,
        )
        await self.supervisor._cleanup_interrupted()
        process.wait(timeout=5)
        self.assertIsNotNone(process.returncode)
        self.assertEqual("interrupted", self.supervisor.store.get(job_id)["status"])

    async def test_running_job_hard_deadline_terminates_process(self) -> None:
        spec = self.spec("slow")
        spec.update({
            "timeout_seconds": 1,
            "soft_stall_seconds": 1,
            "idempotency_key": "running-timeout",
            "request_hash": "hash",
        })
        job_id = "running-timeout-job"
        self.supervisor.store.create(spec, job_id, self.supervisor.log_dir / f"{job_id}.log")
        result = await self.wait_for(job_id, {"failed"}, timeout=5)
        self.assertEqual("timeout", result["job"]["failure_kind"])

    async def test_provider_env_is_scoped_and_command_builder_is_real(self) -> None:
        profile = Path(self.temp.name) / "provider.env"
        profile.write_text("MOONSHOT_API_KEY=kimi-secret\nANTHROPIC_API_KEY=claude-secret\n")
        old = os.environ.get("AGENT_JOB_PROFILE_ENV")
        old_cao_token = os.environ.get("AGENT_JOB_CAO_TOKEN")
        os.environ["AGENT_JOB_PROFILE_ENV"] = str(profile)
        try:
            base = {
                "provider": "kimi", "model": "kimi-code/k3", "mode": "readonly",
                "prompt": "review", "max_turns": 2, "workdir": str(self.workdir),
            }
            argv, stdin_text, env = self.supervisor._build_command(base)
            self.assertIn("--agent-file", argv)
            self.assertEqual("kimi-secret", env["MOONSHOT_API_KEY"])
            self.assertNotIn("ANTHROPIC_API_KEY", env)
            self.assertIsNone(stdin_text)
            base.update(provider="claude", model="opus")
            argv, stdin_text, env = self.supervisor._build_command(base)
            self.assertEqual("claude-secret", env["ANTHROPIC_API_KEY"])
            self.assertNotIn("MOONSHOT_API_KEY", env)
            self.assertEqual("review", stdin_text)
            self.assertIn("--safe-mode", argv)
            self.assertIn("--max-turns", argv)
            base["max_turns"] = 0
            argv, _, _ = self.supervisor._build_command(base)
            self.assertNotIn("--max-turns", argv)
            base.update(provider="codex", model="gpt-5.6-codex")
            os.environ["AGENT_JOB_CAO_TOKEN"] = "must-not-reach-native"
            argv, stdin_text, env = self.supervisor._build_command(base)
            self.assertIn("--ignore-user-config", argv)
            self.assertEqual("review", stdin_text)
            self.assertNotIn("AGENT_JOB_CAO_TOKEN", env)
        finally:
            if old_cao_token is None:
                os.environ.pop("AGENT_JOB_CAO_TOKEN", None)
            else:
                os.environ["AGENT_JOB_CAO_TOKEN"] = old_cao_token
            if old is None:
                os.environ.pop("AGENT_JOB_PROFILE_ENV", None)
            else:
                os.environ["AGENT_JOB_PROFILE_ENV"] = old

    async def test_cao_backend_uses_bridge_without_native_provider_binary(self) -> None:
        profile = Path(self.temp.name) / "provider.env"
        profile.write_text("ANTHROPIC_API_KEY=must-not-reach-bridge\n")
        job = {
            "job_id": "bridge-job",
            "provider": "claude",
            "model": "opus",
            "mode": "readonly",
            "prompt": "review",
            "max_turns": 0,
            "workdir": str(self.workdir),
            "execution_backend": "cao",
            "created_at": 1000.0,
            "timeout_seconds": 1800,
        }
        with patch.dict(
            os.environ,
            {
                "AGENT_JOB_EXECUTION_BACKEND": "cao",
                "AGENT_JOB_CAO_URL": "http://127.0.0.1:9889",
                "AGENT_JOB_PROFILE_ENV": str(profile),
            },
        ):
            argv, stdin_text, env = self.supervisor._build_command(job)

        self.assertEqual(sys.executable, argv[0])
        self.assertTrue(argv[1].endswith("cao_job_bridge.py"))
        self.assertIn("bridge-job", argv)
        self.assertEqual("review", stdin_text)
        self.assertEqual("http://127.0.0.1:9889", env["AGENT_JOB_CAO_URL"])
        self.assertEqual("2800.0", env["AGENT_JOB_DEADLINE_EPOCH"])
        self.assertNotIn("ANTHROPIC_API_KEY", env)

    async def test_cao_backend_fails_closed_for_unenforceable_contracts(self) -> None:
        with patch.dict(os.environ, {"AGENT_JOB_EXECUTION_BACKEND": "cao"}):
            codex = self.spec("review")
            codex.update(provider="codex", model="gpt-5.5-codex")
            with self.assertRaisesRegex(ValueError, "read-only Codex"):
                self.supervisor.submit(codex)

            claude = self.spec("review")
            claude.update(provider="claude", model="opus", max_turns=2)
            with self.assertRaisesRegex(ValueError, "turn ceiling"):
                self.supervisor.submit(claude)

    async def test_submit_persists_execution_backend(self) -> None:
        with patch.dict(os.environ, {"AGENT_JOB_EXECUTION_BACKEND": "cao"}):
            spec = self.spec("review")
            spec.update(provider="claude", model="opus", max_turns=0)
            job = self.supervisor.submit(spec)

        self.assertEqual("cao", job["execution_backend"])


if __name__ == "__main__":
    unittest.main()
