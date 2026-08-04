#!/usr/bin/env python3
"""Transactionally migrate Hermes profiles from claude-plan to review-sidecars."""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from pathlib import Path


SERVER_PATH = "/Users/nmmacmini/.local/share/hermes-agent-review-sidecars/tools/review_sidecars_server.py"
PYTHON_PATH = "/Users/nmmacmini/.hermes/hermes-agent/venv/bin/python"
CLAUDE_PATH = "/Users/nmmacmini/.local/bin/claude"
KIMI_PATH = "/Users/nmmacmini/.kimi-code/bin/kimi"
ALLOWED_ROOTS = "/Users/nmmacmini/Documents:/Users/pm/Documents:/Users/Shared"


def _default_workdir(profile_name: str) -> str:
    if profile_name.startswith("atum-"):
        return "/Users/nmmacmini/Documents/Claude/Atum"
    if profile_name.startswith("moon-"):
        return "/Users/nmmacmini/Documents/Claude/Moon"
    return "/Users/nmmacmini/Documents/Claude/PM"


def _server_block(profile_name: str) -> list[str]:
    return [
        "  review-sidecars:\n",
        f"    command: {PYTHON_PATH}\n",
        "    args:\n",
        f"      - {SERVER_PATH}\n",
        "    enabled: true\n",
        "    timeout: 600\n",
        "    connect_timeout: 60\n",
        "    env:\n",
        f"      REVIEW_SIDECARS_ALLOWED_ROOTS: '{ALLOWED_ROOTS}'\n",
        f"      REVIEW_SIDECARS_CLAUDE_BIN: {CLAUDE_PATH}\n",
        "      REVIEW_SIDECARS_CLAUDE_MAX_TURNS: '60'\n",
        f"      REVIEW_SIDECARS_DEFAULT_WORKDIR: {_default_workdir(profile_name)}\n",
        f"      REVIEW_SIDECARS_KIMI_BIN: {KIMI_PATH}\n",
        f"      REVIEW_SIDECARS_PROFILE_ENV: /Users/nmmacmini/.hermes/profiles/{profile_name}/.env\n",
    ]


def migrate_config(text: str, profile_name: str) -> str:
    old_count = text.count("claude-plan")
    if old_count == 0:
        if "review-sidecars" not in text:
            raise ValueError(f"{profile_name}: neither old nor new sidecar registration found")
        return text

    lines = text.replace("claude-plan", "review-sidecars").splitlines(keepends=True)
    mcp_index = next((i for i, line in enumerate(lines) if line.rstrip() == "mcp_servers:"), None)
    if mcp_index is None:
        raise ValueError(f"{profile_name}: mcp_servers block not found")
    server_indexes = [
        i for i in range(mcp_index + 1, len(lines)) if lines[i].rstrip() == "  review-sidecars:"
    ]
    if len(server_indexes) != 1:
        raise ValueError(f"{profile_name}: expected one review-sidecars MCP block, found {len(server_indexes)}")
    start = server_indexes[0]
    end = start + 1
    while end < len(lines):
        line = lines[end]
        if line.strip() and not line.startswith("    "):
            break
        end += 1
    lines[start:end] = _server_block(profile_name)
    migrated = "".join(lines)
    if "claude-plan" in migrated or "claude_code_plan_server.py" in migrated:
        raise ValueError(f"{profile_name}: legacy Claude registration remains")
    expected_count = old_count + SERVER_PATH.count("review-sidecars")
    if migrated.count("review-sidecars") != expected_count:
        raise ValueError(
            f"{profile_name}: sidecar reference count changed unexpectedly "
            f"({expected_count} expected, found {migrated.count('review-sidecars')})"
        )
    return migrated


def _atomic_write(path: Path, text: str) -> None:
    mode = path.stat().st_mode
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def migrate_profiles(profiles_root: Path, skill_source: Path, backup_suffix: str, apply: bool) -> list[str]:
    changed: list[str] = []
    for config in sorted(profiles_root.glob("*/config.yaml")):
        profile = config.parent
        original = config.read_text(encoding="utf-8")
        if "claude-plan" not in original:
            continue
        migrated = migrate_config(original, profile.name)
        changed.append(profile.name)
        if not apply:
            continue

        backup = config.with_name(f"config.yaml.bak.review-sidecars-{backup_suffix}")
        if backup.exists():
            raise FileExistsError(f"Backup already exists: {backup}")
        shutil.copy2(config, backup)
        _atomic_write(config, migrated)

        destination = profile / "skills" / "review-sidecars"
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(skill_source, destination)

        legacy_skill = profile / "skills" / "claude-plan"
        if legacy_skill.exists():
            backup_dir = profile / "review-sidecars-backups"
            backup_dir.mkdir(exist_ok=True)
            shutil.move(str(legacy_skill), backup_dir / f"claude-plan-{backup_suffix}")
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profiles-root", type=Path, required=True)
    parser.add_argument("--skill-source", type=Path, required=True)
    parser.add_argument("--backup-suffix", default="20260804")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.skill_source.joinpath("SKILL.md").is_file():
        raise SystemExit(f"Invalid skill source: {args.skill_source}")
    changed = migrate_profiles(args.profiles_root, args.skill_source, args.backup_suffix, args.apply)
    action = "migrated" if args.apply else "would migrate"
    print(f"{action} {len(changed)} profile(s): {', '.join(changed)}")


if __name__ == "__main__":
    main()
