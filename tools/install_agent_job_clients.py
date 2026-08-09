#!/usr/bin/env python3
"""Install the shared agent-jobs skill and native MCP bindings for local clients."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from json import JSONDecodeError
import os
from pathlib import Path
import shutil
import stat
import tempfile

from agent_job_policy import allowed_roots_value


REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = REPO_ROOT / "tools" / "agent_jobs_server.py"
SKILL_SOURCE = REPO_ROOT / "skills" / "agent-jobs"
GUIDANCE_START = "<!-- AGENT_JOBS_GUIDANCE_START -->"
GUIDANCE_END = "<!-- AGENT_JOBS_GUIDANCE_END -->"
KIMI_GUIDANCE = f"""{GUIDANCE_START}
## Agent Jobs

Use `$agent-jobs` for cross-agent review, planning, architecture, design, product,
copywriting, research, or explicitly requested implementation by another model.
The skill owns routing, rubrics, fallback, polling, and spend controls.

As a Kimi caller, use Codex first for code review and Opus first for planning,
design, product, copy, and research. Never delegate back to Kimi. Use the generic
`agent-jobs` MCP tools for read-only work and the skill's capability-gated CLI
only when the user explicitly delegates implementation. Save job IDs, poll with
cursors, verify all output locally, and never submit secrets or `.env` contents.
{GUIDANCE_END}
"""


def python_path(home: Path | None = None) -> Path:
    return (home or Path.home()).expanduser().resolve() / ".hermes/hermes-agent/venv/bin/python"


def server_config(home: Path | None = None) -> dict[str, object]:
    resolved_home = (home or Path.home()).expanduser().resolve()
    return {
        "command": str(python_path(resolved_home)),
        "args": [str(SERVER_PATH)],
        "env": {"AGENT_JOB_ALLOWED_ROOTS": allowed_roots_value(resolved_home)},
    }


def _atomic_write(path: Path, text: str, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600 if mode is None else mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _backup_path(path: Path, suffix: str) -> Path:
    return path.with_name(f"{path.name}.bak.agent-jobs-{suffix}")


def _backup(path: Path, suffix: str) -> Path | None:
    if not path.exists():
        return None
    backup = _backup_path(path, suffix)
    if backup.exists():
        raise FileExistsError(f"Backup already exists: {backup}")
    shutil.copy2(path, backup)
    return backup


def merge_mcp_config(path: Path, suffix: str, apply: bool, home: Path | None = None) -> bool:
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON in MCP config {path}: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError(f"MCP config must contain a JSON object: {path}")
    else:
        data = {}
    servers = data.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        raise ValueError(f"mcpServers must be a JSON object: {path}")
    desired = server_config(home)
    if servers.get("agent-jobs") == desired:
        return False
    servers["agent-jobs"] = desired
    if apply:
        _backup(path, suffix)
        mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
        _atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n", mode)
    return True


def merge_kimi_guidance(path: Path, suffix: str, apply: bool) -> bool:
    original = path.read_text(encoding="utf-8") if path.exists() else ""
    if original.count(GUIDANCE_START) > 1 or original.count(GUIDANCE_END) > 1:
        raise ValueError(f"Duplicate agent-jobs guidance markers: {path}")
    start = original.find(GUIDANCE_START)
    end = original.find(GUIDANCE_END)
    if (start == -1) != (end == -1) or (start != -1 and end < start):
        raise ValueError(f"Malformed agent-jobs guidance markers: {path}")
    if start == -1:
        prefix = original.rstrip()
        updated = f"{prefix}\n\n{KIMI_GUIDANCE}" if prefix else KIMI_GUIDANCE
    else:
        end += len(GUIDANCE_END)
        updated = original[:start] + KIMI_GUIDANCE.rstrip() + original[end:]
    if updated == original:
        return False
    if apply:
        _backup(path, suffix)
        mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
        _atomic_write(path, updated.rstrip() + "\n", mode)
    return True


def ensure_skill_link(destination: Path, apply: bool) -> bool:
    if destination.is_symlink() and destination.resolve() == SKILL_SOURCE.resolve():
        return False
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(
            f"Refusing to replace existing skill path; move it manually first: {destination}"
        )
    if apply:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.symlink_to(SKILL_SOURCE)
    return True


def _paths(home: Path) -> dict[str, Path]:
    return {
        "shared skill": home / ".agents/skills/agent-jobs",
        "Claude Desktop MCP": home / "Library/Application Support/Claude/claude_desktop_config.json",
        "Kimi MCP": home / ".kimi-code/mcp.json",
        "Kimi guidance": home / ".kimi-code/AGENTS.md",
    }


def _validate_runtime(home: Path) -> None:
    required = [python_path(home), SERVER_PATH, SKILL_SOURCE / "SKILL.md"]
    missing = [path for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Required agent-jobs runtime path is missing: {missing[0]}")


def _plan(home: Path) -> tuple[dict[str, bool], dict[str, str]]:
    paths = _paths(home)
    checks = {
        "shared skill": lambda: ensure_skill_link(paths["shared skill"], False),
        "Claude Desktop MCP": lambda: merge_mcp_config(
            paths["Claude Desktop MCP"], "preview", False, home
        ),
        "Kimi MCP": lambda: merge_mcp_config(paths["Kimi MCP"], "preview", False, home),
        "Kimi guidance": lambda: merge_kimi_guidance(
            paths["Kimi guidance"], "preview", False
        ),
    }
    changes: dict[str, bool] = {}
    errors: dict[str, str] = {}
    for name, check in checks.items():
        try:
            changes[name] = check()
        except Exception as exc:
            changes[name] = False
            errors[name] = str(exc)
    return changes, errors


def _preflight_backups(home: Path, changes: dict[str, bool], suffix: str) -> None:
    paths = _paths(home)
    for name in ("Claude Desktop MCP", "Kimi MCP", "Kimi guidance"):
        path = paths[name]
        if changes[name] and path.exists() and _backup_path(path, suffix).exists():
            raise FileExistsError(f"Backup already exists: {_backup_path(path, suffix)}")


def _rollback(home: Path, changes: dict[str, bool], suffix: str, existed: dict[str, bool]) -> None:
    paths = _paths(home)
    skill = paths["shared skill"]
    if changes["shared skill"] and skill.is_symlink() and skill.resolve() == SKILL_SOURCE.resolve():
        skill.unlink()
    for name in ("Kimi guidance", "Kimi MCP", "Claude Desktop MCP"):
        if not changes[name]:
            continue
        path = paths[name]
        backup = _backup_path(path, suffix)
        if backup.exists():
            shutil.copy2(backup, path)
            backup.unlink()
        elif not existed[name] and path.exists():
            path.unlink()


def apply_changes(home: Path, changes: dict[str, bool], suffix: str) -> None:
    paths = _paths(home)
    existed = {name: path.exists() or path.is_symlink() for name, path in paths.items()}
    _preflight_backups(home, changes, suffix)
    try:
        if changes["shared skill"]:
            ensure_skill_link(paths["shared skill"], True)
        if changes["Claude Desktop MCP"]:
            merge_mcp_config(paths["Claude Desktop MCP"], suffix, True, home)
        if changes["Kimi MCP"]:
            merge_mcp_config(paths["Kimi MCP"], suffix, True, home)
        if changes["Kimi guidance"]:
            merge_kimi_guidance(paths["Kimi guidance"], suffix, True)
    except Exception:
        _rollback(home, changes, suffix, existed)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action_group = parser.add_mutually_exclusive_group()
    action_group.add_argument("--apply", action="store_true")
    action_group.add_argument("--check", action="store_true")
    parser.add_argument("--backup-suffix", default="")
    parser.add_argument("--home", type=Path, default=Path.home(), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    home = args.home.expanduser().resolve()
    suffix = args.backup_suffix or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    try:
        _validate_runtime(home)
        changes, errors = _plan(home)
    except Exception as exc:
        print(f"preflight: error: {exc}")
        return 2
    if errors:
        for name, changed in changes.items():
            status = f"error: {errors[name]}" if name in errors else "would update" if changed else "current"
            print(f"{name}: {status}")
        return 2
    if args.apply:
        try:
            apply_changes(home, changes, suffix)
        except Exception as exc:
            print(f"apply: error: {exc}")
            return 2
    action = "updated" if args.apply else "would update"
    for name, changed in changes.items():
        print(f"{name}: {action if changed else 'current'}")
    if args.check and any(changes.values()):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
