#!/usr/bin/env python3
"""Durable, machine-wide supervisor for local AI CLI jobs."""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import sqlite3
import stat
import sys
import time
import uuid
from typing import Any, Callable

from agent_job_policy import configured_allowed_roots, SENSITIVE_PATH_PARTS


STATE_DIR = Path(os.environ.get("AGENT_JOB_STATE_DIR", "~/.local/state/agent-job-supervisor")).expanduser()
SOCKET_PATH = Path(os.environ.get("AGENT_JOB_SOCKET", str(STATE_DIR / "supervisor.sock"))).expanduser()
DB_PATH = Path(os.environ.get("AGENT_JOB_DB", str(STATE_DIR / "jobs.sqlite3"))).expanduser()
LOG_DIR = Path(os.environ.get("AGENT_JOB_LOG_DIR", str(STATE_DIR / "logs"))).expanduser()
SERVER_DIR = Path(__file__).resolve().parent
MAX_PROMPT_BYTES = 4 * 1024 * 1024
MAX_READ_BYTES = 256_000
MAX_JOB_LOG_BYTES = int(os.environ.get("AGENT_JOB_MAX_LOG_BYTES", str(10 * 1024 * 1024)))
JOB_RETENTION_SECONDS = int(os.environ.get("AGENT_JOB_RETENTION_SECONDS", str(14 * 24 * 3600)))
MIN_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS = 7200
DEFAULT_SOFT_STALL_SECONDS = int(os.environ.get("AGENT_JOB_SOFT_STALL_SECONDS", "300"))
IMPLEMENT_TOKEN_PATH = Path(
    os.environ.get("AGENT_JOB_IMPLEMENT_TOKEN_FILE", str(STATE_DIR / "implement.token"))
).expanduser()
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}
SAFE_ENV_KEYS = {
    "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "__CF_USER_TEXT_ENCODING",
    "PATH", "LANG", "LC_ALL", "LC_CTYPE", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
}
CAO_ENV_KEYS = {"AGENT_JOB_CAO_URL", "AGENT_JOB_CAO_TOKEN", "AGENT_JOB_CAO_LAUNCH_TIMEOUT"}
CLAUDE_AUTH_KEYS = {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"}
KIMI_AUTH_KEYS = {"KIMI_API_KEY", "KIMI_CN_API_KEY", "MOONSHOT_API_KEY", "MOONSHOT_API_BASE"}
PROVIDER_AUTH_KEYS = {"claude": CLAUDE_AUTH_KEYS, "kimi": KIMI_AUTH_KEYS, "codex": set()}


class AlreadyRunning(RuntimeError):
    pass


def _now() -> float:
    return time.time()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _allowed_roots() -> list[Path]:
    return configured_allowed_roots()


def _safe_workdir(value: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise ValueError("Workdir must be an absolute path")
    path = candidate.resolve()
    if not path.is_dir():
        raise ValueError(f"Workdir does not exist or is not a directory: {path}")
    roots = [root for root in _allowed_roots() if root.exists()]
    if not roots:
        raise ValueError("No configured agent-job workspace roots exist; refusing to run fail-open")
    if not any(path == root or root in path.parents for root in roots):
        raise ValueError(f"Workdir is outside configured roots: {path}")
    if any(part.lower() in SENSITIVE_PATH_PARTS for part in path.parts):
        raise ValueError(f"Workdir is inside a credential or secret store: {path}")
    return path


def _find_binary(provider: str) -> str:
    env_name = f"AGENT_JOB_{provider.upper()}_BIN"
    known = {
        "claude": ["~/.local/bin/claude", "/opt/homebrew/bin/claude"],
        "kimi": ["~/.kimi-code/bin/kimi", "/opt/homebrew/bin/kimi"],
        "codex": ["/opt/homebrew/bin/codex", "~/.local/bin/codex"],
    }
    candidates = [os.environ.get(env_name, ""), shutil.which(provider)] + known[provider]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser().resolve()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    raise RuntimeError(f"{provider} CLI not found; set {env_name}")


def _provider_env(provider: str) -> dict[str, str]:
    inherited = os.environ
    env = {key: inherited[key] for key in SAFE_ENV_KEYS if inherited.get(key)}
    env.setdefault("HOME", str(Path.home()))
    env.setdefault("USER", Path.home().name)
    env.setdefault("LOGNAME", env["USER"])
    env.setdefault("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    profile: dict[str, str] = {}
    profile_path = os.environ.get("AGENT_JOB_PROFILE_ENV", "").strip()
    if profile_path and Path(profile_path).expanduser().is_file():
        for raw in Path(profile_path).expanduser().read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, value = line.split("=", 1)
            profile[key.strip()] = value.strip().strip('"').strip("'")
    for key in PROVIDER_AUTH_KEYS[provider]:
        value = profile.get(key) or inherited.get(key)
        if value:
            env[key] = value
    for key in (CLAUDE_AUTH_KEYS | KIMI_AUTH_KEYS) - PROVIDER_AUTH_KEYS[provider]:
        env.pop(key, None)
    env["AGENT_JOB_DEPTH"] = str(int(inherited.get("AGENT_JOB_DEPTH", "0") or 0) + 1)
    env["AGENT_JOB_PROVIDER"] = provider
    if provider == "kimi":
        env["KIMI_CODE_EXPERIMENTAL_FLAG"] = "1"
    return env


def _cao_bridge_env(provider: str) -> dict[str, str]:
    """Build the bridge environment without forwarding provider credentials."""
    env = _provider_env(provider)
    for key in CLAUDE_AUTH_KEYS | KIMI_AUTH_KEYS:
        env.pop(key, None)
    env.pop("KIMI_CODE_EXPERIMENTAL_FLAG", None)
    for key in CAO_ENV_KEYS:
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


class JobStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path.parent, 0o700)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                mode TEXT NOT NULL,
                workdir TEXT NOT NULL,
                prompt TEXT NOT NULL,
                owner TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                failure_kind TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                started_at REAL,
                updated_at REAL NOT NULL,
                last_output_at REAL,
                finished_at REAL,
                timeout_seconds INTEGER NOT NULL,
                soft_stall_seconds INTEGER NOT NULL,
                max_turns INTEGER NOT NULL,
                pid INTEGER,
                pgid INTEGER,
                exit_code INTEGER,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                log_path TEXT NOT NULL
            );
            """
        )
        columns = {str(row["name"]) for row in self.db.execute("PRAGMA table_info(jobs)")}
        if "idempotency_key" not in columns:
            self.db.execute("ALTER TABLE jobs ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT ''")
        if "request_hash" not in columns:
            self.db.execute("ALTER TABLE jobs ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''")
        if "binary_path" not in columns:
            self.db.execute("ALTER TABLE jobs ADD COLUMN binary_path TEXT NOT NULL DEFAULT ''")
        if "process_start" not in columns:
            self.db.execute("ALTER TABLE jobs ADD COLUMN process_start TEXT NOT NULL DEFAULT ''")
        if "execution_backend" not in columns:
            self.db.execute(
                "ALTER TABLE jobs ADD COLUMN execution_backend TEXT NOT NULL DEFAULT 'native'"
            )
        self.db.execute("CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at)")
        self.db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key <> ''"
        )
        self.db.execute(
            "UPDATE jobs SET prompt = '' WHERE status IN ('completed','failed','cancelled','interrupted')"
        )
        self.db.commit()
        try:
            os.chmod(path, 0o600)
        except FileNotFoundError:
            pass

    def create(self, spec: dict[str, Any], job_id: str, log_path: Path) -> dict[str, Any]:
        key = str(spec.get("idempotency_key") or "")
        if key:
            existing = self.db.execute("SELECT * FROM jobs WHERE idempotency_key = ?", (key,)).fetchone()
            if existing:
                job = dict(existing)
                if job.get("request_hash") != spec["request_hash"]:
                    raise ValueError("Idempotency key was already used for a different job specification")
                return job
        now = _now()
        self.db.execute(
            """INSERT INTO jobs (
                job_id, provider, model, mode, workdir, prompt, owner, status,
                created_at, updated_at, timeout_seconds, soft_stall_seconds,
                max_turns, log_path, idempotency_key, request_hash, execution_backend
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job_id, spec["provider"], spec["model"], spec["mode"], spec["workdir"],
                spec["prompt"], spec.get("owner", ""), now, now, spec["timeout_seconds"],
                spec["soft_stall_seconds"], spec["max_turns"], str(log_path), key,
                spec["request_hash"], spec.get("execution_backend", "native"),
            ),
        )
        self.db.commit()
        return self.get(job_id)

    def get(self, job_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            raise ValueError(f"Unknown job id: {job_id}")
        return dict(row)

    def update(self, job_id: str, **values: Any) -> dict[str, Any]:
        if not values:
            return self.get(job_id)
        values["updated_at"] = _now()
        columns = ", ".join(f"{name} = ?" for name in values)
        self.db.execute(f"UPDATE jobs SET {columns} WHERE job_id = ?", (*values.values(), job_id))
        self.db.commit()
        return self.get(job_id)

    def touch(self, job_id: str) -> None:
        self.db.execute("UPDATE jobs SET updated_at = ? WHERE job_id = ?", (_now(), job_id))
        self.db.commit()

    def queued(self) -> list[dict[str, Any]]:
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at"
        )]

    def claim(self, job_id: str) -> bool:
        cursor = self.db.execute(
            "UPDATE jobs SET status = 'launching', updated_at = ? WHERE job_id = ? AND status = 'queued'",
            (_now(), job_id),
        )
        self.db.commit()
        return cursor.rowcount == 1

    def running(self) -> list[dict[str, Any]]:
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM jobs WHERE status IN ('launching','running') ORDER BY created_at"
        )]

    def list(self, status: str = "", limit: int = 50, owner: str = "") -> list[dict[str, Any]]:
        if status == "possibly_stalled" and owner:
            rows = self.db.execute(
                """SELECT * FROM jobs WHERE status = 'running' AND instr(owner, ?) = 1
                   AND COALESCE(last_output_at, started_at, created_at) + soft_stall_seconds <= ?
                   ORDER BY created_at DESC LIMIT ?""",
                (owner, _now(), limit),
            )
        elif status == "possibly_stalled":
            rows = self.db.execute(
                """SELECT * FROM jobs WHERE status = 'running'
                   AND COALESCE(last_output_at, started_at, created_at) + soft_stall_seconds <= ?
                   ORDER BY created_at DESC LIMIT ?""",
                (_now(), limit),
            )
        elif status and owner:
            rows = self.db.execute(
                "SELECT * FROM jobs WHERE status = ? AND instr(owner, ?) = 1 ORDER BY created_at DESC LIMIT ?",
                (status, owner, limit),
            )
        elif status:
            rows = self.db.execute(
                "SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?", (status, limit)
            )
        elif owner:
            rows = self.db.execute(
                "SELECT * FROM jobs WHERE instr(owner, ?) = 1 ORDER BY created_at DESC LIMIT ?", (owner, limit)
            )
        else:
            rows = self.db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))
        return [dict(row) for row in rows]

    def reconcile(self) -> list[dict[str, Any]]:
        interrupted = self.running()
        now = _now()
        self.db.execute(
            """UPDATE jobs SET status = 'interrupted', failure_kind = 'supervisor_restart',
               message = 'Supervisor restarted while the job was running', prompt = '', finished_at = ?, updated_at = ?
               WHERE status IN ('launching','running')""",
            (now, now),
        )
        self.db.commit()
        return interrupted

    def prune(self, cutoff: float) -> list[str]:
        rows = self.db.execute(
            "SELECT log_path FROM jobs WHERE status IN ('completed','failed','cancelled','interrupted') AND finished_at < ?",
            (cutoff,),
        ).fetchall()
        self.db.execute(
            "DELETE FROM jobs WHERE status IN ('completed','failed','cancelled','interrupted') AND finished_at < ?",
            (cutoff,),
        )
        self.db.commit()
        return [str(row["log_path"]) for row in rows]


