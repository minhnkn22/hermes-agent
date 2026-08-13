# Atum consumer desktop pass — 2026-08-13

## Goal

Make the local macOS dogfood app feel like Atum rather than a lightly themed
Hermes console: calmer Codex-like density and contrast, a normal account and
settings hierarchy, Finder-like files, first-party specialist identity, and a
short truthful model chooser. Preserve Hermes' full engine and advanced
surfaces behind deliberate disclosure.

## Design and product decisions

- Opus design consultation `360f63fe-dec7-4d8c-a072-1c2fa15c6491` identified
  four shared causes: wallpaper-dependent translucent planes, insufficient dark
  surface separation, inherited developer density, and incomplete product
  identity.
- The Atum root and transcript are now opaque. Internal plates retain blur,
  sheen, elevation and rounded geometry, but user wallpaper can no longer become
  recognizable transcript content.
- Transcript typography is 14px/22px inside Atum only. Consumer text scaling is
  bounded to 90/100/110% because Electron zoom does not move native macOS
  traffic lights; the full Hermes controls remain under Advanced.
- The rail account control represents the signed-in person, not the Atum brand.
  The account dialog shows only identity fields the native contract actually
  owns. Email, phone and editing are explicitly unavailable until a hosted
  profile-write contract exists; there is no fake save button.
- Everyday settings are language, appearance and text size. Every existing
  Hermes settings view and deep link remains reachable below `Nâng cao`.
- The Atum file workspace defaults to a Finder-like grid with a list switch,
  navigation and honest error states. Dot entries are hidden at the Electron
  boundary. Hermes' internal `.gitignore` handling probes that metadata file
  directly so consumer hiding does not break ignore semantics.
- Moon, Andy and Taylor reuse the exact approved Atum assets. Ben keeps the
  honest `B` fallback because no approved Ben asset exists. Official gold
  verification comes only from the curated Atum catalog, never from untyped
  conversation payload.
- The composer model trigger displays the model resolved for that surface. The
  compact Atum menu shows at most five choices plus effort/speed state and an
  advanced escape. A draft-only `Dùng mặc định` action clears a sticky manual
  selection. The observed Opus 4.6 label was not hard-coded UI: both the CLI and
  isolated packaged Atum config currently set it as the real default.

## Verification checkpoint

Run from `apps/desktop`:

- `npm run typecheck` — pass.
- focused Atum/DM/settings/files/model/Electron-FS suite — 40 files, 408 tests,
  all pass.
- `npm run test:ui` — 269 files, 2,270 pass, 1 existing skip. jsdom emitted its
  known canvas warning; no test failed.
- `ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms` — 74 files pass, 1 skipped;
  804 tests pass, 2 skipped. The environment flag only bypasses the temporary
  git-fixture session-log hook.
- `npm run build` — pass. The pre-commit build stamp correctly warns the tree is
  dirty; the distributable package will be built only after the exact source
  commit exists.

Kimi assembly review `69fa79e3-3b70-4755-a165-d7c8eb82aefe` returned **SHIP
WITH FIXES**. All eight findings were accepted before commit:

- dot entries are hidden only in Atum's consumer browser; the shared Electron
  listing and the legacy Hermes developer tree retain dotfiles and their
  listing-based `.gitignore` probe;
- verification, model, speed, default, advanced, account/settings, and file
  error copy is present in all five desktop locales;
- this design contract now names the consumer file browser and new tokens;
- verification is documented as a static curated first-party presentation,
  not a live hosted trust signal;
- signed-out users get the generic account glyph rather than an invented `A`;
- compact effort/speed rows no longer imply nonexistent submenus and default
  restore cannot pair a resolved model with an unrelated provider;
- file-preview failure keeps the valid folder listing visible; and
- consumer text-size output displays the same bounded value as its slider.

Post-review focused verification: desktop typecheck passed; 13 UI files / 146
tests passed; Electron filesystem 11 passed / 1 platform skip. Final broad
suite: 269 UI files / 2,273 passed / 1 existing skip; Electron 74 files passed /
1 skipped and 803 tests passed / 2 skipped. The known jsdom canvas warning and
the temporary Git-fixture `ALLOW_NO_DOCS_LOG=1` bypass did not represent product
failures. Exact-source package, install, and visual evidence are recorded below.

The first packaged screenshot exposed a boundary the jsdom tests cannot model:
absolute `/specialists/*` URLs resolve against the filesystem root under
Electron's `file://` renderer and produced broken images even though the assets
were present. The catalog now uses package-relative `./specialists/*` URLs; the
package was rebuilt from the follow-up commit and visually rechecked.

## Packaged dogfood evidence

- Exact packaged source: `40674eaa67a9` on `feat/atum-desktop`.
- `npm run pack` staged the pinned relocatable Python 3.11.13 and Hermes source,
  produced the arm64 application bundle, and passed `ATUM_BUNDLED_BOOT_OK`.
- The bundle is ad-hoc signed for owner dogfood. `codesign --verify --deep
  --strict` passed; Developer ID signing and notarization remain distribution
  work, not claims of this checkpoint.
- The prior installation was retained as
  `/Applications/Atum.app.pre-assetfix-e2e693b8c-20260813-101136`; the new app
  was installed at `/Applications/Atum.app` without replacing Application
  Support or Keychain state.
- Packaged light-mode inspection confirmed the thin native title bar, one
  consumer rail, search-first roster, separate Atum assistant, curated app
  order and assets, gold badges, opaque transcript, rounded composer, and
  Finder-style grid/list workspace with dot entries absent.
- Packaged dark-mode inspection confirmed distinct near-black root, rail,
  transcript, composer and workspace planes with 14px/22px conversation type.
  Settings exposed only language, appearance and bounded text size before the
  explicit `Nâng cao` surface.

## Live Codex subscription proof

The packaged app's isolated profile was still truthfully exposing its old
`anthropic/claude-opus-4.6` default. For dogfood it was migrated through
Hermes' supported runtime switch, not relabelled in the renderer:

- model `gpt-5.3-codex-spark`;
- provider `openai-codex`;
- `model.openai_runtime: codex_app_server`;
- existing `codex login status` returned `Logged in using ChatGPT`; and
- Codex CLI 0.144.6 passed the runtime's minimum-version check.

After a full Atum restart, the composer displayed the resolved
`GPT-5.3-codex-spark` label. A real Assistant turn, `Reply with exactly: ATUM
OK`, returned `ATUM OK`. `agent.log` independently recorded provider
`openai-codex`, model `gpt-5.3-codex-spark`, and a new `codex app-server`
thread. This proves the installed Atum → bundled Hermes → Codex app-server →
ChatGPT subscription path. A title-generation auxiliary request failed after
the successful primary turn; it did not affect the user response and remains a
bounded upstream/helper follow-up.

## Follow-ups deliberately not faked in this pass

- Profile email/phone editing needs a hosted account projection and write API,
  then a narrow token-free Electron IPC.
- A real Ben brand asset must come from Ben/the approved Atum app catalog.
- Google authentication still requires enabling an Atum-owned Google OAuth
  client in the dedicated Atum Supabase project and repackaging with the public
  provider flag.
- The packaged backend reports some optional Hermes tools unavailable when
  their external dependencies are absent (browser dialog, computer-use,
  image-generation and web API checks). The core Codex Assistant and local
  Finder workspace path are proven; those optional capability prerequisites
  should be exercised as their next vertical slices.
