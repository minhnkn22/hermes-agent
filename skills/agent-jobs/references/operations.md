# Agent Job Operations

## Guarded Review CLI

The MCP tools and this CLI call the same safety core.

```bash
python3 scripts/review.py submit \
  --provider claude \
  --model opus \
  --workdir /absolute/project \
  --instructions "Review this architecture using the planning rubric." \
  --expected-output "Severity-ordered findings and a verdict." \
  --timeout-seconds 1800 \
  --idempotency-key session-checkpoint-claude
```

For code review, add `--context-git-diff --context-git-base <base-ref>`.

```bash
python3 scripts/review.py read JOB_ID --cursor 0 --wait-seconds 30
python3 scripts/review.py list --status running
python3 scripts/review.py cancel JOB_ID
```

Preserve the returned cursor and pass it to the next read. A job survives the
calling session, MCP process, or app. Recover unknown IDs with `list` and filter by
the owner prefix used at submission.

Statuses:

- `queued`: waiting for provider capacity.
- `launching`: atomically claimed; process identity is being recorded.
- `running`: active and producing output within the soft-stall window.
- `possibly_stalled`: active but quiet; not terminal.
- `completed`, `failed`, `cancelled`, `interrupted`: terminal.

## Explicit Implementation CLI

```bash
python3 scripts/delegate.py \
  --provider claude \
  --model opus \
  --mode implement \
  --workdir /absolute/project \
  --prompt "Implement only the scoped change. Do not commit or push."
```

The script prints `AGENT_JOB_ID` before polling. If the shell exits, recover the
job through the guarded review CLI's `list`/`read` operations or the low-level
`agent_job_client.py`.
