---
name: review-sidecars
description: Deprecated compatibility entry for cross-agent review. Use the agent-jobs skill, which owns routing and drives the generic durable job harness.
---

# Review Sidecars (Deprecated)

Use `$agent-jobs`. Do not register or restore the old `review-sidecars` MCP. The
legacy implementation remains in the repository only for rollback and recovery
of sessions that loaded its tool schema before migration.
