#!/usr/bin/env python3
"""Portable read-only Claude Code and Kimi Code review sidecars over MCP."""

from __future__ import annotations

import asyncio
import fnmatch
import json
import os
import re
import shutil
import signal
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP


SERVER_DIR = Path(__file__).resolve().parent
KIMI_AGENT_FILE = SERVER_DIR / "kimi_read_only_reviewer.md"
DEFAULT_WORKDIR = Path(
    os.environ.get("REVIEW_SIDECARS_DEFAULT_WORKDIR", str(Path.home() / "Documents"))
).expanduser()
DEFAULT_SYNC_TIMEOUT_SECONDS = 550
DEFAULT_ASYNC_TIMEOUT_SECONDS = 1800
MAX_SYNC_TIMEOUT_SECONDS = 550
MAX_ASYNC_TIMEOUT_SECONDS = 7200
MIN_TIMEOUT_SECONDS = 5
MAX_CONTEXT_FILE_BYTES = 64_000
MAX_GIT_CONTEXT_BYTES = 256_000
MAX_PROMPT_BYTES = 400_000
MAX_ASYNC_JOBS = 2
MAX_CONCURRENT_RUNS = 4
DEFAULT_JOB_TTL_SECONDS = MAX_ASYNC_TIMEOUT_SECONDS + 3600
CLAUDE_READ_ONLY_TOOLS = ("Read", "Glob", "Grep", "LS")
CLAUDE_AUTH_KEYS = {
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
}
KIMI_AUTH_KEYS = {
    "KIMI_API_KEY",
    "KIMI_CN_API_KEY",
    "MOONSHOT_API_KEY",
    "MOONSHOT_API_BASE",
}
SAFE_ENV_KEYS = {
    "HOME",
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
}
SECRET_FILE_PATTERNS = (
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_rsa.*",
    "id_ed25519",
    "id_ed25519.*",
    "*credentials*",
    "*secret*",
    "*.p12",
    "*.pfx",
)
SECRET_DIRECTORY_NAMES = {".ssh", ".aws", ".azure", ".gnupg", "secrets", "credentials"}
SENSITIVE_CONTENT_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(
        r"(?im)^(?P<prefix>\s*(?:api[_-]?key|token|secret|password|passwd|auth[_-]?token)\s*[:=]\s*)"
        r"(?P<value>[^\s#][^\r\n]*)$"
    ),
)

MODE_PROMPTS = {
    "planning": "Return a concise plan, risks, assumptions, sequencing, and verification steps.",
    "design": (
        "Review as a senior product designer and frontend UX specialist. Focus on hierarchy, "
        "interaction ergonomics, accessibility, responsive behavior, and concrete improvements."
    ),
    "design_brief": (
        "Create a Codex-ready UI brief covering target user, jobs, hierarchy, interactions, "
        "states, responsiveness, accessibility, visual direction, and acceptance criteria."
    ),
    "ui_implementation_plan": (
        "Turn the design goal into a read-only implementation plan covering components, state, "
        "files, tokens/CSS, risks, and visual verification."
    ),
    "visual_qa": (
        "Perform visual QA and return prioritized P0/P1/P2 findings with exact fixes. Check layout, "
        "hierarchy, spacing, typography, color, responsiveness, accessibility, and all UI states."
    ),
    "design_system": (
        "Extract or critique tokens, typography, color semantics, spacing, components, interaction "
        "patterns, motion, voice, anti-patterns, and gaps."
    ),
    "product": (
        "Review from a product/operator perspective: user value, scope, positioning, workflow fit, "
        "edge cases, and the sharpest decision recommendation."
    ),
    "research": (
        "Produce a decision-ready synthesis that separates facts, inferences, unknowns, and next checks."
    ),
    "code_review": (
        "Perform a read-only code review. Lead with bugs, regressions, architecture risks, security or "
        "privacy issues, and missing tests. Include severity, evidence, and concrete remediation."
    ),
}

PROVIDER_AUTH_KEYS = {"claude": CLAUDE_AUTH_KEYS, "kimi": KIMI_AUTH_KEYS}
ALL_PROVIDER_AUTH_KEYS = CLAUDE_AUTH_KEYS | KIMI_AUTH_KEYS
ASYNC_JOBS: dict[str, dict[str, Any]] = {}
RUN_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_RUNS)
mcp = FastMCP("review-sidecars")


