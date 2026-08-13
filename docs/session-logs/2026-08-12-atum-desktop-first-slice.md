# Atum Desktop first usable slice — 2026-08-12

## Outcome

The existing Hermes Desktop shell is now packaged as Atum without replacing
its navigation or capability surfaces. It keeps the single Hermes rail and the
full plugin, skill, model-provider, browser, computer, files, terminal, cron,
and gateway architecture. The independently completed bundled-runtime change
was integrated before packaging so the macOS application can start its pinned
Hermes backend without a preinstalled checkout.

## Product and design decisions

- Packaged identity: `Atum`, bundle id `com.atum.desktop`; internal `hermes`
  package/config/IPC/protocol identifiers remain unchanged for compatibility.
- Fresh profiles use Vietnamese and the named `atum` warm monochrome theme.
  Vietnamese is intentionally a high-traffic partial catalog with complete
  English fallback rather than an unreviewed bulk translation.
- The one existing Hermes navigation rail remains the only rail. Files,
  browser, terminal, review, preview, and computer actions stay contextual.
- The onboarding support line is exactly:
  `Điều khiển mọi tác vụ trên máy tính, sử dụng app yêu thích, nhắn tin cho bạn bè - tất cả cùng một nơi.`
- The macOS icon uses a transparent 1024 px canvas and an 824 px inset body,
  addressing the earlier oversized Dock appearance.

These UI/UX/copy choices implement the bounded Opus review job
`ad572f48-8359-4b2b-b9d9-fac76937d0db`.

## Verification

Run from `apps/desktop` unless stated otherwise:

```bash
npm run typecheck
node --test scripts/atum-branding.test.mjs
ALLOW_NO_DOCS_LOG=1 npx vitest run \
  src/i18n/languages.test.ts src/i18n/runtime.test.ts \
  src/i18n/context.test.tsx src/themes/presets.test.ts \
  src/themes/user-themes.test.ts src/components/onboarding/index.test.tsx
```

The source checkpoint was independently reviewed by Kimi job
`7cd092b6-2abe-44aa-b3e6-a1f457f3b4ad`, which returned `DO NOT SHIP` for a
real lifecycle regression: the renamed `Atum.app` was invisible to several
Hermes launcher/install/update resolvers. The follow-up corrects those paths
while retaining legacy Hermes fallbacks, adds an Atum-shaped CLI regression,
and makes the bootstrap installer derive product/executable names from the
desktop package manifest.

The same follow-up:

- rejects tracked-dirty runtime packages unless an explicit development-only
  override is set, preventing a worktree renderer from being paired with an
  older archived backend;
- audits the bundled runtime and exact source commit as part of the desktop
  package validation;
- adds a real non-faked packaged-app boot verifier using an isolated
  `HERMES_HOME` and user-data directory;
- completes native Atum names for window, notification, Windows shortcut,
  uninstall, and AppUserModelID fallbacks;
- synchronizes the document language with the selected locale and makes the
  localized Atum introduction catalog authoritative for every locale.

Checkpoint results before the source commit:

- desktop typecheck: passed;
- focused branding test: 3/3 passed;
- focused locale/theme/onboarding set: 48/48 passed;
- full Vitest desktop suite: 309 files passed, 1 intentionally skipped;
  2,766 tests passed, 3 intentionally skipped;
- initial packaging rehearsal produced `Atum.app` with Python 3.11.13 and the
  bundled Hermes tree. Because that rehearsal preceded this source commit, its
  install stamp correctly said `DIRTY`; it is not the final packaged evidence.

Final clean-commit packaging, the package audit, isolated bundled-backend boot,
and targeted reviewer follow-up are recorded in the next checkpoint after the
review fixes are committed, because the clean-source packaging guard is
deliberately impossible to satisfy from an uncommitted worktree.

The targeted Kimi follow-up
`36e7ef57-f287-4eb6-83ad-d90948de5cd4` exhausted its provider quota after
reading the relevant paths but before producing a verdict. The permitted
provider-failure fallback, Opus job
`b7c08d3f-8376-45ff-aaf5-e37551788d1b`, returned `SHIP WITH FIXES`: all three
macOS dogfood blockers were resolved, but `scripts/install.ps1` still assumed
the Windows binary was named `Hermes.exe`. That remaining lifecycle path now
derives `productName` and `executableName` from the package manifest, retains
the legacy Hermes executable fallback, and creates branded shortcuts. The
packaged GUI uninstaller and Electron self-uninstall path now also recognize
Atum locations while retaining legacy Hermes cleanup.

Focused verification after the fallback review:

```text
Atum branding/lifecycle Node tests: 4/4
Electron desktop-uninstall tests: 19/19
Python GUI command/uninstall + PowerShell ASCII tests: 81/81
git diff --check: clean
```

The Rust bootstrap installer remains inspection-only on this host because
`cargo` and `rustc` are absent. The real bundled-app verifier is deliberately
macOS-only and currently an explicit package gate rather than part of the
ordinary source-test command.

## Distribution boundary

This private dogfood build is ad-hoc signed. A public downloadable build still
needs Apple Developer ID signing and notarization; that credential is not a
prerequisite for local testing on the build Mac.
