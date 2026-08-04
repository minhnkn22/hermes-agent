from __future__ import annotations

import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).parents[2] / "tools" / "migrate_review_sidecars_profiles.py"
SPEC = importlib.util.spec_from_file_location("migrate_review_sidecars_profiles", MODULE_PATH)
assert SPEC and SPEC.loader
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


CONFIG = """platform_toolsets:
  cli:
  - web
  - claude-plan
  telegram:
  - web
  - claude-plan
mcp_servers:
  claude-plan:
    command: /old/python
    args:
    - /old/claude_code_plan_server.py
    timeout: 600
    connect_timeout: 60
fallback_model:
  enabled: true
"""


def test_migrate_config_replaces_toolsets_and_server_block() -> None:
    result = migration.migrate_config(CONFIG, "dev-ben")
    assert "claude-plan" not in result
    assert "claude_code_plan_server.py" not in result
    assert result.count("review-sidecars") == 4
    assert migration.SERVER_PATH in result
    assert "REVIEW_SIDECARS_DEFAULT_WORKDIR: /Users/nmmacmini/Documents/Claude/PM" in result
    assert "fallback_model:\n  enabled: true" in result


def test_profile_default_workdirs() -> None:
    assert migration._default_workdir("atum-main").endswith("/Atum")
    assert migration._default_workdir("moon-dev").endswith("/Moon")
    assert migration._default_workdir("dev-andy").endswith("/PM")


def test_apply_creates_backup_installs_skill_and_moves_legacy(tmp_path: Path) -> None:
    profiles = tmp_path / "profiles"
    profile = profiles / "atum-main"
    legacy = profile / "skills" / "claude-plan"
    legacy.mkdir(parents=True)
    (legacy / "SKILL.md").write_text("old", encoding="utf-8")
    (profile / "config.yaml").write_text(CONFIG, encoding="utf-8")
    source = tmp_path / "skill-source"
    source.mkdir()
    (source / "SKILL.md").write_text("new", encoding="utf-8")

    changed = migration.migrate_profiles(profiles, source, "test", apply=True)

    assert changed == ["atum-main"]
    assert (profile / "config.yaml.bak.review-sidecars-test").read_text(encoding="utf-8") == CONFIG
    assert (profile / "skills" / "review-sidecars" / "SKILL.md").read_text(encoding="utf-8") == "new"
    assert (profile / "review-sidecars-backups" / "claude-plan-test" / "SKILL.md").exists()
