# Agent Jobs Client Integration

The machine-wide agent-job supervisor is a local execution service. Coding
clients join it through the same read-only MCP server or the equivalent review
CLI, while target providers are launched through Claude, Codex, and Kimi CLIs.

## Install

Preview and apply native client configuration:

```bash
python3 tools/install_agent_job_clients.py
python3 tools/install_agent_job_clients.py --apply --backup-suffix YYYYMMDDTHHMMSSZ
python3 tools/install_agent_job_clients.py --check
```

The installer performs structured, idempotent merges and preserves unrelated
settings. Before changing an existing file it creates a sibling
`*.bak.agent-jobs-<suffix>` backup. It manages:

- the shared `~/.agents/skills/agent-jobs` link;
- Claude Desktop's `mcpServers.agent-jobs` registration;
- Kimi Code's user-level `~/.kimi-code/mcp.json` registration; and
- a marked agent-jobs guidance section in `~/.kimi-code/AGENTS.md`.

Restart Claude Desktop and start a new Kimi Code session after applying changes.
Existing sessions retain the tools and instructions loaded when they started.
The installer validates every target and backup slot before writing, and restores
all prior targets if an unexpected later write fails. `--check` exits nonzero
when configuration drift is pending.

To roll back manually, quit the affected client, replace its current config with
the corresponding `*.bak.agent-jobs-<suffix>` file, and restart the client.

## Support Matrix

| Client | Caller binding | Shared policy | Target adapter |
|---|---|---|---|
| Codex Desktop and CLI | MCP | `~/.agents/skills` plus global guidance | Codex CLI |
| Claude Code, including Desktop code sessions | Review CLI | Claude skill link and `CLAUDE.md` | Claude CLI |
| Claude Desktop chat | Local MCP | Tool schema; coding policy applies in Claude Code sessions | Claude CLI |
| Kimi Code | MCP | `~/.agents/skills` and Kimi `AGENTS.md` | Kimi CLI |
| Hermes profiles | MCP | Per-profile skill copies | Not a provider |

MCP intentionally exposes only submit, read, list, and cancel for read-only jobs.
Explicit implementation remains behind the local capability-protected delegation
CLI. This prevents a general chat client from selecting write mode directly.
Review prompts may contain up to 4 MiB of UTF-8 data. The supervisor's Unix
socket reader is sized for that complete JSON request, so prompts larger than the
former 400 KB ceiling are accepted end to end rather than only by one layer.

## CAO Compatibility Backend

The supervisor can preserve its existing four-tool contract while delegating
provider execution to CAO. This is an opt-in migration path; native execution
remains the default:

```bash
export AGENT_JOB_EXECUTION_BACKEND=cao
export AGENT_JOB_CAO_URL=http://127.0.0.1:9889
```

`cao_job_bridge.py` maps provider jobs to CAO sessions, forwards the requested
model and workspace, verifies CAO's actual working directory and persisted
read-only tool policy, emits status transitions, retries bounded transport
interruptions, returns the retained final result, and attempts synchronous CAO
session cleanup on every exit. Signal handlers interrupt blocking HTTP calls so
cleanup starts within the supervisor's termination grace. Provider credentials are not
forwarded to the bridge; CAO launches each native provider with its own local
authentication.

Optional settings are `AGENT_JOB_CAO_TOKEN` and
`AGENT_JOB_CAO_LAUNCH_TIMEOUT`; launch requests are capped at eight seconds so a
cancelled bridge retains time for cleanup before forced termination.
The supervisor's existing hard deadline, soft-stall state, owner binding,
idempotency, durable logs, cursor reads, cancellation, and retention continue to
apply outside CAO. The selected backend is persisted per job, so queued work
does not change transport when configuration changes.

CAO read-only execution is enabled only for Claude and Kimi, whose adapters
enforce native tool denial. Read-only Codex fails before launch because this CAO
fork currently launches Codex without an enforceable sandbox. A positive
`max_turns` also fails closed because CAO has no equivalent limit; the normal
unlimited value remains supported and bounded by the wall-clock deadline.

During the pilot, CAO emits status transitions and a retained final result, not
the provider's incremental token stream. A long quiet processing state can
therefore become `possibly_stalled` even while CAO is alive. The hard deadline
still bounds it. Recursion depth is not yet propagated into CAO-spawned provider
environments, and a create request that loses its response after CAO renames the
session can require the Phase 6 metadata reaper. Keep the backend opt-in until
those observation-window gaps are closed.

To roll back, stop submitting work, let running CAO jobs drain, remove
`AGENT_JOB_EXECUTION_BACKEND=cao`, and restart the supervisor. New jobs return
to native execution; already queued jobs retain their recorded backend.

## Multi-Machine Boundary

The current Unix socket, SQLite database, processes, credentials, workdirs, and
logs are local to one Mac. Run one supervisor per execution host. GitHub remains
the source of truth between hosts. A future cross-machine control plane should
route a job to a host that owns the relevant checkout rather than expose this
user-only Unix socket over the network.
