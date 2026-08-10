# Session Log

## 2026-08-10 - Phase 2A native Claude semantic streaming

Branch: `feat/thin-agent-job-harness`

- Switched native Claude jobs to `stream-json` with partial messages, verbose
  events, and `--no-session-persistence`. This makes Codex-to-Claude work
  incrementally observable without leaving full delegated prompts in Claude's
  project-session history.
- Added provider-neutral normalization for top-level thinking and answer deltas,
  provider waits, usage, terminal errors, and concurrent tool boundaries.
  Assistant snapshots only recover unstreamed blocks, and terminal result text
  never duplicates the partial response.
- Kept tool arguments, result contents, thinking signatures, machine
  inventories, account utilization, and subagent text out of the semantic
  journal. Long tool-input streams produce content-free byte-count heartbeats.
- Replaced the scalar open-tool clock with a bounded per-job tool map. The public
  activity reports the oldest open tool and count until that exact tool closes,
  including out-of-order concurrent completion.
- Defined native Claude `partial_response` as all top-level assistant-visible
  text in order. Failed, cancelled, and interrupted jobs retain emitted work;
  Kimi and CAO compatibility execution remain on output-byte observation.
- Architecture consultation job `1874f688-f2e8-4710-9471-1d210977ff5b`
  returned `REVISE -> PROCEED`; its concurrency, deduplication, privacy,
  coalescing, and recovery requirements were incorporated.
- Primary Opus code review job `ab601681-c508-4eb3-9c17-11fea69383b7`
  returned `DO NOT SHIP`. It reproduced subagent state corruption/journal
  leakage, unmatched tool completion leaving sticky activity, unbounded provider
  waits, malformed-line content exposure, and incorrect error completeness.
- Remediation now drops every nested subagent stream/user/snapshot record before
  state mutation, clears uncertain tool state instead of suppressing stalls,
  escalates stale waits, hashes malformed Claude lines, and persists both
  provider-result and normalization-failure state. Native Claude raw JSON stays
  in the private file and becomes caller-readable only if semantic decoding
  fails; normal reads use events and partial responses.
- Concurrent tool count is now separate from the oldest tool name, capacity
  bounds preserve the oldest activity clock, and same-type snapshot fallback is
  covered explicitly.
- Final pre-follow-up verification: all 134 repository tests passed in 48.032
  seconds; 22 pure decoder tests and the focused Claude supervisor tests passed.
  `py_compile` and `git diff --check` passed. One earlier full run exposed the
  pre-existing cancellation/output timing race; its focused test passed five
  consecutive runs and the final full suite passed.
- Targeted Opus follow-up job `5d9228e2-cfa9-4e50-8458-65e681e75655`
  verified findings 1-12 as resolved or acceptably conservative, then returned
  `DO NOT SHIP` for one new integration blocker: legacy synchronous sidecar and
  delegation consumers still assembled Claude answers from raw stdout.
- Updated the retained rollback sidecar to preserve an event cursor and prefer
  terminal `partial_response`, updated async reads to expose semantic events,
  and changed the delegation CLI to stream normalized `message_delta` events
  with terminal partial recovery. A real temporary supervisor test now proves
  the synchronous Claude adapter returns semantic text rather than raw JSON or
  a false truncation marker.
- Final verification after consumer integration: all 136 repository tests passed
  in 49.413 seconds. The legacy quiet-job fixture now waits for its initial byte
  before backdating liveness, removing a race that caused intermittent false
  failures. `py_compile` and `git diff --check` passed.
- Deployed `com.atum.agent-job-supervisor` only after all active jobs drained;
  client configuration checks remained current. Live native Opus smoke job
  `7c3baee8-cf1f-47c1-8db2-810091aad856` resolved to `claude-opus-5` and exposed
  initialization, waiting, incremental answer deltas, `Read` activity,
  content-free tool-input byte counts, tool completion, and usage before exit.
  It completed zero with raw stdout hidden and `partial_result_state=complete`;
  the retained text contained `STREAMING_SMOKE_OK` exactly once.

Next: observe journal growth and provider behavior during normal use, then scope
the Kimi structured adapter as the next provider phase after its quota returns.

## 2026-08-10 - Phase 1 semantic agent-job observability

Branch: `feat/thin-agent-job-harness`

- Added a pure incremental provider-event decoder and normalized native Codex
  JSONL into a versioned, bounded, append-only event journal while preserving
  existing combined and raw logs.
- Added additive `event_cursor` reads, semantic `activity`, authoritative
  `lifecycle_status`, progress and open-tool timing, and durable bounded partial
  responses for completed, failed, cancelled, and interrupted Codex jobs.
