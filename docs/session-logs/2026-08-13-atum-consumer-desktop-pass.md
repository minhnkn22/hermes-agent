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

## Follow-ups deliberately not faked in this pass

- Profile email/phone editing needs a hosted account projection and write API,
  then a narrow token-free Electron IPC.
- A real Ben brand asset must come from Ben/the approved Atum app catalog.
- Google authentication still requires enabling an Atum-owned Google OAuth
  client in the dedicated Atum Supabase project and repackaging with the public
  provider flag.
- After review, commit/push, build the exact clean commit, retain the previous
  `/Applications/Atum.app`, install the new bundle without touching Application
  Support or Keychain, and run the packaged visual checklist in light and dark.
