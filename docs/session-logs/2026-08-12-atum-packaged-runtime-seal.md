# Packaged runtime seal after first launch — 2026-08-12

## Problem

The exact-head Atum dogfood package launched and successfully used the bundled Hermes runtime, but a second deep `codesign --verify` found that CPython had refreshed two staged standard-library bytecode files inside `Atum.app`. The app remained runnable, but those writes invalidated the local ad-hoc resource seal.

## Resolution

`stage-bundled-runtime.mjs` now removes uv's timestamp/staging-prefix bytecode, runs its executable probe cache-free, then explicitly compiles the final payload with Python's relocation-safe `unchecked-hash` invalidation mode before electron-builder signs the bundle. Desktop-managed Python processes still receive `PYTHONDONTWRITEBYTECODE=1`, while helper processes that sanitize inherited environment consume the sealed hash caches instead of writing timestamp caches into `Atum.app`.

The staging probe also explicitly sets `PYTHONDONTWRITEBYTECODE=1`; otherwise the probe itself would recreate a small cache after cleanup.

The packaged interpreter is additionally launched with Python's `-B` flag, including the staging probe. This makes the cache prohibition an explicit interpreter argument even when the app is launched through Finder/Electron, rather than depending solely on inherited environment handling.

The package remains ad-hoc signed for local dogfood. Developer ID signing and notarization are distribution work, not part of this local seal correction.

## Verification

- Focused staging tests cover bytecode-cache removal and preservation of Python sources.
- The packaged payload contains only final unchecked-hash bytecode caches; the executable test asserts the PEP 552 flags word is `1`.
- The staged runtime import probe and packaged Hermes runtime still start successfully.
- The final installed app is deep ad-hoc signed, launched, performs a Hermes terminal action, and passes `codesign --verify --deep --strict` after that runtime use.
