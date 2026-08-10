from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


TOOLS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_DIR))

import review_sidecars_server as sidecars  # noqa: E402
from agent_job_client import request  # noqa: E402
from agent_job_supervisor import Supervisor  # noqa: E402


class ReviewSidecarAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_roots = os.environ.get("REVIEW_SIDECARS_ALLOWED_ROOTS")
        self.old_agent_roots = os.environ.get("AGENT_JOB_ALLOWED_ROOTS")
        os.environ["REVIEW_SIDECARS_ALLOWED_ROOTS"] = str(self.root)
        os.environ["AGENT_JOB_ALLOWED_ROOTS"] = str(self.root)

    async def asyncTearDown(self) -> None:
        if self.old_roots is None:
            os.environ.pop("REVIEW_SIDECARS_ALLOWED_ROOTS", None)
        else:
            os.environ["REVIEW_SIDECARS_ALLOWED_ROOTS"] = self.old_roots
        if self.old_agent_roots is None:
            os.environ.pop("AGENT_JOB_ALLOWED_ROOTS", None)
        else:
            os.environ["AGENT_JOB_ALLOWED_ROOTS"] = self.old_agent_roots
        self.temp.cleanup()

    async def test_sync_adapter_accumulates_stdout_from_the_start(self) -> None:
        workdir = self.root / "project"
        workdir.mkdir()
        chunks = ["A" * 80_000, "B" * 80_000]
        calls = 0

        def fake_read(*args: object, **kwargs: object) -> dict[str, object]:
            nonlocal calls
            index = calls
            calls += 1
            terminal = index == 1
            size = 80_000 * (index + 1)
            return {
                "job": {
                    "status": "completed" if terminal else "running",
                    "created_at": 1.0,
                    "started_at": 1.0,
                    "updated_at": 2.0,
                    "finished_at": 2.0 if terminal else None,
                    "exit_code": 0 if terminal else None,
                },
                "cursor": 0,
                "stdout_output": chunks[index],
                "stdout_cursor": size,
                "stdout_size": size,
                "stderr_output": "",
                "stderr_cursor": 0,
                "stderr_size": 0,
            }

        with patch.object(sidecars, "supervisor_submit", return_value={"job_id": "job"}), patch.object(
            sidecars, "supervisor_read", side_effect=fake_read
        ):
            result = await sidecars._run_provider(
                "kimi", "review", workdir=str(workdir), preset="code_review",
                model="kimi-code/k3", timeout_seconds=60,
            )
        self.assertEqual(160_000, len(result["output"]))
        self.assertTrue(result["output"].startswith("A" * 100))
        self.assertTrue(result["output"].endswith("B" * 100))

    async def test_sync_claude_adapter_uses_real_supervisor_partial_response(self) -> None:
        workdir = self.root / "semantic-project"
        workdir.mkdir()
        state = self.root / "state"

        def command_builder(job: dict[str, object]) -> tuple[list[str], str | None, dict[str, str]]:
            script = """import json
events = [
    {"type": "stream_event", "event": {"type": "message_start", "message": {"id": "m"}}},
    {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "semantic answer"}}},
    {"type": "result", "subtype": "success", "is_error": False, "result": "semantic answer"},
]
for event in events:
    print(json.dumps(event), flush=True)
"""
            return [sys.executable, "-u", "-c", script], None, os.environ.copy()

        supervisor = Supervisor(
            state_dir=state,
            socket_path=state / "supervisor.sock",
            db_path=state / "jobs.sqlite3",
            log_dir=state / "logs",
            command_builder=command_builder,
            binary_finder=lambda provider: sys.executable,
        )
        supervisor.provider_limits = {"claude": 1, "kimi": 1, "codex": 1}
        server_task = asyncio.create_task(supervisor.serve())
        for _ in range(100):
            if supervisor.socket_path.exists():
                break
            await asyncio.sleep(.01)

        def submit_job(**kwargs: object) -> dict[str, object]:
            return request({"action": "submit", **kwargs}, supervisor.socket_path)

        def read_job(
            job_id: str, cursor: int, max_bytes: int, **kwargs: object
        ) -> dict[str, object]:
            return request({
                "action": "read", "job_id": job_id, "cursor": cursor,
                "max_bytes": max_bytes, **kwargs,
            }, supervisor.socket_path)

        def cancel_job(job_id: str) -> dict[str, object]:
            return request({"action": "cancel", "job_id": job_id}, supervisor.socket_path)

        try:
            with patch.object(sidecars, "supervisor_submit", side_effect=submit_job), patch.object(
                sidecars, "supervisor_read", side_effect=read_job
            ), patch.object(sidecars, "supervisor_cancel", side_effect=cancel_job):
                result = await sidecars._run_provider(
                    "claude", "review", workdir=str(workdir), preset=None, model="opus",
                    timeout_seconds=60,
                )
        finally:
            server_task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await server_task

        self.assertEqual("semantic answer", result["output"])
        self.assertNotIn("truncated", result["output"])

    async def test_sync_kimi_adapter_uses_provider_neutral_partial_response(self) -> None:
        workdir = self.root / "kimi-semantic-project"
        workdir.mkdir()
        terminal = {
            "job": {
                "status": "completed", "created_at": 1, "started_at": 1,
                "updated_at": 2, "finished_at": 2, "exit_code": 0,
            },
            "cursor": 0, "event_cursor": 1,
            "stdout_cursor": 100, "stdout_size": 100, "stdout_output": "",
            "stderr_cursor": 0, "stderr_size": 0, "stderr_output": "",
            "partial_response": "semantic kimi answer",
            "partial_result_state": "complete",
        }
        with patch.object(
            sidecars, "supervisor_submit", return_value={"job_id": "kimi-job"}
        ), patch.object(sidecars, "supervisor_read", return_value=terminal):
            result = await sidecars._run_provider(
                "kimi", "review", workdir=str(workdir), preset=None,
                model="kimi-code/k3", timeout_seconds=60,
            )

        self.assertEqual("semantic kimi answer", result["output"])

    async def test_sync_adapter_does_not_treat_empty_partial_as_semantic_output(self) -> None:
        workdir = self.root / "empty-semantic-project"
        workdir.mkdir()
        terminal = {
            "job": {
                "status": "completed", "created_at": 1, "started_at": 1,
                "updated_at": 2, "finished_at": 2, "exit_code": 0,
            },
            "cursor": 0, "event_cursor": 1,
            "stdout_cursor": 3, "stdout_size": 3, "stdout_output": "raw",
            "stderr_cursor": 0, "stderr_size": 0, "stderr_output": "",
            "partial_response": "", "partial_result_state": "none",
        }
        with patch.object(
            sidecars, "supervisor_submit", return_value={"job_id": "empty-job"}
        ), patch.object(sidecars, "supervisor_read", return_value=terminal):
            result = await sidecars._run_provider(
                "kimi", "review", workdir=str(workdir), preset=None,
                model="kimi-code/k3", timeout_seconds=60,
            )

        self.assertEqual("raw", result["output"])

    async def test_async_read_forwards_semantic_event_cursor(self) -> None:
        response = {
            "job": {"status": "running"}, "cursor": 3, "event_cursor": 9,
            "events": [{"kind": "message_delta", "payload": {"text": "part"}}],
        }
        with patch.object(sidecars, "supervisor_read", return_value=response) as mocked:
            rendered = await sidecars.review_read("job", cursor=3, event_cursor=7, max_bytes=99)

        mocked.assert_called_once_with("job", 3, 99, event_cursor=7)
        self.assertIn('"event_cursor": 9', rendered)

    async def test_git_context_from_subdirectory_uses_relative_paths(self) -> None:
        repo = self.root / "repo"
        backend = repo / "backend"
        frontend = repo / "frontend"
        backend.mkdir(parents=True)
        frontend.mkdir()
        (backend / "api.py").write_text("one\n", encoding="utf-8")
        (frontend / "app.ts").write_text("one\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "init"],
            env={**os.environ, "ALLOW_NO_DOCS_LOG": "1"},
            check=True,
        )
        (backend / "api.py").write_text("two\n", encoding="utf-8")
        (frontend / "app.ts").write_text("two\n", encoding="utf-8")
        context = sidecars._git_review_context(backend)
        self.assertIn("api.py", context)
        self.assertIn("+two", context)
        self.assertNotIn("frontend/app.ts", context)
        self.assertIn("outside the selected workdir", context)


if __name__ == "__main__":
    unittest.main()
