# Agent Job Async Events Plan

Status: Phase 1, native Claude Phase 2A, and native Kimi Phase 2B are implemented on the native
supervisor. The CAO adoption spike in `tools/CAO_ADOPTION_SPIKE.md` remains a
provider-backend experiment, not a prerequisite for semantic observability.

Phase 1 normalizes native Codex JSONL, persists a bounded event journal and
partial response, splits lifecycle from activity, and exposes additive event
cursors. Long-poll and durable inbox behavior remain in the native supervisor.
Native Claude now adds structured deltas, provider waits, concurrent tool
tracking, privacy-safe tool-input heartbeats, usage, and recoverable partial
responses. Native Kimi now normalizes incremental assistant messages and
privacy-safe tool/result metadata while retaining byte-based liveness because
its stream has no tool-start boundary. ACP remains deferred until the event
contract has operational evidence.

Outside architecture consultation: Claude Opus job
`3bdfee63-d1b9-4e9b-a1dc-1978da1a5941`.

Phase 1 architecture consultation: Claude Opus job
`2e943a8a-0745-4038-bc44-13304314d696`.

Phase 2A architecture consultation: Claude Opus job
`1874f688-f2e8-4710-9471-1d210977ff5b`.

Phase 2B architecture consultation: Claude Opus job
`40b81b46-2e70-4245-80fb-e096456f42e4`.

Phase 2B is fixture-verified against the `PromptJsonWriter` schema embedded in
installed Kimi Code `0.34.0`. A live provider smoke is deferred until quota
returns; this is an operational follow-up, not an ACP dependency.
The per-job `semantic_stream` bit is persisted with backend selection so a
kill-switch change affects only new submissions and cannot reinterpret retained
raw output.

## Goal

Make cross-agent work observable and recoverable without keeping the calling
Codex, Claude, Kimi, or Hermes session blocked. Provider output should become
visible as it arrives, quiet-but-live work should be distinguishable from a dead
run, and completed work should be discoverable without constant polling.

The supervisor remains the durable execution authority. Skills remain the
policy layer. MCP and CLI bindings remain thin transports.

## Scope Decision

The first release is intentionally limited to four capabilities:

1. A versioned, provider-neutral event stream alongside the existing raw logs.
2. True server-side long-poll reads that wake on progress or terminal state.
3. An owner-scoped, at-least-once completion inbox with explicit acknowledgement.
4. Semantic liveness fields that distinguish transport silence from meaningful
   progress and provider-declared waiting states.

This is a scope reduction from the broader idea of adopting an external agent
orchestration framework or ACP immediately. The existing daemon already owns the
hard parts of local durability, credentials, process identity, deadlines,
concurrency, cancellation, retention, and workspace containment.

## NOT in Scope

- **ACP provider transport:** defer until the event contract is stable. ACP may
  later become a provider adapter; it is not the supervisor foundation.
- **Hatchet, Temporal, or another workflow engine:** operational cost is not
  justified for one-machine process supervision.
- **Forking cc-fleet or MCO:** reuse ideas and standards, not their lifecycle or
  product assumptions.
- **Multi-machine execution:** the owner/inbox schema must not prevent it, but
  authentication, routing, and remote artifacts are a separate project.
- **Interrupted-job replay:** prompts are intentionally scrubbed after launch,
  so automatic replay would weaken the current privacy guarantee.
- **Exactly-once delivery:** the inbox provides at-least-once delivery with
  idempotent acknowledgement. Exactly-once claims would be misleading.
- **Removing rollback source:** keep the inactive `review-sidecars` source until
  the new read and inbox paths have been deployed and observed.
- **Autonomous cancellation of quiet jobs:** semantic silence remains diagnostic;
  only caller cancellation or the submit-relative hard deadline terminates work.

## What Already Exists