CommandBuilder = Callable[[dict[str, Any]], tuple[list[str], str | None, dict[str, str]]]


class Supervisor:
    def __init__(
        self,
        state_dir: Path = STATE_DIR,
        socket_path: Path = SOCKET_PATH,
        db_path: Path = DB_PATH,
        log_dir: Path = LOG_DIR,
        command_builder: CommandBuilder | None = None,
        binary_finder: Callable[[str], str] | None = None,
    ):
        self.state_dir = state_dir
        self.socket_path = socket_path
        self.log_dir = log_dir
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.log_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.state_dir, 0o700)
        os.chmod(self.log_dir, 0o700)
        self.store = JobStore(db_path)
        self.binary_finder = binary_finder or _find_binary
        self.command_builder = command_builder or self._build_command
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.processes: dict[str, asyncio.subprocess.Process] = {}
        self.log_locks: dict[str, asyncio.Lock] = {}
        self.last_output_writes: dict[str, float] = {}
        self.job_log_paths: dict[str, Path] = {}
        self.provider_limits = {
            "claude": int(os.environ.get("AGENT_JOB_CLAUDE_CONCURRENCY", "2")),
            "kimi": int(os.environ.get("AGENT_JOB_KIMI_CONCURRENCY", "1")),
            "codex": int(os.environ.get("AGENT_JOB_CODEX_CONCURRENCY", "2")),
        }
        self._stopping = False
        self._lock_handle = None

    def _build_command(self, job: dict[str, Any]) -> tuple[list[str], str | None, dict[str, str]]:
        provider = job["provider"]
        if job.get("execution_backend", "native") == "cao":
            bridge = SERVER_DIR / "cao_job_bridge.py"
            if not bridge.is_file():
                raise RuntimeError(f"CAO job bridge is missing: {bridge}")
            argv = [
                sys.executable,
                str(bridge),
                "--provider",
                provider,
                "--model",
                job["model"],
                "--mode",
                job["mode"],
                "--workdir",
                job["workdir"],
                "--job-id",
                job["job_id"],
            ]
            return argv, job["prompt"], _cao_bridge_env(provider)
        binary = self.binary_finder(provider)
        model = job["model"]
        mode = job["mode"]
        prompt = job["prompt"]
        max_turns = int(job["max_turns"])
        if provider == "claude":
            permission = "plan" if mode == "readonly" else "acceptEdits"
            tools = ["Read", "Glob", "Grep", "LS"] if mode == "readonly" else ["Read", "Glob", "Grep", "Edit", "Write"]
            argv = [
                binary, "-p", "--model", model, "--permission-mode", permission,
                "--allowed-tools", *tools,
            ]
            if max_turns > 0:
                argv.extend(["--max-turns", str(max_turns)])
            argv.extend(["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'])
            if mode == "readonly":
                argv.append("--safe-mode")
            return argv, prompt, _provider_env(provider)
        if provider == "kimi":
            agent_name = "kimi_read_only_reviewer.md" if mode == "readonly" else "kimi_implementation_agent.md"
            agent_path = SERVER_DIR / agent_name
            if not agent_path.is_file():
                raise RuntimeError(f"Kimi agent definition is missing: {agent_path}")
            return [binary, "--model", model, "--agent-file", str(agent_path), "--prompt", prompt], None, _provider_env(provider)
        sandbox = "read-only" if mode == "readonly" else "workspace-write"
        argv = [
            binary, "exec", "--ignore-user-config", "-C", job["workdir"],
            "-s", sandbox, "--json", "--skip-git-repo-check",
        ]
        if model:
            argv.extend(["--model", model])
        argv.append("-")
        return argv, prompt, _provider_env(provider)

    def _public(self, job: dict[str, Any]) -> dict[str, Any]:
        result = {key: value for key, value in job.items() if key != "prompt"}
        if result["status"] == "running":
            last = result.get("last_output_at") or result.get("started_at") or result["created_at"]
            silence = max(0, int(_now() - float(last)))
            result["seconds_without_output"] = silence
            if silence >= int(result["soft_stall_seconds"]):
                result["status"] = "possibly_stalled"
        return result

    async def _append_log(self, job_id: str, stream: str, data: bytes) -> None:
        if not data:
            return
        lock = self.log_locks.setdefault(job_id, asyncio.Lock())
        prefix = f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {stream}] ".encode()
        async with lock:
            log_path = self.job_log_paths[job_id]
            combined_budget = MAX_JOB_LOG_BYTES // 2
            raw_budget = MAX_JOB_LOG_BYTES - combined_budget
            combined_size = log_path.stat().st_size if log_path.exists() else 0
            combined_remaining = max(0, combined_budget - combined_size)
            truncation_marker = b"\n[output truncated at configured log budget]\n"
            if combined_remaining:
                combined = prefix + data + (b"" if data.endswith(b"\n") else b"\n")
                with log_path.open("ab") as handle:
                    if len(combined) > combined_remaining and combined_remaining > len(truncation_marker):
                        handle.write(combined[:combined_remaining - len(truncation_marker)] + truncation_marker)
                    else:
                        handle.write(combined[:combined_remaining])
            elif combined_size >= combined_budget and log_path.is_file():
                with log_path.open("r+b") as handle:
                    handle.seek(max(0, combined_budget - len(truncation_marker)))
                    handle.write(truncation_marker)
            stream_path = Path(f"{log_path}.{stream}")
            stdout_path = Path(f"{log_path}.stdout")
            stderr_path = Path(f"{log_path}.stderr")
            raw_size = sum(path.stat().st_size for path in (stdout_path, stderr_path) if path.exists())
            raw_remaining = max(0, raw_budget - raw_size)
            if raw_remaining:
                with stream_path.open("ab") as handle:
                    handle.write(data[:raw_remaining])
        now = _now()
        if now - self.last_output_writes.get(job_id, 0) >= 1:
            self.store.update(job_id, last_output_at=now)
            self.last_output_writes[job_id] = now

    async def _stream(self, job_id: str, stream: str, reader: asyncio.StreamReader | None) -> None:
        if reader is None:
            return
        while True:
            chunk = await reader.read(16 * 1024)
            if not chunk:
                return
            await self._append_log(job_id, stream, chunk)

    async def _terminate(self, proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except Exception:
            proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=10)
            return
        except asyncio.TimeoutError:
            pass
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        except Exception:
            proc.kill()
        await proc.wait()

    async def _ps_field(self, pid: int, field: str) -> str:
        process = await asyncio.create_subprocess_exec(
            "ps", "-p", str(pid), "-o", f"{field}=",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await process.communicate()
        return stdout.decode("utf-8", errors="replace").strip()

    async def _run_job(self, job_id: str) -> None:
        proc: asyncio.subprocess.Process | None = None
        streams: list[asyncio.Task[None]] = []
        try:
            job = self.store.get(job_id)
            if job["status"] != "launching":
                return
            if job["cancel_requested"]:
                self.store.update(
                    job_id, status="cancelled", failure_kind="cancelled",
                    message="Cancelled before provider launch", prompt="", finished_at=_now(),
                )
                return
            if _now() >= float(job["created_at"]) + int(job["timeout_seconds"]):
                self.store.update(
                    job_id, status="failed", failure_kind="queue_timeout",
                    message="Hard deadline reached before a provider slot became available", prompt="", finished_at=_now(),
                )
                return
            argv, stdin_text, env = self.command_builder(job)
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=job["workdir"],
                env=env,
                stdin=asyncio.subprocess.PIPE if stdin_text is not None else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            self.processes[job_id] = proc
            self.job_log_paths[job_id] = Path(job["log_path"])
            process_start = await self._ps_field(proc.pid, "lstart")
            live_command = await self._ps_field(proc.pid, "command")
            live_first_arg = shlex.split(live_command)[0] if live_command else argv[0]
            current = self.store.get(job_id)
            if current["cancel_requested"] or current["status"] != "launching":
                await self._terminate(proc)
                self.store.update(
                    job_id, status="cancelled", failure_kind="cancelled",
                    message="Cancelled during provider launch", prompt="", exit_code=proc.returncode, finished_at=_now(),
                )
                return
            started = _now()
            self.store.update(
                job_id, status="running", started_at=started, last_output_at=started,
                pid=proc.pid, pgid=proc.pid, binary_path=str(Path(live_first_arg).resolve()),
                process_start=process_start, prompt="", message="",
            )
            if stdin_text is not None and proc.stdin is not None:
                proc.stdin.write(stdin_text.encode("utf-8"))
                await proc.stdin.drain()
                proc.stdin.close()
            streams = [
                asyncio.create_task(self._stream(job_id, "stdout", proc.stdout)),
                asyncio.create_task(self._stream(job_id, "stderr", proc.stderr)),
            ]
            deadline = float(job["created_at"]) + int(job["timeout_seconds"])
            outcome = "completed"
            failure_kind = ""
            message = ""
            next_heartbeat = 0.0
            while proc.returncode is None:
                current = self.store.get(job_id)
                if current["cancel_requested"]:
                    outcome, failure_kind, message = "cancelled", "cancelled", "Cancelled by caller"
                    await self._terminate(proc)
                    break
                if _now() >= deadline:
                    outcome, failure_kind = "failed", "timeout"
                    message = f"Hard deadline reached after {job['timeout_seconds']} seconds"
                    await self._terminate(proc)
                    break
                if _now() >= next_heartbeat:
                    self.store.touch(job_id)
                    next_heartbeat = _now() + 5
                try:
                    await asyncio.wait_for(proc.wait(), timeout=1)
                except asyncio.TimeoutError:
                    pass
            if proc.returncode is None:
                await proc.wait()
            await asyncio.gather(*streams, return_exceptions=True)
            if outcome == "completed" and proc.returncode != 0:
                outcome, failure_kind, message = "failed", "provider_exit", f"Provider exited with code {proc.returncode}"
            self.store.update(
                job_id, status=outcome, failure_kind=failure_kind, message=message,
                prompt="", exit_code=proc.returncode, finished_at=_now(),
            )
        except asyncio.CancelledError:
            if proc is not None:
                await self._terminate(proc)
            self.store.update(
                job_id, status="interrupted", failure_kind="supervisor_shutdown",
                message="Supervisor stopped while the job was running", prompt="", finished_at=_now(),
            )
            raise
        except Exception as exc:
            if proc is not None:
                await self._terminate(proc)
            self.store.update(
                job_id, status="failed", failure_kind="launch_error", message=str(exc), finished_at=_now(),
                prompt="",
            )
        finally:
            self.processes.pop(job_id, None)
            self.tasks.pop(job_id, None)
            self.log_locks.pop(job_id, None)
            self.last_output_writes.pop(job_id, None)
            self.job_log_paths.pop(job_id, None)

    async def _scheduler(self) -> None:
        next_prune = 0.0
        while not self._stopping:
            try:
                if _now() >= next_prune:
                    for base in self.store.prune(_now() - JOB_RETENTION_SECONDS):
                        for candidate in (Path(base), Path(f"{base}.stdout"), Path(f"{base}.stderr")):
                            try:
                                candidate.unlink()
                            except FileNotFoundError:
                                pass
                    next_prune = _now() + 3600
                active = Counter(self.store.get(job_id)["provider"] for job_id in self.tasks)
                for job in self.store.queued():
                    job_id = job["job_id"]
                    provider = job["provider"]
                    if job_id in self.tasks or active[provider] >= max(1, self.provider_limits[provider]):
                        continue
                    if not self.store.claim(job_id):
                        continue
                    task = asyncio.create_task(self._run_job(job_id))
                    self.tasks[job_id] = task
                    active[provider] += 1
            except Exception as exc:
                print(f"agent-job scheduler error: {exc}", file=sys.stderr, flush=True)
                await asyncio.sleep(1)
                continue
            await asyncio.sleep(0.25)

    async def _cleanup_interrupted(self) -> None:
        for job in self.store.reconcile():
            pgid = job.get("pgid")
            if not pgid:
                continue
            pid = int(job.get("pid") or 0)
            try:
                process_start = await self._ps_field(pid, "lstart")
                live_pgid = await self._ps_field(pid, "pgid")
                command = await self._ps_field(pid, "command")
                first_arg = shlex.split(command)[0] if command else ""
            except (OSError, ValueError):
                continue
            if (
                not process_start
                or process_start != str(job.get("process_start") or "")
                or int(live_pgid or 0) != int(pgid)
                or not first_arg
                or Path(first_arg).expanduser().resolve() != Path(str(job.get("binary_path") or "")).expanduser().resolve()
            ):
                self.store.update(job["job_id"], message="Restart cleanup skipped: process identity did not match")
                continue
            try:
                os.killpg(int(pgid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                continue
            await asyncio.sleep(1)
            try:
                os.killpg(int(pgid), 0)
                os.killpg(int(pgid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass

    def submit(self, payload: dict[str, Any]) -> dict[str, Any]:
        if int(payload.get("caller_depth") or 0) > 0:
            raise RuntimeError("Recursive cross-agent delegation is not allowed")
        provider = str(payload.get("provider") or "")
        mode = str(payload.get("mode") or "")
        model = str(payload.get("model") or "")
        prompt = str(payload.get("prompt") or "")
        if provider not in self.provider_limits:
            raise ValueError(f"Unsupported provider: {provider}")
        execution_backend = os.environ.get("AGENT_JOB_EXECUTION_BACKEND", "native")
        if execution_backend not in {"native", "cao"}:
            raise ValueError(f"Unsupported execution backend: {execution_backend}")
        if execution_backend != "cao":
            self.binary_finder(provider)
        if mode not in {"readonly", "implement"}:
            raise ValueError(f"Unsupported mode: {mode}")
        if mode == "implement":
            if os.environ.get("AGENT_JOB_ALLOW_IMPLEMENT") != "1":
                raise PermissionError("Durable implement mode is disabled by supervisor policy")
            try:
                expected_capability = IMPLEMENT_TOKEN_PATH.read_text(encoding="utf-8").strip()
            except OSError as exc:
                raise PermissionError("Implementation capability is unavailable") from exc
            supplied_capability = str(payload.get("implement_capability") or "")
            if not expected_capability or not hmac.compare_digest(supplied_capability, expected_capability):
                raise PermissionError("Invalid implementation capability")
        if not MODEL_PATTERN.fullmatch(model):
            raise ValueError("Model contains unsupported characters")
        if not prompt.strip() or len(prompt.encode("utf-8")) > MAX_PROMPT_BYTES:
            raise ValueError(f"Prompt must contain 1 to {MAX_PROMPT_BYTES} UTF-8 bytes")
        workdir = _safe_workdir(str(payload.get("workdir") or ""))
        timeout = max(MIN_TIMEOUT_SECONDS, min(int(payload.get("timeout_seconds") or 2700), MAX_TIMEOUT_SECONDS))
        requested_max_turns = int(payload.get("max_turns") or 0)
        max_turns = 0 if requested_max_turns <= 0 else min(requested_max_turns, 10_000)
        if execution_backend == "cao" and mode == "readonly" and provider == "codex":
            raise ValueError("CAO cannot enforce read-only Codex execution; use the native backend")
        if execution_backend == "cao" and max_turns > 0:
            raise ValueError("CAO does not support an explicit provider turn ceiling")
        soft_stall = max(30, min(int(payload.get("soft_stall_seconds") or DEFAULT_SOFT_STALL_SECONDS), timeout))
        spec = {
            "provider": provider, "model": model, "mode": mode, "workdir": str(workdir),
            "prompt": prompt, "owner": str(payload.get("owner") or "")[:200],
            "timeout_seconds": timeout, "soft_stall_seconds": soft_stall, "max_turns": max_turns,
            "execution_backend": execution_backend,
            "idempotency_key": str(payload.get("idempotency_key") or "")[:200],
        }
        hash_fields = {key: spec[key] for key in (
            "provider", "model", "mode", "workdir", "prompt", "timeout_seconds", "max_turns",
            "execution_backend",
        )}
        spec["request_hash"] = hashlib.sha256(_json(hash_fields).encode("utf-8")).hexdigest()
        job_id = str(uuid.uuid4())
        log_path = self.log_dir / f"{job_id}.log"
        job = self.store.create(spec, job_id, log_path)
        return self._public(self.store.get(job["job_id"]))

    def read(self, payload: dict[str, Any]) -> dict[str, Any]:
        job = self.store.get(str(payload.get("job_id") or ""))
        cursor = max(0, int(payload.get("cursor") or 0))
        max_bytes = max(1, min(int(payload.get("max_bytes") or 64_000), MAX_READ_BYTES))
        terminal = job["status"] in TERMINAL_STATUSES
        output_budget = max_bytes if not terminal else max(1, max_bytes // 2)
        path = Path(job["log_path"])
        output = ""
        next_cursor = cursor
        if path.is_file():
            size = path.stat().st_size
            cursor = min(cursor, size)
            with path.open("rb") as handle:
                handle.seek(cursor)
                data = handle.read(output_budget)
            output = data.decode("utf-8", errors="replace")
            next_cursor = cursor + len(data)
        result = {"job": self._public(job), "cursor": next_cursor, "output": output}
        if payload.get("stream_cursors"):
            for stream in ("stdout", "stderr"):
                stream_cursor = max(0, int(payload.get(f"{stream}_cursor") or 0))
                stream_path = Path(f"{job['log_path']}.{stream}")
                size = stream_path.stat().st_size if stream_path.is_file() else 0
                stream_cursor = min(stream_cursor, size)
                data = b""
                if stream_path.is_file():
                    with stream_path.open("rb") as handle:
                        handle.seek(stream_cursor)
                        data = handle.read(max_bytes)
                result[f"{stream}_output"] = data.decode("utf-8", errors="replace")
                result[f"{stream}_cursor"] = stream_cursor + len(data)
                result[f"{stream}_size"] = size
        if terminal:
            stream_budget = max(1, max_bytes // 4)
            for stream in ("stdout", "stderr"):
                stream_path = Path(f"{job['log_path']}.{stream}")
                if stream_path.is_file():
                    size = stream_path.stat().st_size
                    with stream_path.open("rb") as handle:
                        handle.seek(max(0, size - stream_budget))
                        data = handle.read(stream_budget)
                    result[stream] = data.decode("utf-8", errors="replace")
                else:
                    result[stream] = ""
        return result

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw = await asyncio.wait_for(reader.readline(), timeout=10)
            if len(raw) > MAX_PROMPT_BYTES + 64_000:
                raise ValueError("Request is too large")
            payload = json.loads(raw.decode("utf-8"))
            action = payload.get("action")
            if action == "ping":
                result = {"status": "ok", "pid": os.getpid(), "socket": str(self.socket_path)}
            elif action == "submit":
                result = self.submit(payload)
            elif action == "read":
                result = self.read(payload)
            elif action == "list":
                limit = max(1, min(int(payload.get("limit") or 50), 200))
                requested_status = str(payload.get("status") or "")
                owner = str(payload.get("owner") or "")[:200]
                jobs = [self._public(job) for job in self.store.list(requested_status, limit, owner)]
                result = {"jobs": jobs}
            elif action == "cancel":
                job_id = str(payload.get("job_id") or "")
                job = self.store.get(job_id)
                if job["status"] not in TERMINAL_STATUSES:
                    job = self.store.update(job_id, cancel_requested=1, message="Cancellation requested")
                    if job["status"] == "queued":
                        job = self.store.update(
                            job_id, status="cancelled", failure_kind="cancelled",
                            message="Cancelled before launch", prompt="", finished_at=_now(),
                        )
                result = self._public(job)
            else:
                raise ValueError(f"Unsupported action: {action}")
            response = {"ok": True, "result": result}
        except Exception as exc:
            response = {"ok": False, "error": str(exc)}
        writer.write((_json(response) + "\n").encode("utf-8"))
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    async def serve(self) -> None:
        lock_path = self.state_dir / "supervisor.lock"
        self._lock_handle = lock_path.open("a+")
        try:
            fcntl.flock(self._lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise AlreadyRunning("Another agent job supervisor already owns the state directory") from exc
        await self._cleanup_interrupted()
        if self.socket_path.exists():
            self.socket_path.unlink()
        server = await asyncio.start_unix_server(
            self.handle, path=str(self.socket_path), limit=(2 * MAX_PROMPT_BYTES) + 64_000
        )
        os.chmod(self.socket_path, stat.S_IRUSR | stat.S_IWUSR)
        scheduler = asyncio.create_task(self._scheduler())
        try:
            async with server:
                await server.serve_forever()
        finally:
            self._stopping = True
            scheduler.cancel()
            await asyncio.gather(scheduler, return_exceptions=True)
            for task in list(self.tasks.values()):
                task.cancel()
            await asyncio.gather(*self.tasks.values(), return_exceptions=True)
            if self.socket_path.exists():
                self.socket_path.unlink()
            if self._lock_handle is not None:
                fcntl.flock(self._lock_handle.fileno(), fcntl.LOCK_UN)
                self._lock_handle.close()
                self._lock_handle = None


async def _run_supervisor() -> None:
    supervisor = Supervisor()
    task = asyncio.create_task(supervisor.serve())
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, task.cancel)
        except NotImplementedError:
            pass
    try:
        await task
    except asyncio.CancelledError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("serve",), nargs="?", default="serve")
    args = parser.parse_args()
    del args
    try:
        asyncio.run(_run_supervisor())
    except KeyboardInterrupt:
        return 0
    except AlreadyRunning as exc:
        print(str(exc), file=sys.stderr)
        return 0
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