- Preserved legacy callers: reads that omit `event_cursor` remain log-only and
  `status=possibly_stalled` remains a compatibility alias. Claude and Kimi keep
  output-byte liveness until their structured adapters are implemented.
- Ensured stderr noise cannot impersonate Codex semantic progress, open tools are
  not marked stalled, terminal status is visible before terminal wakeup, unknown
  provider payloads are globally bounded, and retention removes event and
  partial-response artifacts.
- Opus architecture consultation `2e943a8a-0745-4038-bc44-13304314d696`
  recommended native structured streams, typed activity, CLI credential
  preservation, and deferring ACP. The implementation follows that boundary.
- Opus assembly review `ae474780-e2b0-4b1e-91b8-b47d0bfe8ec7` initially returned
  `DO NOT SHIP`. Its oversized-record cursor wedge and silent stdout-drain failure
  were reproduced and fixed. The remediation also bounds stalled-job scans,
  clears terminal in-memory state, distinguishes unavailable/truncated partials,
  counts schema-drift records as Codex progress, reports journal truncation, and
  creates private artifacts atomically.
- Targeted Opus follow-up `7a5d9211-613c-4671-8871-eddd396d3880` returned
  `SHIP`, confirming all original findings were remediated. Its deployment
  hardening follow-ups were also applied: startup and launch event writes are
  non-fatal, decoder failure falls back to output liveness, reader-generated
  events are explicitly unsequenced, Unicode messages retain reconstructable
  chunks, and LaunchAgent installation forwards all documented byte budgets.

Verification:

```text
python3 -m unittest discover -s tools/tests
  111 tests passed
```

Next: add structured Claude and Kimi adapters after Phase 1 operational
observation, then evaluate ACP as a provider adapter rather than replacing the
durable supervisor.

Deployment evidence:

```text
LaunchAgent com.atum.agent-job-supervisor
  installed and healthy

Live native Codex semantic smoke
  job=80077b6d-39c7-4a0f-bc9d-d7306388a655
  model=gpt-5.6-sol
  job_started observed while running
  message_delta=PHASE1_STREAM_OK
  partial_result_state=complete
  status=completed
```

The first smoke used unsupported ChatGPT-account model `gpt-5.6-codex` and
correctly retained its warning/error/terminal events under job
`82013b3f-b717-404e-98a4-03cbd9284a16`; the retry used the configured model.
Deployment also exposed and fixed a missing low-level CLI `--event-cursor` and
`--wait-seconds` surface while preserving omitted-cursor compatibility.

Operational incident: an unrelated Atum Opus job was submitted between the
final shared-queue check and the supervisor install, and the restart marked job
`d350df5d-55e4-494c-9cbd-dd13104a1968` interrupted. Its exact-owner durable
delivery was left unacknowledged so the originating task can inspect and retry.

## 2026-08-09 - Phase 7 restart recovery and provider canary gate

Branch: `feat/thin-agent-job-harness`

- Added provider-plus-owner-prefix CAO canary routing while preserving native
  execution as the default. Provider promotion remains independently scoped and
  backend choice is fixed when each job is submitted.
- Added a non-mutating migration evaluator requiring matching fresh CAO mock and
  live-provider gate reports plus five completed canary jobs spanning 24 hours,
  no interruptions, and a bounded failure rate. Its owner namespace is derived
  from the full CAO commit, its minimum thresholds cannot be weakened, and every
  verdict parameter is recorded. Cancelled jobs cannot satisfy completed work.
- CAO now recovers compatibility identity for same-session children from its
  persisted terminal metadata after process restart. Recovery requires complete,
  matching, live metadata and fails closed on malformed or mixed rows. Fresh
  unrelated operator sessions intentionally remain outside the lease.
- Native execution remains deployed. A persistent CAO service and 24-hour
  provider canary are operational promotion steps, not implicit side effects of
  this phase.
- Primary Opus checkpoint `fd31ff0e-1dad-44d9-a399-8cdcf44e447a` returned
  `SHIP` for merge with three fix-before-promotion findings: caller-selectable
  evidence namespaces, omitted verdict parameters, and an observation duration
  measured from any old submission. All three are remediated. The review also
  prompted protected compatibility metadata, read-only evidence DB access,
  non-compatibility fast paths, and focused promotion/installer tests.
- Targeted Opus follow-up `3c2d5264-528f-4691-9395-4d21172d9d35` returned
  `SHIP` and confirmed all three promotion blockers were closed with no new
  blockers. Its five non-blocking operational observations were also resolved:
  metadata updates preserve 404 behavior, acceptance report provenance is
  hashed and recorded, invalid completion timestamps hold cleanly, database
  paths expand `~` consistently, and the gate verifies the installed canary
  LaunchAgent configuration.
