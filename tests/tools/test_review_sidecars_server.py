from __future__ import annotations

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).parents[2] / "tools" / "review_sidecars_server.py"
SPEC = importlib.util.spec_from_file_location("review_sidecars_server", MODULE_PATH)
assert SPEC and SPEC.loader
review_sidecars = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review_sidecars)


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "Documents"
    root.mkdir()
    monkeypatch.setenv("REVIEW_SIDECARS_ALLOWED_ROOTS", str(root))
    return root


def test_workdir_must_be_inside_configured_root(workspace: Path, tmp_path: Path) -> None:
    project = workspace / "project"
    project.mkdir()
    assert review_sidecars._safe_workdir(str(project)) == project.resolve()
    with pytest.raises(ValueError, match="outside approved workspaces"):
        review_sidecars._safe_workdir(str(tmp_path))


@pytest.mark.parametrize(
    "relative",
    [
        "Documents/project",
        "Desktop/project",
        "Projects/project",
        "Developer/project",
        "Code/project",
        "src/project",
        "Workspace/project",
        "Workspaces/project",
        ".codex/worktrees/feature-a",
        ".hermes/worktrees/feature-b",
        ".atum/worktrees/feature-c",
    ],
)
def test_standard_project_and_worktree_roots_are_allowed_by_default(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    relative: str,
) -> None:
    home = tmp_path / "home"
    project = home / relative
    project.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv("REVIEW_SIDECARS_ALLOWED_ROOTS", raising=False)

    assert review_sidecars._safe_workdir(str(project)) == project.resolve()