| Existing capability | Location | Decision |
|---|---|---|
| Durable SQLite job state and WAL | `tools/agent_job_supervisor.py:137-230` | Reuse and migrate in place. |
| Provider process queues and concurrency | `tools/agent_job_supervisor.py:581-608` | Reuse unchanged. |
| Submit-relative hard deadlines | `tools/agent_job_supervisor.py:527-541` | Preserve; events never extend the deadline. |
| Process identity verification on restart | `tools/agent_job_supervisor.py:610-641` | Preserve unchanged. |
| Bounded combined and raw logs | `tools/agent_job_supervisor.py:396-430` | Preserve raw logs; stop treating the combined log as structured data. |
| Cursor reads and terminal output tails | `tools/agent_job_supervisor.py:688-732` | Keep backward compatible while adding an event cursor. |
| Read-only context and secret guards | `tools/review_core.py` | Reuse unchanged. |
| Typed MCP and CLI lifecycle bindings | `tools/agent_jobs_server.py`, `tools/review_cli.py` | Extend minimally; do not expose raw prompts or write mode. |
| Owner labels and retention pruning | job schema and scheduler | Reuse as the basis for inbox isolation and cleanup. |

## Reviewed Architecture

### Data Flow

```text
fat skill / coding client
        |
        | job_submit(provider, model, owner, typed context)
        v
+----------------------- Unix socket -----------------------+
|                  agent job supervisor                     |
|                                                           |
|  SQLite jobs ---- scheduler ---- provider process         |
|       |                              |                     |
|       |                         stdout/stderr               |
|       |                              |                     |
|       |                  +-----------+-----------+         |
|       |                  |                       |         |
|       |             raw byte logs         line decoder     |
|       |                                          |         |
|       |                                 provider adapter   |
|       |                                          |         |
|       +---- summary fields <---- normalized events.jsonl  |
|       |                                          |         |
|       +---- terminal delivery ---- SQLite inbox            |
|                                                           |
|  per-job condition wakes long-poll readers on event/state |
+-----------------------------------------------------------+
        |                                  |
        | job_read(wait_seconds,            | job_inbox(owner,
        | event_cursor)                     | ack_delivery_ids)
        v                                  v
 incremental progress/result          completion notification
```

### Storage Contract

Keep three representations with distinct purposes:

1. `<job>.log.stdout` and `<job>.log.stderr` remain bounded raw evidence.
2. `<job>.events.jsonl` is a bounded append-only normalized event journal.
3. SQLite stores job summaries and inbox delivery metadata, not token deltas.

This hybrid prevents SQLite write amplification while retaining durable,
cursor-addressable progress. A malformed provider line is recorded as a raw
fallback event and never fails the job.

Each event uses schema version 1:

```json
{
  "v": 1,
  "seq": 17,
  "job_id": "uuid",
  "ts": 1786200000.125,
  "provider": "claude",
  "kind": "message_delta",
  "payload": {"text": "..."}
}
```

Required event kinds are `job_started`, `turn_started`, `message_delta`, `thinking_delta`,
`tool_started`, `tool_finished`, `progress`, `waiting`, `usage`, `warning`, `parse_error`,
`provider_raw`, `truncated_event`, and `job_terminal`. Unknown provider event types are retained under
`payload.provider_event` rather than rejected.

Event sequence numbers are monotonically increasing per job. Readers use an
opaque byte `event_cursor`; `seq` is diagnostic and supports ordering checks.
The journal is capped separately from raw logs. When capped, append one
`warning` truncation event if space permits and continue updating summary state.

### Provider Adapters

- **Claude:** invoke with `--output-format stream-json
  --include-partial-messages --verbose --no-session-persistence`; normalize
  complete JSON lines, coalesce adjacent deltas, and never copy tool contents,
  signatures, inventories, or subagent text into the semantic journal.
- **Codex:** retain `exec --json`; normalize complete JSON lines.
- **Kimi:** accept structured output when available; otherwise emit bounded
  line-based `message_delta` or `progress` fallback events.
- **All providers:** preserve raw bytes before decoding. Use an incremental
  UTF-8 decoder and retain partial lines across 16 KiB reads.

For native Claude, raw stdout remains a mode-`0600` local diagnostic
artifact and is not mirrored into the combined caller log or returned by normal
reads. Clients consume normalized events and retained partial responses instead.

Adapters are pure functions in a new `tools/agent_job_events.py` module. They do
not own process lifecycle, storage, deadlines, or routing.
Adjacent same-kind text deltas may coalesce for both Codex and Claude; event
counts are therefore transport-dependent while reconstructed text is stable.

### Read Contract

Extend `job_read` without breaking existing callers:

