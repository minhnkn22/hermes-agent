# Atum liquid-glass dogfood assembly — 2026-08-12

Assembled the Opus-designed Atum shell and the K3 product-state/icon lane in
`feat/atum-desktop`, packaged the bundled Hermes/Python runtime, and installed
the app to `/Applications/Atum.app` with the previous app preserved as
`/Applications/Atum.app.pre-liquid-glass-20260812-2030`.

## Production-only renderer correction

The first installed package launched the native process and bundled engine but
rendered a black window. `hermes-home/logs/desktop.log` proved the packaged
renderer threw `ReferenceError: __reExport$1 is not defined` before React
mounted. The generated production bundle contained one call and no declaration;
source typecheck and UI tests could not exercise that minified artifact.

`vite.config.ts` now disables renderer minification and preserves Shiki's
native chunk boundaries instead of forcing one Rolldown chunk. Tree-shaking,
Electron main/preload bundling, and the full Hermes runtime remain enabled.
This is an explicit dogfood reliability tradeoff until the Rolldown/Shiki
single-chunk helper-elision defect is fixed upstream.

The old ad-hoc app's encrypted account session also blocked in macOS Keychain
after the code identity changed. It was moved—not deleted—to
`~/Library/Application Support/Atum/atum-messaging/session.pre-liquid-glass-20260812.json`.
The replacement app will create a fresh encrypted session after login.

## Verification checkpoint

- `npm run typecheck`: passed.
- `npm run test:ui`: 2,213 passed, one existing skip.
- `ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms`: 803 passed, two
  existing skips; the flag only bypasses the machine-global docs hook in
  disposable Git fixtures.
- `npm run build`: passed before installation and reproduced the minifier-only
  runtime failure, motivating the bounded configuration correction above.
- `npm run builder -- --dir`: packaged a relocatable Python 3.11.13/Hermes
  runtime and regenerated the full-bleed ICNS. No Developer ID is installed,
  so this remains an unsigned, unnotarized personal dogfood build.

Final post-correction build/package/install and visual evidence are appended
after the rerun.
