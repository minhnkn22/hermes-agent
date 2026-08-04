# Review Sidecar Workspace Access

The unified `review-sidecars` MCP server accepts review workdirs under common
project locations in the current user's home directory:

- `Documents`, `Desktop`, `Projects`, `Developer`, `Code`, `src`, `Workspace`,
  and `Workspaces`
- the installed Hermes repository at `.hermes/hermes-agent`, plus Codex,
  Hermes, and Atum worktrees under `.codex/worktrees`, `.hermes/worktrees`,
  and `.atum/worktrees`
- `/Users/Shared`

`REVIEW_SIDECARS_ALLOWED_ROOTS` adds site-specific or mounted project roots to
that list; it does not replace the defaults. Separate multiple roots with the
platform path separator (`:` on macOS/Linux).

The broader workdir policy does not change provider permissions. Kimi remains
restricted by the read-only reviewer agent file, Claude remains in plan mode
with a read-only tool allowlist, and secret-like context files are rejected or
redacted before they reach either provider.
