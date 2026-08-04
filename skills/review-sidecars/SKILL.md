---
name: review-sidecars
description: Route independent read-only reviews through the combined Kimi K3 and Claude Opus MCP sidecars. Use for code review, plan or architecture review, UI/UX and design work, visual QA, product judgment, and research synthesis when a second model can materially improve the result.
---

# Review Sidecars

Keep Codex/Hermes as the implementing and verifying agent. Use the sidecars for
read-only advice, then weigh their findings against the request, repository,
tests, and local evidence.

## Route the review

- For code review, call `review_code`. It tries Kimi K3 first and falls back to
  Claude Opus only on failure. The server supplies the current safe Git diff and
  reports the provider/model attempts in the result.
- For planning, architecture, UI/UX, design, visual QA, design systems, product
  judgment, or research synthesis, call `review_plan`. Leave the default mode as
  `planning` or pass one of `design`, `design_brief`,
  `ui_implementation_plan`, `visual_qa`, `design_system`, `product`, or
  `research`. It tries Claude Opus first and Kimi K3 on failure.
- Use `kimi_code_review`, `kimi_consult`, or the corresponding `claude_*` tools
  only when an explicit provider is required. Preserve the Kimi-first and
  Opus-first policy above for ordinary work.
- For work likely to exceed the synchronous timeout, use `kimi_start` or
  `claude_start`, then poll with `review_read` and cancel stale work with
  `review_cancel`. Async provider-specific jobs do not cross-provider fallback.

## Supply context safely

- Pass the exact project `workdir`.
- Prefer repository inspection and the server's bounded Git context. Add
  `context_files` or `context_text` only when needed.
- Never supply secrets, credentials, private keys, `.env` files, or unrelated
  private material. Treat filename/content redaction as defense in depth, not a
  substitute for judgment.

## Finish the task

Treat sidecar output as advice. Resolve findings yourself, make any authorized
changes, run the relevant verification, and own the final decision. Do not
switch the Hermes conversation into direct `/claude` mode merely to request a
review; that persistent conversation route is separate from these MCP tools.
