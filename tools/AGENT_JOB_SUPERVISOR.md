# Agent Job Supervisor

The agent job supervisor owns long-running Claude Code, Codex, and Kimi Code CLI
processes independently of the Codex, Claude, or Hermes session that submitted
them. It replaces caller-bound subprocess waits with durable job IDs.

## Lifecycle

1. A caller submits `provider`, `model`, `mode`, `workdir`, `prompt`, an
   idempotency key, and a submit-relative hard deadline over the user-only Unix
   socket.
2. The daemon validates the workdir, model, prompt size, recursion depth, and
   provider, then persists a queued job in SQLite before returning its ID.
3. A machine-wide provider queue atomically claims the job as `launching`, then
   launches it once in a new process group.
4. Output is appended to a cursor log and to separate raw stdout/stderr files.
5. `read` reports status, new output, silence duration, and terminal output.
6. Cancellation sends `SIGTERM` to the process group, waits ten seconds, then
   sends `SIGKILL` if necessary.
7. On daemon restart, previously running jobs are marked `interrupted`. A process
   group is terminated only when PID, PGID, process start time, and resolved
   executable all exactly match the recorded identity.

Silence does not automatically kill a job. After the configured soft-stall
threshold, status is reported as `possibly_stalled`; only cancellation or the
submit-relative hard deadline terminates it. Time spent queued counts against
that deadline.

## Installation

```bash
/Users/nmmacmini/.hermes/hermes-agent/venv/bin/python \
  tools/install_agent_job_supervisor.py install
python3 tools/agent_job_client.py ping
```

The LaunchAgent label is `com.atum.agent-job-supervisor`. Runtime state is kept
under `~/.local/state/agent-job-supervisor` with user-only permissions.

## Operations

```bash
python3 tools/agent_job_client.py list
python3 tools/agent_job_client.py read JOB_ID --cursor 0
python3 tools/agent_job_client.py cancel JOB_ID
python3 tools/install_agent_job_supervisor.py status
```

Provider concurrency defaults to Claude 2, Codex 2, and Kimi 1. Override with
`AGENT_JOB_<PROVIDER>_CONCURRENCY` in the LaunchAgent environment. Approved
workspace roots default to `~/Documents` and `/Users/Shared`.

Durable `implement` mode requires both the installed service policy and a random
capability stored in `~/.local/state/agent-job-supervisor/implement.token` with
mode `0600`. The installer enables this policy for the scoped delegation client;
the token prevents accidental or malformed write submissions but is not a
privilege boundary against other processes running as the same macOS user.
The daemon scopes provider API credentials at process launch from its environment
or `AGENT_JOB_PROFILE_ENV`; it never stores credential values in SQLite.

## Failure Semantics

- `queued`: persisted and waiting for a provider slot.
- `launching`: atomically claimed by the scheduler; provider identity is being
  recorded before the job becomes `running`.
- `running`: owned by the daemon and below the soft-stall threshold.
- `possibly_stalled`: process is alive but has emitted no output past the soft
  threshold. This is diagnostic, not terminal.
- `completed`: provider exited zero.
- `failed`: launch error, provider non-zero exit, or hard deadline.
- `cancelled`: caller requested cancellation.
- `interrupted`: the supervisor stopped or restarted during execution.

The SQLite database contains prompts only while jobs are queued; prompts are
cleared after provider launch and on every terminal path. Paths and hashes remain
for operations and idempotency. Its directory and files are mode `0700`/`0600`.
Never submit secrets, `.env` contents, credentials, or unrelated private data.
Implementation agents cannot run Bash, tests, or Git; the calling agent remains
responsible for inspecting the diff and running verification.
Combined and raw per-job logs share a total 10 MiB budget, and terminal jobs and
logs are retained for 14 days by default. `AGENT_JOB_MAX_LOG_BYTES` and
`AGENT_JOB_RETENTION_SECONDS` override those limits. A state-directory lock
prevents a second daemon from competing for the same queue.

## Verification

```bash
python3 -m unittest discover -s tools/tests -v
python3 -m py_compile tools/agent_job_*.py tools/review_sidecars_server.py
```