```text
job_read(
  job_id,
  cursor=0,                 # existing combined-log cursor
  event_cursor=0,           # new normalized-event cursor
  max_bytes=64000,
  wait_seconds=0            # bounded to 60 seconds
)
```

The result keeps `job`, `cursor`, and `output`, and adds `event_cursor` and
`events`. A read with `wait_seconds > 0` remains open inside the supervisor
until one of these conditions occurs:

- bytes exist after `cursor`;
- normalized events exist after `event_cursor`;
- job status or semantic liveness changes;
- the job reaches a terminal state;
- the requested wait expires.

The client socket timeout is computed as `wait_seconds + 15` seconds, clamped to
75 seconds. Non-read operations retain the existing 15-second timeout. MCP may
wait at most 60 seconds, so no single transport call is held indefinitely.

### Completion Inbox

Add a `deliveries` table:

```text
delivery_id TEXT PRIMARY KEY
job_id      TEXT UNIQUE NOT NULL
owner       TEXT NOT NULL
created_at  REAL NOT NULL
acked_at    REAL
```

Create one delivery transactionally when a job enters any terminal state and
has a non-empty owner. Expose one additional thin tool:

```text
job_inbox(owner, limit=20, ack_delivery_ids=[])
```

The call first idempotently acknowledges the supplied delivery IDs belonging to
that owner, then returns oldest unacknowledged terminal job summaries. Reads are
non-destructive. A crash after receipt and before acknowledgement causes a safe
redelivery. Owner matching is exact and the response never includes prompts.

### Semantic Liveness

Add job summary fields:

- `last_event_at`: any normalized event.
- `last_progress_at`: meaningful model/tool progress, excluding transport-only
  bytes and heartbeat touches.
- `last_event_kind`: most recent normalized kind.
- `waiting_on`: bounded provider-declared wait reason, otherwise empty.

Keep `last_output_at` for backward compatibility. Compute `possibly_stalled`
from `last_progress_at`, falling back to `last_output_at` for legacy jobs.
`waiting_on` is advisory and never pauses or extends the hard deadline.

### State and Wakeup Model

```text
queued -> launching -> running ---------------------> completed
   |         |          |  \-----------------------> failed
   |         |          |--------------------------> cancelled
   |         |          \--------------------------> interrupted
   |         |
   +---------+--------------------------------------> cancelled/failed

running presentation only:
  progress within threshold -> running
  semantic silence threshold -> possibly_stalled
  provider waiting event     -> running + waiting_on

every event or state transition:
  persist -> notify per-job Condition -> waiting reads re-check predicates
```

Conditions are in-memory wakeup hints, not state. After daemon restart, reads
derive truth from SQLite and files. Conditions are created lazily and removed
after terminal jobs have no waiters.

## Engineering Review Findings

The user authorized recommended choices for routine decisions. All findings
below are folded into this plan; no hard decision remains unresolved.

### 1. Architecture Review

1. **[P1] (confidence: 10/10) `tools/agent_job_supervisor.py:400,436` - chunk-prefixed combined logs cannot be a structured event source.**
   Motivating lines: `prefix = ...` and `chunk = await reader.read(16 * 1024)`.
   A JSON line can be split at an arbitrary byte boundary and receive a prefix
   in the middle. Decision: parse provider streams incrementally and write a
   separate normalized event journal; preserve combined logs only for humans.

2. **[P1] (confidence: 10/10) `tools/review_core.py:311-315` - current waiting is client-side polling.**
   Motivating lines: `result = read(...)` followed by `time.sleep(min(0.5, ...))`.
   Decision: move waiting into the supervisor and wake readers on durable state
   changes. This reduces socket churn and makes one read represent one wait.

3. **[P1] (confidence: 10/10) `tools/agent_job_client.py:38` - the fixed 15-second socket timeout conflicts with waits up to 60 seconds.**
   Motivating line: `client.settimeout(15)`. Decision: derive read timeout from
   requested wait plus bounded transport grace; retain 15 seconds elsewhere.

4. **[P2] (confidence: 9/10) terminal jobs have no durable consumer delivery.**
   Motivating lines: terminal state is persisted at
   `tools/agent_job_supervisor.py:555-558`, while the public actions at
   `tools/agent_job_supervisor.py:741-765` expose only submit/read/list/cancel.
   Decision: add owner-scoped, at-least-once inbox delivery with explicit ack.

