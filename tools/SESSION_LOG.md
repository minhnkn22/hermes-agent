# Session Log

## 2026-08-09 - Async events and completion delivery engineering review

Branch: `feat/thin-agent-job-harness`

- Reviewed the cross-agent timeout and silent-run architecture across the
  supervisor, client, guarded core, MCP binding, skill, and tests.
- Consulted Claude Opus through durable job
  `3bdfee63-d1b9-4e9b-a1dc-1978da1a5941`; no cross-model tension remained after
  repository verification.
- Chose a bounded hybrid event design: raw stdout/stderr remain authoritative,
  normalized provider events use per-job JSONL, and SQLite stores job/liveness
  summaries plus owner-scoped at-least-once completion deliveries.
- Specified true server-side long polling, dynamic transport timeouts, semantic
  liveness, explicit inbox acknowledgement, compatibility constraints,
  retention, rollout, rollback, failure modes, and comprehensive tests.
- Deferred ACP transport, multi-machine execution, interrupted-job replay,
  external workflow engines, and rollback-source removal until the local event
  contract has shipped and been observed.

Durable plan: `tools/AGENT_JOB_ASYNC_EVENTS_PLAN.md`. The gstack engineering
review recorded 11 resolved findings, zero unresolved decisions, and zero
critical gaps. This checkpoint changes documentation and implementation design
only; production behavior is unchanged.

## 2026-08-09 - Claude Desktop and Kimi caller parity

Branch: `feat/thin-agent-job-harness`

- Added an idempotent client installer for Claude Desktop and Kimi Code MCP
  registrations, the shared skill link, and marked Kimi global guidance.
- Confirmed Kimi Code natively discovers `~/.agents/skills` and supports a
  user-level `~/.kimi-code/mcp.json`; no Kimi-specific skill copy is required.
- Preserved the safety boundary: all general-client MCP calls are read-only and
  explicit implementation stays behind the capability-protected CLI.
- Documented current client parity and the local-supervisor/multi-machine
  boundary in `tools/CLIENT_INTEGRATION.md`.

Verification after review: 57 tests and 5 subtests passed, including structured JSON
merge preservation, idempotency, dry-run behavior, guidance replacement, and
malformed-marker refusal. Kimi review job
`6de74efa-a288-41ae-8e66-c006ff884499` reached the provider but failed on its
billing-cycle quota. Opus fallback job `87e309d1-a844-489f-bef9-35f9b7f760bd`
verified the live configuration preserved unrelated settings and the MCP remained
structurally read-only. Its rerun/second-host findings were addressed with unique
backup suffixes, two-phase preflight, cross-target rollback, runtime validation,
actionable JSON errors, conflict reporting, and expanded tests. A live Codex Desktop MCP job
`2f73bb13-3710-419b-ba44-55be87fe344b` completed through Claude Sonnet and
correctly inspected all four registered tools.

Targeted Opus job `47220a2d-a802-4f22-a453-5158d5acfab6` verified every named
finding against the revised preflight/apply/rollback flow and returned `SHIP`.
Its residual fresh-install rollback branch was added to the suite before commit.

## 2026-08-09 - Fat skill and thin cross-agent harness

Branch: `feat/thin-agent-job-harness`

### Decision

The mode-heavy `review-sidecars` MCP mixed policy, prompting, transport, and
process lifecycle. It is now retained only as rollback source. The supported
architecture is:

- `skills/agent-jobs/`: routing, rubrics, fallback, polling judgment, model
  aliases, and explicit implementation delegation.
- `tools/review_core.py`: typed read-only prompt construction, common root and
  context containment, secret refusal/redaction, and bounded Git context.
- `tools/agent_jobs_server.py` and `tools/review_cli.py`: equivalent thin MCP and
  CLI bindings over the same review core.
- `tools/agent_job_supervisor.py`: durable process lifecycle, credentials,
  deadlines, concurrency, idempotency, and capability-gated write jobs.

The MCP exposes only `job_submit`, `job_read`, `job_list`, and `job_cancel`. It
does not expose raw prompts or a write mode. Claude and shell-only sessions use
the CLI binding; Codex and Hermes use MCP. Explicitly requested implementation
uses the skill's separate capability-gated delegation script.

### Migration

- Installed the shared `agent-jobs` skill under `~/.agents/skills` and linked it
  into Claude. Retired Codex's separate `delegate-ai-work` skill to
  `~/.codex/skill-backups/delegate-ai-work-20260809`.
- Replaced the Codex `review-sidecars` registration with `agent-jobs` and reduced
  the MCP ceiling to 90 seconds because provider work now runs asynchronously.
- Migrated all 12 Hermes profiles with per-run config and skill backups. Existing
  sessions keep their loaded schema until restarted; new sessions load the
  generic tools.
- Centralized allowed roots in `agent_job_policy.py`, including ordinary project
  folders and Codex, Hermes, and Atum worktrees. Credential-store paths remain
  blocked even when nested below an allowed root.
- Made profile migration fail on malformed applicable profiles, hash skill
  content, stage replacements before activation, and restore config plus both
  old skill directories after a failed apply.

### Review

Planning review job `87164e52-9daf-4310-9b9b-407da4882264` completed with Claude
Opus and established the layer boundaries above. Kimi assembly review job
`2060ca27-bdff-4639-9f7f-b9006fd6b0bf` failed because its billing-cycle quota
was exhausted. Opus fallback job `9ad9d20f-7da8-4d19-9b7d-6d095e6c6d8d`
completed after a quiet period and found mismatched root sets, swallowed
migration errors, non-transactional skill replacement, owner filtering after
the list limit, and omitted untracked files. Those findings were corrected and
covered by regression tests. Targeted Opus follow-up job
`88ff87b2-9cac-4096-824f-455d70af830a` confirmed the five named findings were
resolved, then identified an untracked-symlink containment regression. The final
fix refuses symlinks and resolved paths outside `workdir`, with a regression test;
the same patch also applies stalled-status filtering before list limits and makes
failed profile migrations immediately retryable.

