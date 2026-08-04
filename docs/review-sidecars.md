# Review Sidecar Workspace Access

The unified `review-sidecars` MCP server accepts any existing project directory
by default. This includes unusual home-directory layouts, temporary checkouts,
external volumes, sibling projects, and Codex/Hermes/Atum worktrees.

Targeted credential and private-data stores remain excluded, including `.ssh`,
cloud credential directories, keychains, Kimi data, Codex data, Hermes profiles,
and Atum data. Project exceptions inside those trees remain reviewable:
`.codex/worktrees`, `.hermes/hermes-agent`, `.hermes/worktrees`, and
`.atum/worktrees`.

`REVIEW_SIDECARS_ALLOWED_ROOTS` is an optional administrator lockdown. When it
is set, reviews are restricted to those roots; when it is unset, there is no
general project allowlist. Separate multiple roots with the platform path
separator (`:` on macOS/Linux).

The broader workdir policy does not change provider permissions. Kimi remains
restricted by the read-only reviewer agent file, Claude remains in plan mode
with a read-only tool allowlist, and secret-like context files are rejected or
redacted before they reach either provider.