5. **[P2] (confidence: 10/10) transport activity is currently treated as model progress.**
   Motivating lines: every non-empty chunk updates `last_output_at` at
   `tools/agent_job_supervisor.py:427-430`, and stall state is derived from it at
   `tools/agent_job_supervisor.py:388-393`. Decision: track semantic progress
   separately and retain byte activity only as compatibility telemetry.

No distribution artifact is introduced. The existing installer deploys the
updated Python source and restarts the LaunchAgent; CI continues to test source.

### 2. Code Quality Review

6. **[P2] (confidence: 9/10) adding provider parsing directly to the 841-line supervisor would mix lifecycle and protocol concerns.**
   Motivating methods are `_append_log` and `_stream` at
   `tools/agent_job_supervisor.py:396-439`, already responsible for storage and
   process I/O. Decision: add one pure normalization module with no service or
   persistence abstraction.

7. **[P2] (confidence: 9/10) terminal transitions are spread across launch,
   cancellation, timeout, exception, and restart paths.** Motivating updates are
   visible at `tools/agent_job_supervisor.py:479-488`, `508-511`, `555-573`, and
   `758-762`. Decision: introduce one supervisor helper that atomically applies
   terminal job state, appends `job_terminal`, creates the delivery, and wakes
   readers. Do not duplicate this sequence at each exit path.

8. **[P2] (confidence: 8/10) backward compatibility needs an explicit contract.**
   Motivating return shape: `{"job": ..., "cursor": ..., "output": ...}` at
   `tools/agent_job_supervisor.py:705`. Decision: keep every existing field and
   behavior; new event fields are additive and default to empty/zero.

Existing lifecycle diagrams in `tools/AGENT_JOB_SUPERVISOR.md` must be updated.
The complex pipeline gets an inline ASCII comment at the stream decoder boundary;
the full diagrams remain in documentation rather than crowding simple helpers.

### 3. Test Review

The project uses Python `unittest`, with supervisor integration tests in
`tools/tests/test_agent_job_supervisor.py` and binding/core tests in
`tools/tests/test_review_core.py`.

```text
CODE PATHS                                           CALLER FLOWS
[+] provider process output                         [+] Submit and observe
  +-- raw bytes -> raw logs                           +-- submit returns job ID
  +-- incremental UTF-8 decode                        +-- long read wakes on event [E2E]
  |   +-- complete JSON line                          +-- quiet read expires cleanly [E2E]
  |   +-- partial line across chunks                  +-- terminal result remains readable
  |   +-- invalid UTF-8 fallback
  +-- provider normalize                            [+] Leave and return
      +-- known event                                  +-- owner inbox redelivers until ack [E2E]
      +-- unknown event                                +-- ack removes only owner's delivery
      +-- malformed line -> parse_fallback             +-- daemon restart preserves delivery

[+] supervisor state                                [+] Diagnose liveness
  +-- append event -> summary -> notify               +-- semantic progress resets silence
  +-- terminal helper -> delivery -> notify            +-- byte noise does not reset progress
  +-- hard deadline independent of events              +-- waiting reason is visible
  +-- prune job + logs + events + deliveries            +-- hard deadline still terminates
```

Coverage requirements:

- Unit-test Claude structured events, Codex JSON, Kimi fallback, unknown types,
  malformed JSON, partial lines, split UTF-8, empty lines, and bounded payloads.
- Integration-test long-poll wake on event, status transition, terminal state,
  cancellation, timeout, expiry, and multiple concurrent readers.
- Regression-test `cursor`/`output`, terminal stdout/stderr tails, and all four
  existing tool calls before adding `job_inbox`.
- Test inbox redelivery, acknowledgement, duplicate acknowledgement, wrong-owner
  acknowledgement, no-owner terminal jobs, exact owner isolation, ordering,
  limits, retention, and supervisor restart.
- Test semantic liveness fallback for pre-migration jobs, waiting state,
  progress events, raw-byte-only output, and the invariant that neither progress
  nor waiting extends the submit-relative hard deadline.
