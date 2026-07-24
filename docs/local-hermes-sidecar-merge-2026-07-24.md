# Local Hermes Sidecar Merge - 2026-07-24

## Context

This machine runs multiple local Hermes Telegram clusters with Codex as the
primary driver and Claude sidecar conversation modes for selected agents.
The upstream Hermes checkout was updated from the older local install while
preserving local patches that were saved in
`stash@{0}: hermes-install-autostash-20260724-030227`.

## Preserved Local Behavior

- Telegram slash commands for Claude sidecar mode: `/claude`, `/codex`,
  `/opus`, `/sonnet`, `/fable`, and `/exec`.
- Claude sidecar model settings stay alias-based (`sonnet`, `opus`, `fable`)
  so Claude Code resolves the latest subscribed model behind each alias. Use
  explicit model IDs only when a profile must pin a specific release.
- Claude sidecar routing that can answer through the gateway while keeping
  transcript history readable by the normal Codex path.
- Shared Codex auth storage and locking so multiple gateway processes do not
  rotate the same refresh token independently.
- Profile mirroring from the shared Codex auth store for backwards-compatible
  profile-local reads.
- Desktop messaging setup views must be profile-scoped. The default/global
  Hermes config can have Telegram disabled while profile-local gateways are
  active from `~/.hermes/profiles/<profile>/.env`; the desktop app should report
  the active profile, not the root install.
- Desktop uses an agent-first sidebar whenever more than one profile exists.
  Each profile is one collapsible agent section containing its local, Telegram,
  API, and other sessions; the session row carries the transport icon. Selecting
  a profile changes the active runtime/new-session target without hiding the
  other agents. Single-profile installs keep the upstream transport sections.
- Agent headers provide visible and right-click actions for pinning, editing the
  display name, and renaming the real profile. Pinned agent groups move into the
  `Pinned` section, while unpinned agents remain under `Sessions`; individually
  pinned chats remain independent rows. A real rename carries local sidebar
  preferences to the new profile key.
- Update checking that reports a local checkout with carried commits as current
  when `HEAD..origin/main` has zero missing upstream commits.

## Verification

Run from `/Users/nmmacmini/.hermes/hermes-agent`:

```bash
venv/bin/python -m py_compile gateway/run.py gateway/claude_sidecar.py hermes_cli/auth.py hermes_cli/commands.py hermes_cli/model_switch.py agent/credential_pool.py
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

Desktop agent-sidebar verification:

```bash
cd apps/desktop
npm run typecheck -- --pretty false
npm run test -- \
  src/store/profile-scope.test.ts \
  src/app/chat/sidebar/session-row.test.tsx \
  src/app/session/hooks/use-session-list-actions.test.tsx \
  src/hermes.test.ts \
  src/hermes-profile-scope.test.ts
```

Expected result on 2026-07-24: typecheck passes; 5 test files and 36 tests pass.

Agent-header action verification:

```bash
cd apps/desktop
npm run test -- \
  src/store/profile-preferences-migration.test.ts \
  src/app/chat/sidebar/projects/agent-profile-actions.test.tsx \
  src/store/profile.test.ts \
  src/store/profile-scope.test.ts \
  src/app/chat/sidebar/session-row.test.tsx
```

Expected result on 2026-07-24: 5 test files and 22 tests pass.

## Rollback

The local branch checkpoint is
`wip/hermes-sidecar-upstream-merge-20260724`. To inspect the original
autostashed local patches before this merge, use:

```bash
git stash show --stat stash@{0}
git diff stash@{0}^1 stash@{0}
```
