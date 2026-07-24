# Local Hermes Sidecar Merge - 2026-07-24

## Context

This machine runs multiple local Hermes Telegram clusters with Codex as the
primary driver and Claude sidecar conversation modes for selected agents.
The upstream Hermes checkout was updated from the older local install while
preserving local patches that were saved in
`stash@{0}: hermes-install-autostash-20260724-030227`.

## Preserved Local Behavior

- Telegram slash commands for Claude sidecar mode: `/claude`, `/codex`,
  `/opus`, `/sonnet`, and `/exec`.
- Claude sidecar routing that can answer through the gateway while keeping
  transcript history readable by the normal Codex path.
- Shared Codex auth storage and locking so multiple gateway processes do not
  rotate the same refresh token independently.
- Profile mirroring from the shared Codex auth store for backwards-compatible
  profile-local reads.
- Update checking that reports a local checkout with carried commits as current
  when `HEAD..origin/main` has zero missing upstream commits.

## Verification

Run from `/Users/nmmacmini/.hermes/hermes-agent`:

```bash
venv/bin/python -m py_compile gateway/run.py gateway/claude_sidecar.py hermes_cli/auth.py hermes_cli/commands.py agent/credential_pool.py
tmpdir=$(mktemp -d)
HERMES_CODEX_SHARED_AUTH_DIR="$tmpdir" PYTHONPATH=. uv run --extra dev pytest -q \
  tests/gateway/test_claude_sidecar.py \
  tests/gateway/test_claude_sidecar_routing.py \
  tests/gateway/test_session_model_reset.py \
  tests/hermes_cli/test_auth_codex_provider.py \
  tests/hermes_cli/test_auth_toctou_file_modes.py \
  tests/run_agent/test_codex_no_tools_nonetype.py \
  tests/run_agent/test_fallback_credential_isolation.py \
  tests/hermes_cli/test_auth_profile_fallback.py
```

Expected result: compile succeeds and the focused pytest suite passes.

## Rollback

The local branch checkpoint is
`wip/hermes-sidecar-upstream-merge-20260724`. To inspect the original
autostashed local patches before this merge, use:

```bash
git stash show --stat stash@{0}
git diff stash@{0}^1 stash@{0}
```