- Verification: the complete sidecar suite passed 87 tests. The post-review
  gate, installer, promoted-route, and invalid-backend suite passed nine tests;
  `py_compile`, formatting, and `git diff --check` passed. The affected CAO
  provider, terminal, lease, and metadata suite passed 48 tests; the final
  protected-metadata/lease subset passed nine tests after the follow-up fixes.
- Residual: malformed mixed compatibility membership deliberately fails safe by
  retaining tracked terminals rather than risking deletion of operator state.
  Production routing remains native; no canary service was installed in this
  phase.

## 2026-08-09 - Phase 6 durable delivery and compatibility leases

Branch: `feat/thin-agent-job-harness`

- Added owner-scoped, at-least-once terminal-job deliveries with explicit
  acknowledgement. Delivery creation is transactionally coupled to terminal
  status updates, exact-owner scoped, redelivered until acknowledged, and pruned
  with retained jobs.
- Moved bounded `job_read` waiting into the supervisor. The client adjusts its
  socket deadline to the requested wait, and one request wakes on output,
  semantic status/liveness change, or terminal state instead of reconnecting in
  a polling loop.
- Added the thin `job_inbox` MCP/CLI binding. It exposes no prompts or write mode.
- CAO compatibility launches now carry recursion/provider/job identity, mode,
  and a bounded deadline lease. Direct Kimi ACP workers inherit the same session
  environment, Codex forwards the recursion identity to MCP subprocesses, and
  child CAO terminals persist validated compatibility metadata.
- CAO periodically removes only DB-tracked terminals whose complete tracked
  session membership has a matching expired lease. It never deletes the whole
  tmux session, so raw operator windows are untouched. Missing, mixed, malformed,
  non-finite, far-future, and live metadata fail closed.
- `waiting_user_answer` remains recoverable and does not terminate or delete a
  CAO worker.
- Transport boundary: MCP cannot push into a suspended model turn. The durable
  inbox provides recovery and at-least-once notification when the owner resumes;
  a separate app/host wakeup can trigger that resume without changing job state.
- Primary Opus checkpoint `f3568fb8-5e3f-4ee2-a7c1-c26f902954e1` returned
  `DO NOT SHIP`. Its three blockers were recoverable waiting states, recursion
  depth not reaching Codex MCP subprocesses, and whole-session lease cleanup.
  Those are remediated, along with malformed deadline handling, event registry
  cleanup, exact delivery/pruning coverage, concurrent waiters, and output wakes.
- Targeted Opus follow-up `1a215e82-77a1-4e93-ad1b-3cff0c0d375b` returned
  `SHIP`. Its two actionable runtime residuals were sub-second output wake
  latency and a terminal-race event leak; both are fixed with unconditional
  chunk wakeups and terminal-state registry cleanup, including a regression
  inside the one-second timestamp throttle.
- The remaining restart-persistence residual is an explicit Phase 7 promotion
  gate: CAO's session-env cache is process-local, so identity fallback for
  same-session children after restart and explicit forwarding to fresh child
  sessions must ship before CAO can become the default.
- Verification: the complete sidecar suite passed 78 tests after the final wake
  fix; the three focused wake/concurrency/cancel tests also passed. The CAO
  affected suite passed 213 tests with three environment-dependent skips in
  445.76 seconds. The exact lease/child-metadata suite passed four tests, and
  exact Codex MCP plus Kimi ACP propagation tests passed two tests. Black,
  `py_compile`, and `git diff --check` passed.


## 2026-08-09 - Phase 5 CAO compatibility backend

Branch: `feat/thin-agent-job-harness`

- Added an opt-in CAO execution backend behind the existing `job_submit`,
  `job_read`, `job_list`, and `job_cancel` interface. Native provider execution
  remains the production default during the observation window.
- Added a thin bridge that maps Claude, Codex, and Kimi jobs to CAO sessions,
  preserves model/workspace/mode intent, verifies the actual CAO workspace,
  emits bounded status transitions, retries transient polling failures,
  retrieves a non-empty final result, and attempts CAO session cleanup on every
  exit. Signals now interrupt blocking HTTP calls and all bridge request windows
  are shorter than the supervisor's forced-termination grace.
- Raised the accepted review prompt from 400 KB to 4 MiB in the prompt builder,
  durable supervisor, Unix-socket transport, and compatibility server. Added an
  end-to-end 500 KB transport regression and a 4 MiB boundary rejection test.
- Kept provider credentials out of the bridge environment; CAO uses provider
  authentication already present on its execution host. CAO connection secrets
  no longer enter native provider environments.
- Opus review `dd33fb22-bdbe-4879-aff4-bd3772785c34` returned `DO NOT SHIP` on
  the first pass. Addressed its critical lifecycle and containment findings:
  cleanup is unconditional, workdir is verified, backend selection is durable,
  positive turn limits fail closed, and CAO read-only Codex is rejected because
  this fork cannot enforce its sandbox boundary.
