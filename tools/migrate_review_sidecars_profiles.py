#!/usr/bin/env python3
"""Validate, stage, and transactionally migrate Hermes profiles to agent-jobs."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile

from agent_job_policy import allowed_roots_value


SERVER_PATH = "/Users/nmmacmini/.local/share/hermes-agent-review-sidecars/tools/agent_jobs_server.py"
PYTHON_PATH = "/Users/nmmacmini/.hermes/hermes-agent/venv/bin/python"


class ProfileNotApplicable(ValueError):
    """Raised only when a profile has no old or new cross-agent registration."""


def _server_block() -> list[str]:
    return [
        "  agent-jobs:\n",
        f"    command: {PYTHON_PATH}\n",
        "    args:\n",
        f"    - {SERVER_PATH}\n",
        "    enabled: true\n",
        "    timeout: 90\n",
        "    connect_timeout: 30\n",
        "    env:\n",
        f"      AGENT_JOB_ALLOWED_ROOTS: {allowed_roots_value()}\n",
    ]


def migrate_config(text: str, profile_name: str) -> str:
    has_old = bool(re.search(r"(?m)^  (?:review-sidecars|claude-plan):\s*$", text))
    has_new = bool(re.search(r"(?m)^  agent-jobs:\s*$", text))
    if not has_old and not has_new:
        raise ProfileNotApplicable(f"{profile_name}: no cross-agent MCP registration found")
    migrated = re.sub(
        r"(?m)^(\s*-\s*)(?:review-sidecars|claude-plan)\s*$", r"\1agent-jobs", text,
    )
    migrated = re.sub(
        r"(?m)^  (?:review-sidecars|claude-plan):\s*$", "  agent-jobs:", migrated,
    )
    lines = migrated.splitlines(keepends=True)
    indexes = [index for index, line in enumerate(lines) if line.rstrip() == "  agent-jobs:"]
    if len(indexes) != 1:
        raise ValueError(f"{profile_name}: expected one agent-jobs MCP block, found {len(indexes)}")
    start = indexes[0]
    end = start + 1
    while end < len(lines):
        line = lines[end]
        if line.strip() and not line.startswith("    "):
            break
        end += 1
    lines[start:end] = _server_block()
    result = "".join(lines)
    if re.search(r"(?m)^  (?:review-sidecars|claude-plan):\s*$", result):
        raise ValueError(f"{profile_name}: legacy MCP registration remains")
    return result


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


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(128 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _skill_manifest(root: Path) -> dict[str, str]:
    if not root.is_dir():
        return {}
    return {
        str(path.relative_to(root)): _file_digest(path)
        for path in sorted(root.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    }


def _same_skill(source: Path, destination: Path) -> bool:
    return destination.is_dir() and _skill_manifest(source) == _skill_manifest(destination)


def _migrate_profile(
    config: Path, original: str, migrated: str, skill_source: Path, backup_suffix: str,
) -> None:
    profile = config.parent
    skills = profile / "skills"
    skills.mkdir(exist_ok=True)
    destination = skills / "agent-jobs"
    legacy = skills / "review-sidecars"
    backup_dir = profile / "agent-jobs-backups"
    config_backup = config.with_name(f"config.yaml.bak.agent-jobs-{backup_suffix}")
    destination_backup = backup_dir / f"agent-jobs-{backup_suffix}"
    legacy_backup = backup_dir / f"review-sidecars-{backup_suffix}"
    required_backups = [config_backup]
    if destination.exists():
        required_backups.append(destination_backup)
    if legacy.exists():
        required_backups.append(legacy_backup)
    collisions = [path for path in required_backups if path.exists()]
    if collisions:
        raise FileExistsError(f"Backup already exists: {collisions[0]}")

    stage_root = Path(tempfile.mkdtemp(prefix=".agent-jobs-stage-", dir=skills))
    staged = stage_root / "agent-jobs"
    shutil.copytree(skill_source, staged, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    backup_dir.mkdir(exist_ok=True)
    shutil.copy2(config, config_backup)
    moved_destination = False
    moved_legacy = False
    installed_staged = False
    try:
        if destination.exists():
            shutil.move(str(destination), destination_backup)
            moved_destination = True
        shutil.move(str(staged), destination)
        installed_staged = True
        if legacy.exists():
            shutil.move(str(legacy), legacy_backup)
            moved_legacy = True
        if migrated != original:
            _atomic_write(config, migrated)
    except Exception:
        if migrated != original and config.read_text(encoding="utf-8") != original:
            _atomic_write(config, original)
        if moved_legacy and legacy_backup.exists():
            shutil.move(str(legacy_backup), legacy)
        if installed_staged and destination.exists():
            shutil.rmtree(destination)
        if moved_destination and destination_backup.exists():
            shutil.move(str(destination_backup), destination)
        config_backup.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)


def migrate_profiles(profiles_root: Path, skill_source: Path, backup_suffix: str, apply: bool) -> list[str]:
    planned: list[tuple[Path, str, str]] = []
    for config in sorted(profiles_root.glob("*/config.yaml")):
        original = config.read_text(encoding="utf-8")
        try:
            migrated = migrate_config(original, config.parent.name)
        except ProfileNotApplicable:
            continue
        destination = config.parent / "skills" / "agent-jobs"
        if migrated != original or not _same_skill(skill_source, destination):
            planned.append((config, original, migrated))
    if apply:
        for config, original, migrated in planned:
            _migrate_profile(config, original, migrated, skill_source, backup_suffix)
    return [config.parent.name for config, _, _ in planned]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles-root", type=Path, required=True)
    parser.add_argument("--skill-source", type=Path, required=True)
    parser.add_argument("--backup-suffix", default="20260809-thin-harness")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.skill_source.joinpath("SKILL.md").is_file():
        raise SystemExit(f"Invalid skill source: {args.skill_source}")
    changed = migrate_profiles(args.profiles_root, args.skill_source, args.backup_suffix, args.apply)
    action = "migrated" if args.apply else "would migrate"
    print(f"{action} {len(changed)} profile(s): {', '.join(changed)}")


if __name__ == "__main__":
    main()
