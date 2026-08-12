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

The final packaged-app build, launch, visual inspection, full suite, and
bundled-runtime tool proof are recorded after those commands complete.

Checkpoint results before the source commit:

- desktop typecheck: passed;
- focused branding test: 3/3 passed;
- focused locale/theme/onboarding set: 48/48 passed;
- full Vitest desktop suite: 309 files passed, 1 intentionally skipped;
  2,766 tests passed, 3 intentionally skipped;
- initial packaging rehearsal produced `Atum.app` with Python 3.11.13 and the
  bundled Hermes tree. Because that rehearsal preceded this source commit, its
  install stamp correctly said `DIRTY`; it is not the final packaged evidence.

## Distribution boundary

This private dogfood build is ad-hoc signed. A public downloadable build still
needs Apple Developer ID signing and notarization; that credential is not a
prerequisite for local testing on the build Mac.
