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

The corrected split renderer launched without a console exception, but
Electron 40 did not emit `ready-to-show`; the healthy renderer and backend
remained hidden. `createWindow()` now retains the preferred first-paint event
and adds a 1.5-second reveal fallback, so a successful dogfood launch cannot
become an invisible app. The timer remains referenced: Electron's native GUI
loop does not by itself keep an unreferenced Node timer scheduled. It is
created after `loadURL()` is scheduled so synchronous renderer initialization
cannot starve it before navigation begins.

The old ad-hoc app's encrypted account session also blocked in macOS Keychain
after the code identity changed. It was moved—not deleted—to
`~/Library/Application Support/Atum/atum-messaging/session.pre-liquid-glass-20260812.json`.
The replacement app will create a fresh encrypted session after login.

The first clean account surface painted English during the asynchronous engine
config load. Atum now passes `initialLocale="vi"` into the root provider, so
the first visible paint is Vietnamese; an explicit saved language preference
can still replace it after config loads.

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

## Packaged visual correction checkpoint

The first visible Vietnamese package exposed three production-design defects
that component tests could not show:

- `ContribWiring` still mounted the legacy fixed Hermes titlebar controls over
  the Atum shell. The Atum product branch now keeps all contribution wiring but
  omits only that legacy visual cluster; the existing fallback flag still
  restores the complete Hermes chrome.
- Programmatic screen-reader focus drew the global interactive focus ring around
  the non-interactive auth heading. The auth heading now retains semantic focus
  without an interactive outline.
- The full-bleed opaque ICNS correction removed the prior nested white tile but
  made Dock render a hard black square. `icon-mac.svg` now uses one 832px
  Apple-style rounded tile on a transparent 1024px canvas. Generated PNG and
  ICNS bytes remain content-correspondent; tests assert transparent corners,
  an opaque centre, and the declared optical edge.

The Atum plates now use translucent warm surfaces over the existing native
macOS vibrancy, with bounded blur/saturation. This changes presentation only;
Hermes plugins, providers, skills, browser/computer tools, contributions, and
the isolated Atum engine remain intact.

Targeted packaged-app design review: Opus job
`d5aa8329-896f-49ed-b6cf-c9494115e6ad`. The machine restarted before the job
could emit its final message, so the supervisor records `supervisor_shutdown`,
but its retained 9,413-byte partial result was complete enough to give a
`DO NOT SHIP` verdict with concrete findings. P0 titlebar chrome and focus theft
were accepted. The P1 body-vibrancy, card elevation, mark contrast, form-token,
and text-contrast findings were also accepted. Password reveal/recovery/signup
remain explicitly deferred for the closed pre-provisioned dogfood cohort.

The follow-up changes let the password identifier field own initial focus,
focus the heading only when no editable credential path exists, clear the
document paint over the native NSVisualEffectView only while `.atum-shell` is
mounted, elevate the auth plate, map the roomy credential form to `--atum-*`
tokens, raise hint/legal copy to 12px high-contrast text, and render a thicker
light mark on the dark brand tile. The legacy Hermes fallback remains opaque.

Focused verification after these corrections:

- `npm run typecheck`: passed.
- `npx vitest run src/app/atum/auth-view.test.tsx src/app/atum/shell.test.tsx src/app/atum/design-contract.test.ts`:
  54 passed.
- `node --test scripts/atum-branding.test.mjs`: 5 passed.
- `npx vitest run scripts/generate-mac-icon.test.mjs`: 6 passed.
- `node scripts/generate-mac-icon.mjs --check`: passed.
- `git diff --check`: passed.

Post-review verification:

- `npm run typecheck`: passed.
- focused Atum UI: 56 passed.
- `npm run test:ui`: 262 files, 2,215 passed, one existing skip.
- targeted ESLint: zero errors after import/spacing correction.
- Kimi K3 assembly review job `9d83a51c-ab4a-4cbe-8df9-b231b4a349fa`
  submitted with no turn ceiling; result pending at this checkpoint.

The rounded-icon package was rebuilt from `d399158fb`, installed atomically at
`/Applications/Atum.app`, and opened successfully. The previous app remains
recoverable at `/Applications/Atum.app.pre-rounded-icon-20260812-2116`. The
installed ICNS SHA-256 matched the generated source exactly
(`e12b12b4674599b76fec245f34b5961c6ebf31520621982f55aa9b91784f82ac`).
After touching the bundle and restarting Dock, direct screen capture confirmed
the icon is a normal rounded tile with transparent corners and optical size
matching neighboring apps; it is neither the original nested white tile nor the
intermediate hard black square. The installed auth window also confirmed that
only the macOS traffic lights remain in the top rim.
