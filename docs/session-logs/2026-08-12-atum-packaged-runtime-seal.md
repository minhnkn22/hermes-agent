# Packaged runtime seal after first launch — 2026-08-12

## Problem

The exact-head Atum dogfood package launched and successfully used the bundled Hermes runtime, but a second deep `codesign --verify` found that CPython had refreshed two staged standard-library bytecode files inside `Atum.app`. The app remained runnable, but those writes invalidated the local ad-hoc resource seal.

## Resolution

`stage-bundled-runtime.mjs` now removes `__pycache__`, `.pyc`, and `.pyo` artifacts from the staged Python payload before its executable probe and before electron-builder signs the bundle. Desktop-managed Python processes already receive `PYTHONDONTWRITEBYTECODE=1`; shipping the source modules without staging-prefix bytecode prevents relocation-triggered cache refreshes and keeps the installed application bundle immutable during dogfood use.

The staging probe also explicitly sets `PYTHONDONTWRITEBYTECODE=1`; otherwise the probe itself would recreate a small cache after cleanup.

The package remains ad-hoc signed for local dogfood. Developer ID signing and notarization are distribution work, not part of this local seal correction.

## Verification

- Focused staging tests cover bytecode-cache removal and preservation of Python sources.
- The packaged payload contains no `__pycache__`, `.pyc`, or `.pyo` paths.
- The staged runtime import probe and packaged Hermes runtime still start successfully.
- The final installed app is deep ad-hoc signed, launched, performs a Hermes terminal action, and passes `codesign --verify --deep --strict` after that runtime use.