def _configured_path_list(name: str) -> list[Path]:
    raw = os.environ.get(name, "")
    return [Path(item).expanduser().resolve() for item in raw.split(os.pathsep) if item.strip()]


def _allowed_roots() -> list[Path]:
    """Return an optional administrator lockdown; empty means unrestricted."""
    return [root for root in _configured_path_list("REVIEW_SIDECARS_ALLOWED_ROOTS") if root.exists()]


def _path_is_within(path: Path, roots: list[Path]) -> bool:
    return any(path == root or root in path.parents for root in roots)


def _sensitive_workspace_roots() -> tuple[list[Path], list[Path]]:
    home = Path.home().resolve()
    denied = [
        home / ".ssh",
        home / ".aws",
        home / ".azure",
        home / ".gnupg",
        home / ".kube",
        home / ".docker",
        home / ".kimi-code",
        home / ".codex",
        home / ".hermes",
        home / ".atum",
        home / "Library" / "Keychains",
    ]
    project_exceptions = [
        home / ".codex" / "worktrees",
        home / ".hermes" / "hermes-agent",
        home / ".hermes" / "worktrees",
        home / ".atum" / "worktrees",
    ]
    return (
        [path.resolve() for path in denied],
        [path.resolve() for path in project_exceptions],
    )


def _is_sensitive_workspace_path(path: Path) -> bool:
    denied, exceptions = _sensitive_workspace_roots()
    if _path_is_within(path, exceptions):
        return False
    return _path_is_within(path, denied)


def _safe_workdir(workdir: str | None) -> Path:
    path = Path(workdir).expanduser().resolve() if workdir else DEFAULT_WORKDIR.resolve()
    if not path.is_dir():
        raise ValueError(f"Review workdir does not exist or is not a directory: {path}")
    roots = _allowed_roots()
    if roots and not _path_is_within(path, roots):
        raise ValueError(f"Refusing review outside configured workspaces: {path}")
    if _is_sensitive_workspace_path(path):
        raise ValueError(f"Refusing review inside a credential or private-data store: {path}")
    return path


def _safe_path(value: str, cwd: Path) -> Path:
    raw = Path(value).expanduser()
    path = (cwd / raw).resolve() if not raw.is_absolute() else raw.resolve()
    roots = _allowed_roots()
    if roots and not _path_is_within(path, roots):
        raise ValueError(f"Refusing context outside configured workspaces: {path}")
    if _is_sensitive_workspace_path(path):
        raise ValueError(f"Refusing context inside a credential or private-data store: {path}")
    return path


def _is_secret_path(path: Path) -> bool:
    lowered_parts = [part.lower() for part in path.parts]
    if any(part in SECRET_DIRECTORY_NAMES for part in lowered_parts[:-1]):
        return True
    return any(fnmatch.fnmatch(path.name.lower(), pattern.lower()) for pattern in SECRET_FILE_PATTERNS)