- Test event-journal truncation and pruning alongside all existing raw files.
- Test MCP/CLI argument parity and the exact five-tool read-only MCP surface.
- Run a provider smoke test for Claude, Codex, and Kimi after installation. This
  is an integration check, not a deterministic CI assertion.

No prompt or rubric changes are planned, so a model-quality eval is not required.

### 4. Performance Review

9. **[P1] (confidence: 9/10) persisting every token delta in SQLite would create avoidable WAL and lock pressure.**
   Motivating storage setup: one SQLite connection with WAL and a five-second
   busy timeout at `tools/agent_job_supervisor.py:142-145`. Decision: append
   deltas to files and throttle summary-column writes to at most once per second.

10. **[P2] (confidence: 8/10) unbounded events or waiter registries would turn
    observability into a disk or memory leak.** Motivating precedent: raw logs
    are explicitly budgeted at `tools/agent_job_supervisor.py:403-426`, and
    terminal files are pruned at `tools/agent_job_supervisor.py:585-591`.
    Decision: add a separate event budget, prune event files and acknowledged
    deliveries with job retention, index `(owner, acked_at, created_at)`, and
    remove unused per-job conditions.

11. **[P2] (confidence: 8/10) many waiting readers could be awakened by unrelated
    jobs if a global condition were used.** Decision: use per-job conditions for
    reads and a separate inbox condition for terminal deliveries.

## Failure Modes

| Codepath | Production failure | Test | Handling | Caller experience |
|---|---|---|---|---|
| Provider decoder | JSON or UTF-8 split across chunks | Required | Incremental buffer/decoder | Fallback event; job continues |
| Provider adapter | New unknown event type | Required | Preserve opaque provider event | Progress remains visible |
| Event append | Event budget exhausted | Required | One warning, summary continues | Explicit truncation warning |
| Long poll | No output before wait expiry | Required | Return unchanged cursors/status | Normal empty wake, retry later |
| Long poll | Client disconnects | Required | Writer cleanup; job unaffected | Caller can reconnect |
| Long poll | Supervisor restarts | Required | Socket error then durable reread | Retry recovers state |
| Multiple readers | Wakeup race | Required | Predicate loop under condition | No missed durable event |
| Terminal transition | Process exits during cancel | Required | Idempotent terminal helper | One final state/delivery |
| Inbox read | Crash before ack | Required | At-least-once redelivery | Duplicate is identifiable |
| Inbox ack | Wrong owner supplies ID | Required | Exact-owner update only | No cross-owner data change |
| Semantic liveness | Provider emits transport noise only | Required | Progress clock unchanged | `possibly_stalled` is honest |
| Deadline | Provider continuously streams | Required | Absolute deadline unchanged | Explicit timeout terminal state |
| Prune | Retention runs during a read | Required | Open-file/read error handled as empty/stale retry | Recoverable reread |

There are no accepted failure modes that are both silent and lack tests/error
handling. Critical gaps after review: 0.

## Implementation Sequence

### Dependencies

| Step | Modules touched | Depends on |
|---|---|---|
| Event contract and provider normalization | `tools/`, `tools/tests/` | - |
| Supervisor journal, liveness, and terminal helper | `tools/`, `tools/tests/` | Event contract |
| Server-side long poll and client timeout | `tools/`, `tools/tests/` | Supervisor journal |
| Completion inbox and retention | `tools/`, `tools/tests/` | Terminal helper |
| MCP/CLI bindings and shared skill guidance | `tools/`, `skills/` | Long poll, inbox |
| Installation smoke tests and docs | `tools/`, `skills/` | All implementation |

All production steps touch `tools/` and share protocol contracts. Sequential
implementation is safer than parallel worktrees. Test fixtures and docs can be
prepared alongside implementation, but should land in the same branch to avoid
contract drift.

Recommended order:

1. Define normalizer/event tests, then implement `agent_job_events.py`.
2. Add schema migration, journal writer, terminal helper, and liveness summaries.
3. Add condition-based long poll and dynamic client timeout.
4. Add inbox storage/action and retention cleanup.
5. Extend core, MCP, CLI, installer deployment, and skill operations guidance.
6. Run unit/integration suites, reinstall the LaunchAgent, and smoke-test all
   three providers plus disconnect/reconnect behavior.