### Verification

```text
python3 -m unittest discover -s tools/tests -q
  43 tests passed

Hermes venv python -m pytest -q
  43 passed, 3 subtests passed

skill-creator quick_validate.py skills/agent-jobs
  Skill is valid

MCP stdio list_tools
  job_cancel,job_list,job_read,job_submit

Claude Sonnet guarded review job
  86bd1814-65bd-49e2-aa56-c522b5957316 completed
  output included AGENT_JOBS_LIVE_OK

Delegated Codex read-only job with --ignore-user-config
  d8517936-03ba-4bc3-a838-224f2d19c6fb completed
  output included DELEGATED_CODEX_LIVE_OK

Supervisor owner-filter recovery after restart
  returned both assembly jobs before applying limit
```

Restart the Codex desktop app to load the new MCP registration. Restart existing
Hermes agent processes when convenient; no running cluster process was killed by
the profile migration.

## 2026-08-09 - Durable cross-agent job supervision

Branch: `feat/review-sidecars`

### Context

Long-running Codex, Claude, and Kimi calls could time out at an outer MCP/Bash
layer before their inner provider deadline. Async review state lived only inside
one MCP process, output was silent until process exit, and raw delegation did
not own an entire child process group. Per-process semaphores also failed to
provide a machine-wide concurrency limit.

Two Claude Opus plan reviews were attempted before implementation. The full
review remained connected but silent until its 900-second deadline; a compact
one-turn retry exited with `Reached max turns (1)` and no review. Kimi fallback
was unavailable because its billing-cycle quota was exhausted. No model approval
is claimed.

### Changes

- Added a launchd-managed, single-user supervisor with a Unix socket and SQLite
  job state.
- Added durable submit/list/read/cancel operations, cursor logs, separate raw
  stdout/stderr, soft-stall classification, hard deadlines, provider queues,
  process-group termination, restart reconciliation, and recursion rejection.
- Added a singleton state lock, 10 MiB per-job log cap, and 14-day terminal job
  retention.
- Added idempotent submission after a lost-response retry produced a duplicate
  Opus job during checkpoint review.
- Applied Opus assembly-review findings: provider-scoped credentials, exact
  process identity before restart cleanup, capability-authenticated write mode,
  queue time included in deadlines, graceful SIGTERM, bounded terminal reads,
  shared log budget, strict context-file scope, prompt clearing, and expanded
  lifecycle tests.
- Migrated review-sidecar async jobs and synchronous compatibility calls to the
  supervisor. Synchronous calls now use a 540-second internal ceiling below the
  600-second Codex MCP ceiling.
- Migrated the Codex raw Claude/Kimi delegation wrapper to submit-and-poll and
  print `AGENT_JOB_ID` before waiting.
- Corrected the gstack Codex template so its 660-second Bash safety ceiling is
  above its 330/600-second process wrappers, then regenerated the Claude skill.
- Added global Codex and Claude guidance for durable job recovery and installed
  `com.atum.agent-job-supervisor` as a per-user LaunchAgent.
- Preserved the existing uncommitted workspace-root and timeout changes in
  `review_sidecars_server.py` and added the macOS identity variables required
  for Keychain-backed Claude CLI authentication.
- Included the sidecar repository itself in the adapter's conservative default
  roots so its own implementation can be reviewed without broadening to `$HOME`.

### Verification

```text
python3 -m unittest discover -s tools/tests -v
  20 tests passed

python3 -m py_compile tools/agent_job_client.py \
  tools/agent_job_supervisor.py tools/install_agent_job_supervisor.py \
  tools/review_sidecars_server.py

agent_job_client.py ping
  status=ok

Live Claude Sonnet supervisor job
  job=7f03644d-317b-4199-b265-447597b4e931
  status=completed, exit_code=0

Live review adapter job
  job=34745d86-9878-4a0c-8488-f250c06ff6f8
  output=MCP_ADAPTER_OK, status=completed

Post-review synchronous adapter job
  job=de111ac0-1b9e-4571-9c59-7fe81e18708f
  output=SYNC_ADAPTER_V2_OK, status=completed

Duplicate daemon launch
  refused by state-directory singleton lock
```

Assembly review: Kimi K3 failed with billing-cycle quota exhaustion. Claude Opus
completed as the configured fallback and returned `DO NOT SHIP` with three P0s.
Those blocking findings and the deadline/restart/logging issues were corrected;
the tests above include exact and mismatched restart identities, running and
queued deadlines, provider credential isolation, idempotency, and escaped large
prompts.

The permitted targeted Opus follow-up completed through the durable supervisor.
It confirmed the original credential, restart-identity, deadline, prompt,
singleton, and idempotency findings were resolved, then found a production-only
duplicate-launch race plus scheduler-wedge and synchronous-output truncation
paths. The final implementation atomically claims queued jobs as `launching`,
guards task IDs, survives scheduler iteration errors, accumulates bounded stdout
from byte zero with explicit truncation markers, isolates MCP in write mode, and
builds subdirectory Git context from repository-root paths. Production
concurrency and adapter regressions are covered by the expanded 20-test suite.

### Operations

Runtime state is under `~/.local/state/agent-job-supervisor`. Existing Codex
tasks retain their original MCP schema and transport; restart Codex after this
deployment to load `review_list` and cursor-aware `review_read`. New tasks use
the updated server automatically.
