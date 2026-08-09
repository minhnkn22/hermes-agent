# CAO Adoption Spike

Date: 2026-08-09

Status: completed; staged adoption recommended

## Decision

Use AWS Labs CLI Agent Orchestrator (CAO) as the target centralized interactive
agent control plane. Do not replace the current durable `agent-jobs` supervisor
yet. Keep it for reliable one-shot consultations and reviews while CAO gaps are
fixed and accepted upstream.

The migration is successful when CAO, preferably through ACP-backed provider
adapters, passes the same safety and durability contract as the current
supervisor. At that point the compatibility MCP can map existing `job_*` calls
onto CAO and the old daemon can be retired.

## Why the Recommendation Changed

The prior engineering review correctly specified streaming, asynchronous
submission, durable completion delivery, semantic liveness, and restart
recovery, but assumed no existing coding-agent control plane covered them.

CAO now provides most of that system:

- native Claude Code, Codex, Kimi, Hermes, and other CLI providers;
- native provider authentication and model access;
- FastAPI, MCP, CLI, and web control planes;
- SQLite session, terminal, inbox, workflow, and memory state;
- PTY streaming, event history/SSE, and terminal logs;
- asynchronous session messaging;
- supervisor/worker inbox callbacks;
- worktree provisioning, profiles, skills, and tool policies;
- workflow journals and resume support.

Repository inspection found CAO `2.4.1`, 300 Python test files, approximately
1,211 test functions, and explicit coverage for workflow journals, concurrent
resume fencing, inbox delivery, event streaming, and provider behavior. Reusing
that foundation is materially safer than reproducing it here.

## Pilot Isolation

The spike used:

```text
CAO version:       2.4.1
CAO data:          ~/.local/share/atum-cao-pilot
CAO API port:      9891
Terminal backend:  tmux 3.6a
Claude Code:       2.1.226
Codex CLI:         0.144.6
Kimi Code:         0.34.0
Hermes Agent:      0.19.0
```

The existing `com.atum.agent-job-supervisor` LaunchAgent remained running. No
active project worktree or live Hermes gateway was stopped. Pilot CAO sessions
and the pilot server were shut down after testing.

CAO remains installed as a `uv` tool for follow-up work. Its environment is
about 129 MiB; isolated pilot state is under 1 MiB.

## Live Results

### Passed

1. **Installation and isolation**
   - Pinned PyPI release installed side-by-side.
   - `CAO_HOME_DIR` and a separate port isolated CAO state and service traffic.
   - CAO detected Claude, Codex, Kimi, and Hermes binaries.

2. **Claude asynchronous execution**
   - `cao launch --async` returned after initialization and message dispatch.
   - Native Claude authentication worked.
   - Read-only tool restrictions were translated to Claude hard-deny flags.
   - The response `CAO_CLAUDE_ASYNC_OK` was recoverable through session status
     and retained terminal output.

3. **Codex asynchronous execution and retained output**
   - Native Codex authentication worked.
   - The response `CAO_CODEX_ASYNC_OK` was retained and readable.
   - Raw PTY output remained accessible through the HTTP terminal endpoint.

4. **Process independence**
   - Claude and Codex ran in detached tmux sessions, independent of the launch
     command and the calling Codex task.

5. **Server restart data survival**
   - Terminal records, tmux sessions, logs, and prior responses survived a CAO
     server stop/start cycle.

### Failed or Incomplete

1. **Kimi provider compatibility: blocking**
   - CAO launched Kimi with `--mcp-config`.
   - Installed Kimi Code `0.34.0` rejects that removed option.
   - The CAO HTTP launch request timed out after 30 seconds and left an unknown
     terminal until cleanup.
   - Current Kimi exposes a native `kimi acp` server. The correct fix is an ACP
     adapter or an updated provider integration, not another TUI workaround.

2. **Codex semantic liveness: blocking**
   - Codex produced its exact terminal answer and returned to its input prompt.
   - CAO continued reporting `processing` after the answer was visible.
   - A caller relying on status would wait unnecessarily or misclassify the run.

3. **Session reconciliation after server restart: blocking**
   - Surviving Claude and Codex tmux sessions were reported as `unknown` after
     CAO restarted.
   - Sending another message was rejected because the terminal was `unknown`.
   - Persistence therefore retained evidence but did not restore operability for
     interactive sessions in this test.

4. **Stable-release async workflow surface: incomplete**
   - The `2.4.1` CLI and OpenAPI expose blocking workflow runs plus status,
     cancellation, and resume.
   - The newer detached workflow start/list/result/wait/events surface exists on
     current upstream `main` and in its changelog, but was not present in the
     installed release tested here.
   - Production must pin a released, tested build or a reviewed source commit;
     documentation from `main` cannot be assumed to match PyPI.

