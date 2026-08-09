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

## Multi-Machine Boundary

The current Unix socket, SQLite database, processes, credentials, workdirs, and
logs are local to one Mac. Run one supervisor per execution host. GitHub remains
the source of truth between hosts. A future cross-machine control plane should
route a job to a host that owns the relevant checkout rather than expose this
user-only Unix socket over the network.