def test_configured_roots_extend_instead_of_replace_defaults(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / "home"
    default_project = home / ".hermes" / "worktrees" / "default-project"
    configured_project = tmp_path / "mounted-projects" / "configured-project"
    default_project.mkdir(parents=True)
    configured_project.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv(
        "REVIEW_SIDECARS_ALLOWED_ROOTS",
        str(configured_project.parent),
    )

    assert review_sidecars._safe_workdir(str(default_project)) == default_project.resolve()
    assert review_sidecars._safe_workdir(str(configured_project)) == configured_project.resolve()


def test_unrelated_home_directories_remain_out_of_scope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / "home"
    private_dir = home / ".ssh"
    private_dir.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv("REVIEW_SIDECARS_ALLOWED_ROOTS", raising=False)

    with pytest.raises(ValueError, match="outside approved workspaces"):
        review_sidecars._safe_workdir(str(private_dir))


@pytest.mark.parametrize(
    "name",
    [".env", ".env.production", "id_rsa", "id_ed25519.pub", "deploy.pem", "api.key", "credentials.json"],
)
def test_context_files_reject_secret_like_names(workspace: Path, name: str) -> None:
    path = workspace / name
    path.write_text("secret", encoding="utf-8")
    with pytest.raises(ValueError, match="secret-like"):
        review_sidecars._context_files_section([str(path)], workspace)


def test_provider_environment_does_not_cross_contaminate_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("REVIEW_SIDECARS_PROFILE_ENV", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-value")
    monkeypatch.setenv("KIMI_API_KEY", "kimi-value")

    claude_env = review_sidecars._provider_env("claude")
    kimi_env = review_sidecars._provider_env("kimi")

    assert claude_env["ANTHROPIC_API_KEY"] == "anthropic-value"
    assert "KIMI_API_KEY" not in claude_env
    assert kimi_env["KIMI_API_KEY"] == "kimi-value"
    assert "ANTHROPIC_API_KEY" not in kimi_env
    assert kimi_env["KIMI_CODE_EXPERIMENTAL_FLAG"] == "1"


def test_profile_env_only_loads_provider_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = tmp_path / "profile.env"
    profile.write_text(
        "ANTHROPIC_API_KEY=anthropic-profile\n"
        "KIMI_API_KEY=kimi-profile\n"
        "export MOONSHOT_API_KEY=moonshot-profile\n"
        "UNRELATED_SECRET=must-not-pass\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("REVIEW_SIDECARS_PROFILE_ENV", str(profile))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("KIMI_API_KEY", raising=False)

    assert review_sidecars._provider_env("claude")["ANTHROPIC_API_KEY"] == "anthropic-profile"
    assert review_sidecars._provider_env("kimi")["KIMI_API_KEY"] == "kimi-profile"
    assert review_sidecars._provider_env("kimi")["MOONSHOT_API_KEY"] == "moonshot-profile"
    assert "UNRELATED_SECRET" not in review_sidecars._provider_env("claude")
    assert "UNRELATED_SECRET" not in review_sidecars._provider_env("kimi")


def test_kimi_command_uses_tool_restricted_agent_without_permission_bypass(
    workspace: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_bin = workspace / "kimi"
    fake_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    fake_bin.chmod(0o755)
    monkeypatch.setenv("REVIEW_SIDECARS_KIMI_BIN", str(fake_bin))

    command = review_sidecars._command("kimi", "review this", "kimi-code/k3", workspace)

    assert "--agent-file" in command
    assert str(review_sidecars.KIMI_AGENT_FILE) in command
    assert "--prompt" in command
    assert not {"--yolo", "--auto", "--plan"}.intersection(command)
    agent_text = review_sidecars.KIMI_AGENT_FILE.read_text(encoding="utf-8")
    assert "  - Read" in agent_text
    assert "  - Write" not in agent_text.split("disallowedTools:", 1)[0]
    assert "  - Bash" not in agent_text.split("disallowedTools:", 1)[0]


def test_claude_command_uses_only_read_only_tool_arguments(
    workspace: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_bin = workspace / "claude"
    fake_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    fake_bin.chmod(0o755)
    monkeypatch.setenv("REVIEW_SIDECARS_CLAUDE_BIN", str(fake_bin))

    command = review_sidecars._command("claude", "review this", "opus", workspace)

    assert "--safe-mode" in command
    assert command[command.index("--permission-mode") + 1] == "plan"
    tools_index = command.index("--allowed-tools")
    assert command[tools_index + 1:tools_index + 5] == ["Read", "Glob", "Grep", "LS"]
    assert "Bash" not in command
    assert "Write" not in command
    assert "Edit" not in command


def test_timeouts_are_clamped_to_mcp_safe_sync_limit() -> None:
    assert review_sidecars._timeout(900, asynchronous=False) == 550
    assert review_sidecars._timeout(1, asynchronous=False) == 5
    assert review_sidecars._timeout(9000, asynchronous=True) == 7200


def test_successful_result_does_not_expose_cli_diagnostics(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REVIEW_SIDECARS_INCLUDE_STDERR", raising=False)
    result = review_sidecars._format_result(
        {"returncode": 0, "output": "final", "stderr": "internal trace", "provider": "kimi"}
    )
    assert result == "final"


@pytest.mark.asyncio
async def test_routed_review_logs_fallback_provider(
    workspace: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def fake_run(provider: str, *args, **kwargs):
        calls.append(provider)
        if provider == "kimi":
            raise RuntimeError("quota")
        return {
            "returncode": 0,
            "output": "fallback review",
            "stderr": "",
            "provider": provider,
            "model": kwargs["model"],
        }

    monkeypatch.setattr(review_sidecars, "_run_provider", fake_run)
    result = await review_sidecars._run_with_fallback(
        "review",
        preset="code_review",
        workdir=str(workspace),
        primary=("kimi", "kimi-code/k3"),
        fallback=("claude", "opus"),
        timeout_seconds=60,
        include_git_diff=True,
    )

    assert calls == ["kimi", "claude"]
    assert "provider=claude" in result
    assert "attempts=kimi,claude" in result
    assert result.endswith("fallback review")


@pytest.mark.asyncio
async def test_fallback_attempts_share_one_overall_timeout(
    workspace: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    budgets: list[int] = []

    async def fake_run(provider: str, *args, **kwargs):
        budgets.append(kwargs["timeout_seconds"])
        if provider == "kimi":
            raise RuntimeError("failure")
        return {"returncode": 0, "output": "ok", "stderr": "", "provider": provider, "model": kwargs["model"]}

    monkeypatch.setattr(review_sidecars, "_run_provider", fake_run)
    await review_sidecars._run_with_fallback(
        "review", preset="code_review", workdir=str(workspace),
        primary=("kimi", "kimi-code/k3"), fallback=("claude", "opus"),
        timeout_seconds=100, include_git_diff=True,
    )

    assert 69 <= budgets[0] <= 70
    assert budgets[1] <= 100


def test_prompt_never_claims_write_capability(workspace: Path) -> None:
    prompt = review_sidecars._build_prompt(
        "kimi",
        "review the implementation",
        preset="code_review",
        context_text="",
        context_files=None,
        expected_output="findings",
        cwd=workspace,
        include_git_diff=False,
    )
    assert "Do not edit files" in prompt
    assert "Use only read-only inspection tools" in prompt
    assert "Perform a read-only code review" in prompt


def test_git_context_omits_secret_file_contents(workspace: Path) -> None:
    project = workspace / "repo"
    project.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=project, check=True)
    (project / "app.py").write_text("print('before')\n", encoding="utf-8")
    (project / ".env").write_text("TOKEN=before\n", encoding="utf-8")
    subprocess.run(["git", "add", "app.py", ".env"], cwd=project, check=True)
    commit_env = {**os.environ, "ALLOW_NO_DOCS_LOG": "1"}
    subprocess.run(
        ["git", "commit", "-qm", "fixture"],
        cwd=project,
        check=True,
        env=commit_env,
    )
    (project / "app.py").write_text("print('after')\n", encoding="utf-8")
    (project / ".env").write_text("TOKEN=do-not-send\n", encoding="utf-8")

    context = review_sidecars._git_review_context(project)

    assert "print('after')" in context
    assert "do-not-send" not in context
    assert "omitted 1 secret-like" in context


def test_content_redaction_catches_common_secret_shapes() -> None:
    text = "TOKEN=plain-secret\naws=AKIAABCDEFGHIJKLMNOP\nkey=sk-abcdefghijklmnopqrstuvwxyz"
    redacted, count = review_sidecars._redact_sensitive_content(text)
    assert "plain-secret" not in redacted
    assert "AKIAABCDEFGHIJKLMNOP" not in redacted
    assert "sk-abcdefghijklmnopqrstuvwxyz" not in redacted
    assert count == 3


def test_prompt_size_is_bounded(workspace: Path) -> None:
    with pytest.raises(ValueError, match="prompt is too large"):
        review_sidecars._build_prompt(
            "kimi", "x" * (review_sidecars.MAX_PROMPT_BYTES + 1), preset="code_review",
            context_text="", context_files=None, expected_output="", cwd=workspace,
            include_git_diff=False,
        )
