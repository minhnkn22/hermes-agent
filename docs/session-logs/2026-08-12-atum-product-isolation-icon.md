# Atum product-state isolation + macOS icon correction — 2026-08-12

Lane: Electron / packaging / icon (delegated implementation). Renderer UI,
i18n, `src/app`, styles, and the Atum messaging UI were deliberately NOT
touched — a parallel lane owns those.

Guidance: Kimi audit job `62906866-940e-4712-b24a-12d3def6dc6b` (summary
carried in the tasking message; the job store was not readable from this
environment, so the summary's findings were treated as the contract).

## Architecture

### Packaged engine home (`electron/hermes-home.ts`, new)

`resolveDesktopHermesHome()` now owns the full HERMES_HOME ladder as a pure,
DI-testable function (previously an inline `resolveHermesHome()` in
`main.ts`). `main.ts` calls it once; every downstream consumer
(`ACTIVE_HERMES_ROOT`, `VENV_ROOT`, `DESKTOP_LOG_PATH`, update markers,
bootstrap runner, backend spawn env pins) inherits the result unchanged.

Packaged precedence (first match wins):

1. **Managed test sandbox** (`HERMES_DESKTOP_USER_DATA_DIR` set): honors the
   sandbox-pinned `HERMES_HOME` when present (test:desktop:fresh and the e2e
   fixtures set both — byte-identical historical contract), else
   `<sandbox userData>/hermes-home`.
2. **`HERMES_DESKTOP_HERMES_HOME`** — new explicit product-scoped support
   override.
3. **`app.getPath('userData')/hermes-home`** — the new default.

Packaged builds **ignore inherited `HERMES_HOME` and the Windows registry
`HERMES_HOME`** — those are CLI-product inputs.

Development precedence is unchanged: `HERMES_HOME` → sandbox → Windows
registry → `%LOCALAPPDATA%\hermes` (with legacy `~/.hermes` preference) →
`~/.hermes`.

Effect: packaged sessions, profiles, memory, cron, plugins, skills state,
logs (`desktop.log` moves with the home), caches, runtime installs
(`hermes-agent/`, `node/`, `desktop-runtime/lazy-packages`), update markers
(`.hermes-update-in-progress`), and any bootstrap-installed source checkout
all live under the Atum home, never the CLI home. The full bundled runtime
and all engine capabilities are preserved — only the _state root_ moved.

### Shared credential plane (the one intentional exception)

`hermes_cli/auth.py::_codex_shared_auth_dir()` defaults to
`get_default_hermes_root()/shared`, which follows `HERMES_HOME`. Un-pinned,
re-homing would fork the Codex/Nous subscription store and duplicate
single-use refresh tokens. `resolveSharedAuthDirEnv()` pins
`HERMES_SHARED_AUTH_DIR` to the **platform-native CLI shared dir**
(`~/.hermes/shared`; `%LOCALAPPDATA%\hermes\shared` on Windows, falling back
to a legacy `~\.hermes\shared` when that exists) and `main.ts` spreads it
into both local backend spawn sites (primary + profile pool), after
`process.env` and the `HERMES_HOME` pin. Both products then serialize refresh
of the same credential through the existing cross-process file lock.

The pin is a no-op (returns `{}`) in dev, in managed sandboxes (hermetic),
and when the user explicitly set `HERMES_SHARED_AUTH_DIR` /
`HERMES_CODEX_SHARED_AUTH_DIR`. `HERMES_CODEX_SHARED_AUTH_DIR` still wins
inside Python for a Codex-only override.

### Seed-once migration (`electron/hermes-home-seed.ts`, new)

Packaged first launch with an absent Atum home copies the minimum static
provider/setup files from the platform-native CLI home:

- **Copied (allowlist, enforced by construction):** `config.yaml`, `.env`,
  `auth.json`, `SOUL.md`, `skins/` when present.
- **Never copied:** sessions, profiles, memory, plugins, cron, cache, logs,
  `hermes-agent/`, `node/`, locks, `shared/` (refresh-token store).
- **Never moved/deleted/re-synced:** the source is strictly read; later edits
  on either side diverge by design.
- **Symlinked entries are skipped** so the Atum home can never alias back
  into the CLI home on write.
- **Honest atomicity:** entries copy into `<home>.seed-in-progress`, the
  marker (`.atum-home-seed.json`, names + timestamp only, never contents)
  is written into staging _before_ the atomic `rename`, so a present home
  implies a completed seed. Crash residue is cleaned and retried; a
  mid-seed race (target appears) cleans staging and stands down.
- Sandboxed runs never seed (`shouldSeedPackagedHome`). A failed seed logs a
  warning and boot continues.

### Uninstall / update scoping

- `desktop-uninstall.ts`: `allowedUninstallModes({isPackaged})` restricts
  packaged builds to `gui`. lite/full drive `hermes_cli.uninstall`, whose
  cleanup is **not** home-scoped (shell-rc PATH edits, Windows User-scoped
  `HERMES_HOME`/`HERMES_GIT_BASH_PATH` registry deletion, node symlinks,
  gateway service teardown) — from Atum that mutates CLI-product state, so
  those modes are disabled until the engine uninstaller is product-scoped.
  `runDesktopUninstall` refuses them server-side (`error: 'mode-disabled'`),
  and the uninstall summary gains `allowed_modes` (additive; renderer
  untouched). The `gui` cleanup script exports the resolved (Atum)
  `HERMES_HOME`, so Python-side data removal is Atum-scoped.
- `engine-update-scope.ts` (new): `planEngineUpdate()` — the POSIX in-app
  update no longer falls back to a PATH `hermes` in packaged builds (that
  binary belongs to the CLI; `hermes update` through it would fetch/mutate
  `~/.hermes/hermes-agent`). A venv shim inside the update root (real
  checkout in the Atum home, or a `HERMES_DESKTOP_HERMES_ROOT` dev pin) is
  still used. Otherwise the plan is `app-managed` and both update entry
  points return the renderer's closeable `guiSkew` terminal state with
  "engine updates ship inside the app" copy. The bundled runtime itself is
  immutable inside the signed app and never fetches.
- Windows staged-updater recovery is unchanged: the staged binary is probed
  inside the (now Atum) home and simply won't be found cross-product.

## Shared vs isolated matrix (packaged Atum)

| State                                                      | Location                                                                 | Shared with CLI?      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| Sessions, FTS DB                                           | `<userData>/hermes-home/sessions`                                        | No                    |
| Profiles                                                   | `<userData>/hermes-home/profiles`                                        | No                    |
| Memory providers                                           | `<userData>/hermes-home/…`                                               | No                    |
| Cron jobs                                                  | `<userData>/hermes-home/cron`                                            | No                    |
| Plugins / skills state                                     | `<userData>/hermes-home/plugins`, `skills`                               | No                    |
| Logs (`desktop.log`, `agent.log`, …)                       | `<userData>/hermes-home/logs`                                            | No                    |
| Caches                                                     | `<userData>/hermes-home/…`                                               | No                    |
| Runtime installs (`hermes-agent/`, `node/`, lazy packages) | `<userData>/hermes-home/…`                                               | No                    |
| Update markers                                             | `<userData>/hermes-home/.hermes-update-in-progress`                      | No                    |
| Bootstrap-installed source checkout                        | `<userData>/hermes-home/hermes-agent`                                    | No                    |
| Desktop shell state (connection.json, window state, …)     | `<userData>/` (unchanged)                                                | No                    |
| **Codex/Nous subscription credentials + refresh lock**     | `~/.hermes/shared` (native CLI shared dir, via `HERMES_SHARED_AUTH_DIR`) | **Yes — intentional** |
| SSH ControlMaster sockets                                  | `~/.hermes/desktop-ssh` (ephemeral, 0700, no durable state)              | Yes — see limitations |

## macOS icon correction

Local inspection showed the packaged icns matched the checked-in icns — the
defect was the artwork itself: a transparent 1024 canvas with an 824px inset
body, which current macOS presents inside an extra legacy white container
tile (Launchpad evidence).

- `assets/icon-mac.svg` is now a **full-bleed opaque 1024 canvas**: a dark
  radial-gradient background rect covering the whole canvas (no transparent
  corners, no inset body), with the Atum orbit mark at 672px (~66%),
  preserving the existing palette (`#141311` family + `#EFEEEA`).
- `scripts/mac-icon.mjs` (new): dependency-free PNG decoder (8-bit,
  non-interlaced, color types 0/2/4/6 → RGBA) + ICNS container parser +
  canonical iconset table, shared by the generator and the branding test.
- `scripts/generate-mac-icon.mjs` (new): deterministic regeneration —
  `rsvg-convert` (or `sips`) renders the 1024 master → `icon-mac.png`;
  `sips -z` resamples the iconset; `iconutil -c icns` emits
  `icon-mac.icns`. The `512@2x` member is the un-resampled master, so the
  icns 1024 entry and `icon-mac.png` are pixel-identical by construction.
  `--check` exits 1 when assets are stale. Refuses early with a clear
  message off macOS.
- `scripts/atum-branding.test.mjs`: the size-only icon assertion is replaced
  with **content correspondence** — the icns must parse, contain an `ic10`
  entry, decode to exactly `icon-mac.png`'s pixels at 1024×1024, and be
  fully opaque. The SVG is asserted full-bleed (`<rect width="1024"
height="1024"`, no `x="100" y="100"` inset).
- `scripts/before-pack.mjs`: darwin packs regenerate stale assets via
  `ensureMacIconsFresh()`; toolchain absence warns and keeps the checked-in
  assets. win32/linux packs never touch icon tooling.

## Verification

Codex regenerated the assets and ran the implementation on the macOS host:

1. `node scripts/generate-mac-icon.mjs && node scripts/generate-mac-icon.mjs --check`
   passed. Checked-in `icon-mac.png` and `icon-mac.icns` now contain the
   full-bleed artwork.
2. Focused Vitest (`hermes-home`, `hermes-home-seed`,
   `engine-update-scope`, `desktop-uninstall`, `generate-mac-icon`) passed
   **62/62**.
3. `node --test scripts/atum-branding.test.mjs` passed **5/5**, including
   exact 1024-pixel correspondence and full opacity.
4. `npm run typecheck` passed. Targeted ESLint over every changed Electron
   path passed. Repo-wide lint retains three pre-existing named-import order
   errors in unrelated renderer tests.
5. `ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms` passed **803/805**
   with the existing two skips. The environment flag only bypasses the
   machine-global docs hook inside disposable Git fixtures.
6. End-to-end acceptance remains: package, install, and confirm the
   Launchpad icon shows the full-bleed dark tile with no white container —
   the screenshot is the acceptance evidence — then confirm
   `~/Library/Application Support/Atum/hermes-home` holds the seeded
   config/sessions and `~/.hermes` is untouched except `shared/`.

Focused-test intent encoded in the suites:

- Packaged/dev/platform precedence for the home resolver, including
  inherited-`HERMES_HOME` and registry rejection and sandbox precedence.
- Only the credential directory is shared: resolver candidates are asserted
  to never live under the Atum home; the seed test asserts
  `shared/codex_auth.json` / `nous_auth.json` are never copied.
- Seed: source absent, target exists, nothing-to-seed, forbidden paths,
  symlink skipping, single-seed idempotency, crash-residue retry, mid-seed
  race, marker honesty.
- Uninstall: packaged refuses lite/full; dev keeps all modes.
- Update: packaged without its own checkout is app-managed and never uses a
  PATH CLI; packaged with an Atum-home checkout still updates in place
  (POSIX + Windows shim shapes).

## Limitations / follow-ups

- The generated icon binaries are checked in and verified; visual Launchpad
  acceptance still requires installing the assembled app.
- `apps/desktop/DESIGN.md` still describes the old "transparent canvas with
  inset body" icon note, and `apps/desktop/AGENTS.md` does not yet document
  the isolation contract — both were outside this lane's edit scope; update
  them when lanes merge.
- Windows CLI users with a **relocated** `HERMES_HOME` (neither
  `%LOCALAPPDATA%\hermes` nor legacy `~/.hermes`) won't have their shared
  credential dir auto-found; setting `HERMES_SHARED_AUTH_DIR` explicitly is
  the documented escape hatch.
- The local SSH mux socket dir (`~/.hermes/desktop-ssh`, POSIX) still lives
  under the CLI home. It holds only ephemeral 0700 ControlMaster sockets — no
  durable product state, no credentials — and moving it would change the
  remote-connection seam both products' dev flows share. Flagged, not moved.
- Packaged `gui` uninstall still requires an engine venv (absent under the
  bundled runtime), so it currently reports `agent-missing` rather than
  removing the bundle on bundled-runtime installs — pre-existing behavior,
  unchanged by this lane.
- The Python uninstaller's cross-product actions (shell rc, registry,
  services) were not edited (outside lane scope); lite/full stay disabled in
  packaged builds until that cleanup is product-scoped.
