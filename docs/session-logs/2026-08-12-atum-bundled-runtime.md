# 2026-08-12 — Atum bundled macOS runtime

## Objective

Make the stock Hermes Desktop backend available on a clean macOS machine from
inside the packaged application, without depending on the user's Python,
Homebrew, `uv`, or a mutable first-launch clone.

## Change

- Added a macOS package-stage builder for relocatable CPython 3.11.13, the
  `uv.lock` `all` dependency profile, and an exact `git archive` of Hermes.
- Added a runtime manifest containing the source commit/tree and lock digest.
- Added the bundled payload as a validated resolver rung before existing
  installed/bootstrap candidates.
- Kept source/dev overrides and all pre-existing recovery fallbacks.
- Redirected lazy optional dependencies to Hermes' existing durable writable
  target under `HERMES_HOME` so the application bundle remains immutable.
- Documented packaging, precedence, verification, and Apple-signing limits.

## Verification performed

Run from the repository root unless otherwise stated:

All commands below passed on the arm64 macOS host:

```bash
cd apps/desktop && npx vitest run electron/bundled-runtime.test.ts scripts/stage-bundled-runtime.test.mjs
# 2 files, 8 tests passed

cd apps/desktop && npm run typecheck
cd apps/desktop && npm run build
cd apps/desktop && npm run runtime:stage

cd apps/desktop && ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms
# 63 files passed, 1 skipped; 705 tests passed, 2 skipped
```

The first platform-suite run without `ALLOW_NO_DOCS_LOG=1` reproduced the
known repository-global commit-hook interference in
`electron/git-review-ops.test.ts` (62 files and 704 tests passed before that
single failure). The bypassed rerun proves the product suite rather than hiding
a runtime regression.

The staged runtime was renamed to a different absolute directory, then its own
interpreter successfully imported Hermes and exposed both `--version` and
`serve --help`. This exercises relocation, native wheels, locked dependencies,
and the actual CLI entry seam together.

The packaged audit also passed:

```bash
cd apps/desktop && npm run pack
release/mac-arm64/Hermes.app/Contents/Resources/runtime/python/bin/python3.11 \
  -c 'import yaml, dotenv, hermes_cli.config; print("runtime ok")'
```

The generated app is 789 MB unpacked, including a 483 MB full-power runtime.
Its manifest pinned CPython 3.11.13, Hermes `6c5a1009fd8e` / tree
`f5c971b7bb54`, and `uv.lock` SHA-256
`93099ac9ab0837d908877299c9cbe1f380dc2d4865171fefd44dacdcc83d4ce7`.
Packaging skipped Developer ID signing and notarization because this host has no
valid Apple signing identity; the local app is ad-hoc/linker signed only.