- Targeted Opus follow-up `30235d3a-0918-405e-94c8-e75bcecb00de` remained
  `DO NOT SHIP` because cancellation did not interrupt blocking HTTP and the
  read-only tool policy was not read back. Both blockers are now addressed:
  signals raise into the cleanup path, request timeouts are bounded, and the
  create response must report exactly `fs_read,fs_list`. CAO's Kimi ACP test now
  proves both edits and command execution are denied under that policy.
- Removed periodic bridge heartbeats so semantic soft-stall detection still
  works. Added lifecycle, cleanup, retry, empty-result, signal, workspace,
  credential-isolation, backend-persistence, and fail-closed tests.
- Final verification after remediation: all 70 sidecar tests passed, including
  bridge lifecycle and large-prompt transport; `py_compile` and
  `git diff --check` passed. The affected CAO suite passed 83 status/Kimi/tool
  policy tests plus the focused Codex structured-error test. A live Codex bridge
  run completed with exact result `CAO_BRIDGE_CLEANUP_OK`, and its CAO session
  and tmux process were absent afterward.
- Rollback: drain running CAO jobs, remove `AGENT_JOB_EXECUTION_BACKEND=cao`,
  and restart the supervisor. Queued jobs retain their persisted backend.
- Known pilot gaps carried into Phase 6: CAO-spawned providers do not yet inherit
  the recursion-depth guard; a lost create response can obscure a CAO-renamed
  session from immediate cleanup; status-only output can report a quiet live job
  as `possibly_stalled`; and waiting states rely on the hard deadline.
- Next: Phase 5 commits, then Phase 6 durable completion delivery, recursion
  propagation, and orphan reaping.

## 2026-08-09 - Remove default provider turn ceiling

Branch: `feat/thin-agent-job-harness`

- Changed the durable job contract so `max_turns=0` means no provider turn
  ceiling and made zero the default across MCP, CLI, delegation, compatibility,
  and review-core callers.
- Claude jobs now omit `--max-turns` entirely unless a caller deliberately
  supplies a positive value. Explicit positive values remain available and are
  bounded only by a high defensive parsing cap.
- Kept wall-clock deadlines, soft-stall reporting, cancellation, and process
  cleanup unchanged; those controls remain the authoritative runtime bounds.
- Updated the shared skill so coding agents do not invent arbitrary turn caps
  that can discard a healthy, already-billed run.
- Added regression coverage for stored unlimited jobs and Claude command
  construction with and without an explicit ceiling.
- Trigger: Opus job `ae7bd8e3-3f15-436d-9820-4d4027b4fc96` was still working
  when an explicitly low six-turn ceiling terminated it with no usable output.
- Verification: 34 focused supervisor/core tests passed; `py_compile` passed
  for the supervisor, MCP server, core, CLI/client, and delegation entrypoints;
  `git diff --check` passed. Restarted LaunchAgent
  `com.atum.agent-job-supervisor` successfully. Live Claude Sonnet job
  `616f2675-3b60-470a-89e3-635b75ff18f0` stored `max_turns=0`, completed with
  `UNLIMITED_TURNS_OK`, and remained bounded by its 300-second hard deadline.
  Existing MCP processes were left intact to avoid disrupting active coding
  sessions; restarted apps and new sessions load the updated default schema.
- Next: resume CAO Phase 2 acceptance-harness implementation after this shared
  reliability fix is deployed.

## 2026-08-09 - CAO adoption spike

Branch: `feat/thin-agent-job-harness`

- Audited AWS Labs CLI Agent Orchestrator and found it already implements most
  of the desired centralized coding-agent control plane.
- Installed pinned CAO `2.4.1` side-by-side with isolated state and port while
  leaving the current job supervisor and all live Hermes gateways running.
- Live-tested detached Claude, Codex, and Kimi sessions. Claude completed
  successfully; Codex retained the correct result but remained falsely marked
  processing; Kimi failed because current Kimi Code rejects CAO's obsolete
  `--mcp-config` option.
- Restarted only the pilot CAO server. Claude/Codex records, tmux sessions, and
  output survived, but both terminals became `unknown` and could not receive
  follow-up work.
- Shut down all pilot sessions and the pilot server. No CAO process or tmux
  pilot session remains; the existing `com.atum.agent-job-supervisor` remains
  healthy.
- Superseded the custom async-events implementation plan. The revised strategy
  adopts CAO in stages, keeps the current one-shot path during migration,
  prioritizes ACP-backed providers, and sends general fixes upstream.

Durable findings and acceptance gate: `tools/CAO_ADOPTION_SPIKE.md`.

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