def _profile_env_values() -> dict[str, str]:
    profile_path = os.environ.get("REVIEW_SIDECARS_PROFILE_ENV", "").strip()
    if not profile_path:
        return {}
    path = Path(profile_path).expanduser()
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _provider_env(provider: str) -> dict[str, str]:
    if provider not in PROVIDER_AUTH_KEYS:
        raise ValueError(f"Unknown review provider: {provider}")
    inherited = os.environ
    env = {key: inherited[key] for key in SAFE_ENV_KEYS if inherited.get(key)}
    env.setdefault("HOME", str(Path.home()))
    env.setdefault("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    profile = _profile_env_values()
    for key in PROVIDER_AUTH_KEYS[provider]:
        value = profile.get(key) or inherited.get(key)
        if value:
            env[key] = value
    for key in ALL_PROVIDER_AUTH_KEYS - PROVIDER_AUTH_KEYS[provider]:
        env.pop(key, None)
    if provider == "kimi":
        env["KIMI_CODE_EXPERIMENTAL_FLAG"] = "1"
    return env


def _find_binary(provider: str) -> str:
    env_name = f"REVIEW_SIDECARS_{provider.upper()}_BIN"
    configured = os.environ.get(env_name, "").strip()
    candidate = configured or shutil.which(provider, path=_provider_env(provider).get("PATH"))
    if not candidate:
        raise RuntimeError(f"{provider} CLI not found; set {env_name}")
    path = Path(candidate).expanduser().resolve()
    if not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError(f"{provider} CLI is not executable: {path}")
    return str(path)


def _timeout(value: int | None, *, asynchronous: bool) -> int:
    default = DEFAULT_ASYNC_TIMEOUT_SECONDS if asynchronous else DEFAULT_SYNC_TIMEOUT_SECONDS
    maximum = MAX_ASYNC_TIMEOUT_SECONDS if asynchronous else MAX_SYNC_TIMEOUT_SECONDS
    try:
        parsed = int(value if value is not None else default)
    except (TypeError, ValueError):
        parsed = default
    return max(MIN_TIMEOUT_SECONDS, min(parsed, maximum))


def _context_files_section(context_files: list[str] | None, cwd: Path) -> str:
    if not context_files:
        return ""
    sections = ["Context files supplied by caller:"]
    for value in context_files:
        if not str(value).strip():
            continue
        path = _safe_path(str(value), cwd)
        if _is_secret_path(path):
            raise ValueError(f"Refusing secret-like context file: {path}")
        sections.append(f"\n--- {path} ---")
        if not path.exists():
            sections.append("[missing]")
        elif path.is_dir():
            sections.append("[directory supplied; inspect with read-only tools if needed]")
        else:
            data = path.read_bytes()[:MAX_CONTEXT_FILE_BYTES]
            text, redactions = _redact_sensitive_content(data.decode("utf-8", errors="replace"))
            if path.stat().st_size > MAX_CONTEXT_FILE_BYTES:
                text += "\n[truncated]"
            if redactions:
                text += f"\n[redacted {redactions} secret-like value(s)]"
            sections.append(text)
    return "\n".join(sections).strip()


def _redact_sensitive_content(text: str) -> tuple[str, int]:
    redactions = 0
    for pattern in SENSITIVE_CONTENT_PATTERNS:
        def replace(match: re.Match[str]) -> str:
            nonlocal redactions
            redactions += 1
            prefix = match.groupdict().get("prefix")
            return f"{prefix}[REDACTED]" if prefix is not None else "[REDACTED]"

        text = pattern.sub(replace, text)
    return text, redactions


def _git_review_context(cwd: Path) -> str:
    if not (cwd / ".git").exists() and not _run_git(cwd, ["rev-parse", "--git-dir"])[0]:
        return ""
    chunks = []
    status_ok, status = _run_git(cwd, ["status", "--short"])
    if status_ok and status.strip():
        chunks.append(f"--- git status (paths only) ---\n{status.strip()}")

    names_ok, raw_names = _run_git(cwd, ["diff", "--name-only", "-z", "HEAD"])
    safe_names: list[str] = []
    omitted = 0
    if names_ok:
        for name in raw_names.split("\0"):
            if not name:
                continue
            try:
                path = _safe_path(name, cwd)
            except ValueError:
                omitted += 1
                continue
            if _is_secret_path(path):
                omitted += 1
                continue
            safe_names.append(name)
    for index in range(0, min(len(safe_names), 500), 100):
        batch = safe_names[index:index + 100]
        ok, output = _run_git(cwd, ["diff", "--no-ext-diff", "--no-color", "HEAD", "--", *batch])
        if ok and output.strip():
            chunks.append(f"--- working tree diff (safe paths {index + 1}-{index + len(batch)}) ---\n{output.strip()}")
    if omitted:
        chunks.append(f"[omitted {omitted} secret-like or out-of-scope changed path(s)]")
    if len(safe_names) > 500:
        chunks.append(f"[omitted {len(safe_names) - 500} additional changed path(s)]")
    joined, redactions = _redact_sensitive_content("\n\n".join(chunks))
    if redactions:
        joined += f"\n[redacted {redactions} secret-like value(s) from Git context]"
    encoded = joined.encode("utf-8")
    if len(encoded) > MAX_GIT_CONTEXT_BYTES:
        joined = encoded[:MAX_GIT_CONTEXT_BYTES].decode("utf-8", errors="replace") + "\n[truncated]"
    return joined


def _run_git(cwd: Path, args: list[str]) -> tuple[bool, str]:
    env = {key: value for key, value in _provider_env("kimi").items() if key not in ALL_PROVIDER_AUTH_KEYS}
    env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_EXTERNAL_DIFF": "", "GIT_PAGER": "cat"})
    try:
        result = subprocess.run(
            ["git", "-c", "core.pager=cat", "-c", "diff.external=", *args],
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False, ""
    return result.returncode == 0, result.stdout.decode("utf-8", errors="replace")


def _build_prompt(
    provider: str,
    instructions: str,
    *,
    preset: str | None,
    context_text: str | None,
    context_files: list[str] | None,
    expected_output: str | None,
    cwd: Path,
    include_git_diff: bool,
) -> str:
    if not instructions or not instructions.strip():
        raise ValueError("instructions are required")
    guidance = MODE_PROMPTS.get((preset or "").strip(), "")
    parts = [
        f"You are {provider.title()} Code acting as a read-only specialist advisor for Codex and Hermes.",
        "Return the final answer directly. Do not edit files, execute commands, send messages, or change external systems.",
        "Use only read-only inspection tools. Keep the result decision-oriented, evidence-backed, and actionable.",
    ]
    if preset:
        parts.extend(["", f"Review mode: {preset}"])
    if guidance:
        parts.append(f"Mode guidance: {guidance}")
    parts.extend(["", f"Task:\n{instructions.strip()}"])
    if expected_output and expected_output.strip():
        parts.extend(["", f"Expected output shape:\n{expected_output.strip()}"])
    if context_text and context_text.strip():
        parts.extend(["", f"Additional context:\n{context_text.strip()}"])
    if include_git_diff:
        git_context = _git_review_context(cwd)
        if git_context:
            parts.extend(["", f"Current local Git context:\n{git_context}"])
    file_context = _context_files_section(context_files, cwd)
    if file_context:
        parts.extend(["", file_context])
    prompt = "\n".join(parts).strip()
    prompt_bytes = len(prompt.encode("utf-8"))
    if prompt_bytes > MAX_PROMPT_BYTES:
        raise ValueError(
            f"Review prompt is too large ({prompt_bytes} bytes); maximum is {MAX_PROMPT_BYTES}"
        )
    return prompt


def _command(provider: str, prompt: str, model: str, cwd: Path) -> list[str]:
    binary = _find_binary(provider)
    if provider == "claude":
        return [
            binary,
            "-p",
            prompt,
            "--model",
            model,
            "--safe-mode",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--permission-mode",
            "plan",
            "--allowed-tools",
            *CLAUDE_READ_ONLY_TOOLS,
            "--max-turns",
            os.environ.get("REVIEW_SIDECARS_CLAUDE_MAX_TURNS", "60"),
        ]
    if not KIMI_AGENT_FILE.is_file():
        raise RuntimeError(f"Kimi read-only agent file is missing: {KIMI_AGENT_FILE}")
    return [
        binary,
        "--model",
        model,
        "--agent-file",
        str(KIMI_AGENT_FILE),
        "--prompt",
        prompt,
    ]


async def _terminate_process(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except Exception:
        proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
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


async def _run_provider(
    provider: str,
    instructions: str,
    *,
    workdir: str | None,
    preset: str | None,
    model: str,
    timeout_seconds: int | None,
    context_files: list[str] | None = None,
    context_text: str | None = None,
    expected_output: str | None = None,
    include_git_diff: bool = False,
    asynchronous: bool = False,
    on_started=None,
) -> dict[str, Any]:
    cwd = _safe_workdir(workdir)
    timeout = _timeout(timeout_seconds, asynchronous=asynchronous)
    prompt = _build_prompt(
        provider,
        instructions,
        preset=preset,
        context_text=context_text,
        context_files=context_files,
        expected_output=expected_output,
        cwd=cwd,
        include_git_diff=include_git_diff,
    )
    command = _command(provider, prompt, model, cwd)
    env = _provider_env(provider)
    async with RUN_SEMAPHORE:
        if on_started:
            on_started()
        started_at = time.time()
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(cwd),
            env=env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            await _terminate_process(proc)
            raise TimeoutError(f"{provider.title()} Code timed out after {timeout}s") from exc
        except asyncio.CancelledError:
            await _terminate_process(proc)
            raise
    return {
        "status": "completed" if proc.returncode == 0 else "failed",
        "returncode": proc.returncode,
        "output": stdout.decode("utf-8", errors="replace").strip(),
        "stderr": stderr.decode("utf-8", errors="replace").strip(),
        "elapsed_seconds": round(time.time() - started_at, 3),
        "provider": provider,
        "model": model,
        "workdir": str(cwd),
    }


def _format_result(result: dict[str, Any], *, metadata: bool = False, attempts: list[str] | None = None) -> str:
    output = str(result.get("output") or "").strip()
    error = str(result.get("stderr") or "").strip()
    if int(result.get("returncode") or 0) != 0:
        provider = str(result.get("provider") or "review").title()
        raise RuntimeError(f"{provider} Code exited {result.get('returncode')}: {error or output}")
    if error and os.environ.get("REVIEW_SIDECARS_INCLUDE_STDERR") == "1":
        output = f"{output}\n\n[{result.get('provider')} stderr]\n{error}".strip()
    if metadata:
        tried = ",".join(attempts or [str(result.get("provider"))])
        header = (
            f"[review-sidecars provider={result.get('provider')} model={result.get('model')} "
            f"attempts={tried}]"
        )
        return f"{header}\n\n{output}".strip()
    return output


async def _run_with_fallback(
    instructions: str,
    *,
    preset: str,
    workdir: str | None,
    primary: tuple[str, str],
    fallback: tuple[str, str],
    timeout_seconds: int,
    include_git_diff: bool,
) -> str:
    attempts: list[str] = []
    errors: list[str] = []
    overall_timeout = _timeout(timeout_seconds, asynchronous=False)
    started_at = time.monotonic()
    provider_order = (primary, fallback)
    for index, (provider, model) in enumerate(provider_order):
        attempts.append(provider)
        remaining = max(MIN_TIMEOUT_SECONDS, int(overall_timeout - (time.monotonic() - started_at)))
        attempt_timeout = remaining if index == len(provider_order) - 1 else max(
            MIN_TIMEOUT_SECONDS, int(remaining * 0.7)
        )
        try:
            result = await _run_provider(
                provider,
                instructions,
                workdir=workdir,
                preset=preset,
                model=model,
                timeout_seconds=attempt_timeout,
                include_git_diff=include_git_diff,
            )
            if int(result.get("returncode") or 0) == 0:
                return _format_result(result, metadata=True, attempts=attempts)
            errors.append(f"{provider}: {result.get('stderr') or result.get('output')}")
        except Exception as exc:
            errors.append(f"{provider}: {exc}")
    raise RuntimeError("All review providers failed: " + " | ".join(errors))


def _job_payload(job: dict[str, Any]) -> str:
    return json.dumps({key: value for key, value in job.items() if key != "task"}, ensure_ascii=False, indent=2)


def _prune_jobs() -> None:
    cutoff = time.time() - DEFAULT_JOB_TTL_SECONDS
    for job_id, job in list(ASYNC_JOBS.items()):
        if job.get("status") in {"completed", "failed", "cancelled"} and float(job.get("updated_at", 0)) < cutoff:
            ASYNC_JOBS.pop(job_id, None)


async def _start_job(
    provider: str,
    instructions: str,
    *,
    workdir: str | None,
    preset: str | None,
    model: str,
    timeout_seconds: int,
    context_files: list[str] | None,
    context_text: str,
    expected_output: str,
) -> str:
    _prune_jobs()
    running = sum(1 for job in ASYNC_JOBS.values() if job.get("status") in {"queued", "running"})
    if running >= MAX_ASYNC_JOBS:
        raise RuntimeError(f"Too many running review jobs; limit is {MAX_ASYNC_JOBS}")
    job_id = str(uuid.uuid4())
    now = time.time()
    effective_timeout = _timeout(timeout_seconds, asynchronous=True)
    ASYNC_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "provider": provider,
        "model": model,
        "workdir": str(_safe_workdir(workdir)),
        "timeout_seconds": effective_timeout,
        "output": "",
        "stderr": "",
    }

    async def job_runner() -> None:
        try:
            result = await _run_provider(
                provider,
                instructions,
                workdir=workdir,
                preset=preset,
                model=model,
                timeout_seconds=effective_timeout,
                context_files=context_files,
                context_text=context_text,
                expected_output=expected_output,
                asynchronous=True,
                on_started=lambda: ASYNC_JOBS[job_id].update(status="running", updated_at=time.time()),
            )
            ASYNC_JOBS[job_id].update(result)
        except asyncio.CancelledError:
            ASYNC_JOBS[job_id].update(status="cancelled")
            raise
        except Exception as exc:
            ASYNC_JOBS[job_id].update(status="failed", stderr=str(exc))
        finally:
            ASYNC_JOBS[job_id]["updated_at"] = time.time()

    ASYNC_JOBS[job_id]["task"] = asyncio.create_task(job_runner())
    return _job_payload(ASYNC_JOBS[job_id])


@mcp.tool()
async def review_code(
    prompt: str,
    workdir: str = "",
    kimi_model: str = "kimi-code/k3",
    claude_model: str = "opus",
    timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS,
) -> str:
    """Review code with Kimi K3 first and Claude Opus as an explicit logged fallback."""
    return await _run_with_fallback(
        prompt,
        preset="code_review",
        workdir=workdir or None,
        primary=("kimi", kimi_model),
        fallback=("claude", claude_model),
        timeout_seconds=timeout_seconds,
        include_git_diff=True,
    )


@mcp.tool()
async def review_plan(
    prompt: str,
    workdir: str = "",
    mode: str = "planning",
    claude_model: str = "opus",
    kimi_model: str = "kimi-code/k3",
    timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS,
) -> str:
    """Review planning/UI/design with Claude Opus first and Kimi K3 as a logged fallback."""
    return await _run_with_fallback(
        prompt,
        preset=mode,
        workdir=workdir or None,
        primary=("claude", claude_model),
        fallback=("kimi", kimi_model),
        timeout_seconds=timeout_seconds,
        include_git_diff=False,
    )


@mcp.tool()
async def claude_run(
    instructions: str,
    workdir: str = "",
    preset: str = "",
    model: str = "opus",
    timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS,
    context_files: list[str] | None = None,
    context_text: str = "",
    expected_output: str = "",
) -> str:
    """Run a general read-only Claude Code consultation."""
    result = await _run_provider(
        "claude", instructions, workdir=workdir or None, preset=preset or None, model=model,
        timeout_seconds=timeout_seconds, context_files=context_files, context_text=context_text,
        expected_output=expected_output, include_git_diff=preset == "code_review",
    )
    return _format_result(result)


@mcp.tool()
async def kimi_run(
    instructions: str,
    workdir: str = "",
    preset: str = "code_review",
    model: str = "kimi-code/k3",
    timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS,
    context_files: list[str] | None = None,
    context_text: str = "",
    expected_output: str = "",
) -> str:
    """Run a general read-only Kimi Code consultation with a tool-enforced read-only agent."""
    result = await _run_provider(
        "kimi", instructions, workdir=workdir or None, preset=preset or None, model=model,
        timeout_seconds=timeout_seconds, context_files=context_files, context_text=context_text,
        expected_output=expected_output, include_git_diff=preset == "code_review",
    )
    return _format_result(result)


@mcp.tool()
async def claude_start(
    instructions: str, workdir: str = "", preset: str = "", model: str = "opus",
    timeout_seconds: int = DEFAULT_ASYNC_TIMEOUT_SECONDS, context_files: list[str] | None = None,
    context_text: str = "", expected_output: str = "",
) -> str:
    """Start a read-only Claude job and return a pollable job id."""
    return await _start_job("claude", instructions, workdir=workdir or None, preset=preset or None,
        model=model, timeout_seconds=timeout_seconds, context_files=context_files,
        context_text=context_text, expected_output=expected_output)


@mcp.tool()
async def kimi_start(
    instructions: str, workdir: str = "", preset: str = "code_review", model: str = "kimi-code/k3",
    timeout_seconds: int = DEFAULT_ASYNC_TIMEOUT_SECONDS, context_files: list[str] | None = None,
    context_text: str = "", expected_output: str = "",
) -> str:
    """Start a read-only Kimi job and return a pollable job id."""
    return await _start_job("kimi", instructions, workdir=workdir or None, preset=preset or None,
        model=model, timeout_seconds=timeout_seconds, context_files=context_files,
        context_text=context_text, expected_output=expected_output)


@mcp.tool()
async def review_read(job_id: str) -> str:
    """Read a job started by either review provider."""
    _prune_jobs()
    job = ASYNC_JOBS.get(job_id)
    if not job:
        raise ValueError(f"Unknown review job id: {job_id}")
    return _job_payload(job)


@mcp.tool()
async def review_cancel(job_id: str) -> str:
    """Cancel a job started by either review provider."""
    job = ASYNC_JOBS.get(job_id)
    if not job:
        raise ValueError(f"Unknown review job id: {job_id}")
    task = job.get("task")
    if isinstance(task, asyncio.Task) and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        job.update(status="cancelled", updated_at=time.time())
    return _job_payload(job)


@mcp.tool()
async def claude_read(job_id: str) -> str:
    """Compatibility alias for review_read."""
    return await review_read(job_id)


@mcp.tool()
async def claude_cancel(job_id: str) -> str:
    """Compatibility alias for review_cancel."""
    return await review_cancel(job_id)


@mcp.tool()
async def kimi_read(job_id: str) -> str:
    """Kimi-specific alias for review_read."""
    return await review_read(job_id)


@mcp.tool()
async def kimi_cancel(job_id: str) -> str:
    """Kimi-specific alias for review_cancel."""
    return await review_cancel(job_id)


@mcp.tool()
async def claude_consult(prompt: str, workdir: str = "", mode: str = "planning", model: str = "opus",
                         timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for read-only specialist judgment."""
    return await claude_run(prompt, workdir, mode, model, timeout_seconds)


@mcp.tool()
async def kimi_consult(prompt: str, workdir: str = "", mode: str = "code_review",
                       model: str = "kimi-code/k3", timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Kimi Code for read-only specialist judgment."""
    return await kimi_run(prompt, workdir, mode, model, timeout_seconds)


async def _claude_mode(prompt: str, workdir: str, mode: str, model: str, timeout_seconds: int) -> str:
    return await claude_consult(prompt, workdir, mode, model, timeout_seconds)


@mcp.tool()
async def claude_plan(prompt: str, workdir: str = "", model: str = "opus",
                      timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for planning or architecture review."""
    return await _claude_mode(prompt, workdir, "planning", model, timeout_seconds)


@mcp.tool()
async def claude_design_review(prompt: str, workdir: str = "", model: str = "opus",
                               timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for UI/UX design review."""
    return await _claude_mode(prompt, workdir, "design", model, timeout_seconds)


@mcp.tool()
async def claude_design_brief(prompt: str, workdir: str = "", model: str = "opus",
                              timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for a Codex-ready design brief."""
    return await _claude_mode(prompt, workdir, "design_brief", model, timeout_seconds)


@mcp.tool()
async def claude_ui_implementation_plan(prompt: str, workdir: str = "", model: str = "opus",
                                        timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for a UI implementation plan."""
    return await _claude_mode(prompt, workdir, "ui_implementation_plan", model, timeout_seconds)


@mcp.tool()
async def claude_visual_qa(prompt: str, workdir: str = "", model: str = "opus",
                           timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for visual QA."""
    return await _claude_mode(prompt, workdir, "visual_qa", model, timeout_seconds)


@mcp.tool()
async def claude_design_system_review(prompt: str, workdir: str = "", model: str = "opus",
                                      timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for design-system review."""
    return await _claude_mode(prompt, workdir, "design_system", model, timeout_seconds)


@mcp.tool()
async def claude_product_review(prompt: str, workdir: str = "", model: str = "opus",
                                timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for product/operator judgment."""
    return await _claude_mode(prompt, workdir, "product", model, timeout_seconds)


@mcp.tool()
async def claude_research_synthesis(prompt: str, workdir: str = "", model: str = "opus",
                                    timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Claude Code for research synthesis."""
    return await _claude_mode(prompt, workdir, "research", model, timeout_seconds)


@mcp.tool()
async def claude_code_review(prompt: str, workdir: str = "", model: str = "opus",
                             timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Compatibility Claude-only code review tool; prefer review_code for Kimi-first routing."""
    return await _claude_mode(prompt, workdir, "code_review", model, timeout_seconds)


@mcp.tool()
async def kimi_code_review(prompt: str, workdir: str = "", model: str = "kimi-code/k3",
                           timeout_seconds: int = DEFAULT_SYNC_TIMEOUT_SECONDS) -> str:
    """Ask Kimi K3 for a read-only code review."""
    return await kimi_consult(prompt, workdir, "code_review", model, timeout_seconds)


if __name__ == "__main__":
    mcp.run()