7. Keep rollback registration available for one observation window; remove it in
   a later cleanup only after no consumers rely on the old paths.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~4h / Codex: ~35min)** - event protocol - Implement bounded provider-neutral event journals
  - Surfaced by: Architecture findings 1 and 5; Performance finding 9.
  - Files: `tools/agent_job_events.py`, `tools/agent_job_supervisor.py`, `tools/tests/test_agent_job_events.py`, `tools/tests/test_agent_job_supervisor.py`
  - Verify: `python3 -m unittest tools.tests.test_agent_job_events tools.tests.test_agent_job_supervisor -v`
- [ ] **T2 (P1, human: ~3h / Codex: ~25min)** - read transport - Replace client polling with condition-based server long poll
  - Surfaced by: Architecture findings 2 and 3.
  - Files: `tools/agent_job_supervisor.py`, `tools/agent_job_client.py`, `tools/review_core.py`, supervisor/core tests
  - Verify: concurrent wake, expiry, restart, and disconnect integration tests.
- [ ] **T3 (P2, human: ~3h / Codex: ~25min)** - completion delivery - Add owner-scoped at-least-once inbox and acknowledgement
  - Surfaced by: Architecture finding 4 and Code Quality finding 7.
  - Files: supervisor store/action, core, MCP server, CLI, supervisor/core tests
  - Verify: owner isolation, redelivery, idempotent ack, restart, and retention tests.
- [ ] **T4 (P2, human: ~2h / Codex: ~20min)** - liveness - Separate semantic progress from raw byte activity
  - Surfaced by: Architecture finding 5.
  - Files: event adapter, supervisor summaries, supervisor tests
  - Verify: raw noise, progress, waiting, legacy fallback, and hard-deadline tests.
- [ ] **T5 (P2, human: ~2h / Codex: ~20min)** - compatibility and operations - Extend bindings, deployment, docs, and provider smoke checks
  - Surfaced by: Code Quality finding 8 and Performance findings 10-11.
  - Files: `tools/agent_jobs_server.py`, `tools/review_cli.py`, installer, `skills/agent-jobs/`, supervisor/client docs and tests
  - Verify: full unittest discovery, py_compile, reinstall/status, three-provider smoke test.

## TODOS.md Decisions

No follow-up item belongs in `TODOS.md` now. ACP, multi-machine execution,
interrupted-job replay, and rollback-source removal are deliberately deferred
projects with explicit rationale in this plan, not forgotten implementation
tasks. Creating vague TODOs for them would lose the constraints captured here.

## Rollout and Rollback

1. All schema changes use additive `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS`.
2. Old readers continue to consume `cursor` and `output` unchanged.
3. Deploy source, restart the LaunchAgent, verify `ping`, then run provider smoke
   jobs with unique owners and confirm event wake plus inbox delivery.
4. Observe event disk growth, SQLite WAL size, waiter count, parse fallbacks, and
   redelivery count during the first week.
5. Rollback is a source rollback plus LaunchAgent restart. Additive columns,
   deliveries, and event files are harmless to the previous daemon. Do not
   downgrade by deleting state.

## Completion Summary

- Step 0: Scope Challenge - scope reduced per recommendation.
- Architecture Review: 5 issues found, all resolved in the plan.
- Code Quality Review: 3 issues found, all resolved in the plan.
- Test Review: diagram produced, 7 coverage groups identified and specified.
- Performance Review: 3 issues found, all resolved in the plan.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed; deferrals are captured here.
- Failure modes: 0 critical gaps after required coverage and handling.
- Outside voice: ran Claude Opus; no cross-model tension.
- Parallelization: 1 production lane, sequential because contracts share `tools/`.
- Lake Score: 11/11 recommendations chose the complete option.

## GSTACK REVIEW REPORT

| Review | Status | Findings |
|---|---|---|
| Eng Review | CLEAR (PLAN) | 11 issues, 0 unresolved, 0 critical gaps |
| Outside Voice | CLEAR (Claude Opus) | Durable core retained; events, long poll, inbox, and semantic liveness recommended |

VERDICT: CLEARED - implementation may proceed in the sequence above.

NO UNRESOLVED DECISIONS
