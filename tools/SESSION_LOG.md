# Session Log

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