5. **Structured progress for external MCP callers: incomplete**
   - Stable CAO provides PTY output and optional fleet events, but the fleet event
     endpoint is disabled by default and is not equivalent to normalized model
     token/tool progress for every provider.
   - Current-main workflow events are promising but need a released acceptance
     test before replacing the existing job-read contract.

6. **Read-only enforcement for Codex and Kimi: known limitation**
   - CAO explicitly warns that restrictions for both providers are soft,
     prompt-level policy.
   - Claude restrictions are hard-enforced through native deny flags.
   - Our compatibility layer must retain workspace isolation and independently
     verify write behavior for review jobs.

## Side Effects Observed

- `cao install` wrote CAO profile files under the isolated pilot directory and
  corresponding Kiro profile files under `~/.kiro/agents/` even though Kiro is
  not installed. This is an upstream isolation leak to account for in packaging.
- CAO changed Kimi's `tool_call_timeout_ms` from 60,000 to 600,000 in
  `~/.kimi/config.toml`. The higher value matches the desired long-running MCP
  policy, but provider installers should not mutate unrelated global config
  without an explicit deployment step.

## Target Architecture

```text
Codex / Claude / Kimi / Hermes / mobile or Telegram clients
                         |
                  shared fat skills
        routing, rubrics, safety, spend, documentation
                         |
              thin compatibility interface
                         |
          +--------------+----------------+
          |                               |
  current agent-jobs                CAO control plane
  one-shot fallback          sessions, workflows, inbox, UI
          |                               |
          +---------------+---------------+
                          |
                provider adapter contract
                  ACP first where stable
                structured CLI otherwise
                          |
              native provider authentication
```

The dual execution path is temporary. Skills choose the current supervisor for
one-shot review/consultation until the CAO path passes every acceptance test.
They choose CAO only for explicitly enabled interactive fleet experiments.

## Engineering Work We Should Own

1. **Acceptance harness, not another orchestrator**
   - Exercise Claude, Codex, Kimi, and Hermes against one provider contract.
   - Verify submit, stream, result, cancel, restart, callback, timeout, model
     selection, read-only behavior, and resource cleanup.

2. **ACP-backed CAO providers**
   - Start with Kimi because its installed CLI exposes `kimi acp` and the current
     CAO provider is broken.
   - Evaluate official/community Claude and Codex ACP adapters against native
     subscription authentication and tool-policy requirements.
   - Contribute adapters and compatibility fixes upstream where maintainers
     accept the architecture.

3. **Reliable restart reconciliation**
   - Reattach status monitoring and inbox delivery to surviving terminals, or
     explicitly classify them as retained-but-nonresumable with a safe recovery
     action.

4. **Thin host wakeup bridges**
   - CAO emits completion and retains results.
   - Telegram/macOS notification is straightforward.
   - Waking the exact originating Codex/Claude Desktop task remains host-specific
     and must use a supported host API rather than pretending MCP can initiate a
     model turn.

5. **Compatibility migration**
   - Preserve existing `job_submit`, `job_read`, `job_list`, and `job_cancel`
     callers while mapping them to the accepted CAO workflow/session APIs.
   - Keep idempotency, owner scoping, secret guards, hard deadlines, and bounded
     result reads from the current implementation.

## Acceptance Gate

CAO becomes the default only when all of these pass on a pinned build:

| Requirement | Current result |
|---|---|
| Claude async submit and result | Pass |
| Codex async submit and result | Partial: result pass, status fail |
| Kimi async submit and result | Fail: incompatible CLI flag |
| Hermes async submit and result | Not yet exercised |
| Streaming visible to external caller | Partial |
| Durable inbox callback | Source/tests verified; live end-to-end pending |
| Server restart and continued operation | Fail |
| Cancellation and hard timeout | Source/tests verified; live pending |
| Exact model selection | Source verified; live pending |
| Enforced read-only review | Claude pass; Codex/Kimi soft only |
| Bounded logs and cleanup | Source verified; live pending |
| Host completion notification | Design pending per host |

## Next Implementation Sequence

1. Create a separate CAO integration branch/fork tracking upstream `v2.4.1` and
   current `main`; do not patch the installed tool in place.
2. Add a reproducible acceptance script using isolated `CAO_HOME_DIR`, port, and
   disposable repositories.
3. Replace the Kimi PTY launch path with ACP and contribute the fix upstream.
4. Reproduce and fix Codex completion detection and restart reconciliation with
   regression tests upstream.
5. Test current-main detached workflow events and inbox callbacks end to end.
6. Implement the minimal `job_*` compatibility adapter only after those tests
   pass.
7. Run a limited observation period before stopping the current supervisor.

## Superseded Work

`tools/AGENT_JOB_ASYNC_EVENTS_PLAN.md` remains the requirements and failure-mode
record but is superseded as an implementation plan. Do not hand-build its event
journal, inbox, or workflow engine before evaluating the corresponding CAO
service and contributing only the missing behavior.
