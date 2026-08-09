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


class ReviewSidecarAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_roots = os.environ.get("REVIEW_SIDECARS_ALLOWED_ROOTS")
        os.environ["REVIEW_SIDECARS_ALLOWED_ROOTS"] = str(self.root)

    async def asyncTearDown(self) -> None:
        if self.old_roots is None:
            os.environ.pop("REVIEW_SIDECARS_ALLOWED_ROOTS", None)
        else:
            os.environ["REVIEW_SIDECARS_ALLOWED_ROOTS"] = self.old_roots
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
                "claude", "review", workdir=str(workdir), preset="code_review",
                model="opus", timeout_seconds=60,
            )
        self.assertEqual(160_000, len(result["output"]))
        self.assertTrue(result["output"].startswith("A" * 100))
        self.assertTrue(result["output"].endswith("B" * 100))

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
