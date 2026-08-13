# 2026-08-13 — Atum titlebar and shared conversation surfaces

Branch: `feat/atum-desktop`
Base: `217fc3ce7495`
Scope: desktop renderer, design contract, and tests only. No hosted mutation,
credential change, account reset, Electron auth/runtime change, or installed-app
mutation was performed while developing this patch.

## Why

Founder dogfood exposed four related presentation failures:

1. the 44px Atum rim and a second 44px conversation header stacked into a
   non-native title area;
2. specialist and direct-message routes shared a generic technical DM surface,
   including repeated identity and reconnect rows;
3. the Assistant workspace control was disabled before a working directory
   existed even though Hermes' real file pane already owns an honest empty
   state;
4. conversation details surfaced transport data (participant identifiers and
   ISO timestamps) instead of product presentation.

## Design review

- Opus job `16082a76-dd8f-45ea-877f-acbbff4bc25f` could not start because its
  OAuth session had expired. It produced no design output and no token spend.
- Kimi K3 design fallback job `37a49b9b-3e17-41a0-94d2-1dfd94827a71`
  completed read-only. Accepted rulings: one 34px native-height rim; no nested
  DM header; an always-usable real FilesPane; one ambient connectivity signal;
  action-only auth/error alerts; one shared app/P2P conversation grammar; and
  human presentation instead of wire identifiers.
- Assembly follow-up job `6760e295-6d70-4835-89ab-56b26b84a848` was submitted
  against the exact working diff and returned **SHIP WITH FIXES**. Accepted
  fixes removed the remaining raw conversation-ID fallback, localized the
  visible DM error instead of surfacing `errorCode`, removed a dead rim prop,
  and added direct DM-route and ambient-signal design contracts.

## Behavior

- `AtumRim` is the single 34px title band. It contains the current conversation
  title, compact roster toggle when needed, and workspace toggle. The second
  `.atum-chat-header` and its material recipe are deleted.
- The workspace toggle always opens Hermes' actual `FilesPane`. With no folder,
  the pane explains its own empty state; preview and DM-details tabs remain
  capability-derived. The workspace plate header also aligns to 34px.
- The shared app/P2P transcript has one Atum composition: opaque warm chat
  ground, centered max-width transcript, rounded Atum bubbles, floating rounded
  composer, and a quiet identity-aware empty state. App roles come from the
  curated presentation catalog; direct chats do not invent one.
- Ambient offline/reconnecting banners were removed from the chat plate. The
  rail account indicator is the single global signal; queued DM composition
  gets reconnecting placeholder copy. Auth-expired and error banners remain
  because they provide actions and now carry `role="alert"`.
- `presentAtumConversation` is shared by roster, transcript empty state, and
  details. UUID-shaped participant/title fallbacks become localized generic
  conversation copy; the details pane no longer prints participant IDs or raw
  ISO time.
- Dead `dm-header.tsx` was removed.

## Verification

- `npm run typecheck` — PASS.
- Focused UI contract — **6 files / 91 tests passed** before the final lint-only
  cleanup; rerun recorded in the final checkpoint below.
- `npm run test:ui` — **264 files, 2,244 passed, 1 existing skip**.
- The jsdom canvas warning is an existing environment warning; the suite exited
  zero.
- Repository-wide lint still contains unrelated baseline findings outside this
  diff. Changed-path ESLint, Prettier, `git diff --check`, packaging, and visual
  dogfood results are recorded in the final checkpoint below.

## Final checkpoint

- Final focused contract after lint cleanup and opaque-ID regression: **98
  tests passed**; the additional roster/DM/design subset passed **70 tests**.
- `npm run build` — PASS. The dirty-tree build-stamp warning was expected
  because this verification preceded the commit; no generated tracked output
  changed.
- `ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms` — **74 files passed, one
  skipped; 803 tests passed, two skipped**. The flag only bypasses the global
  documentation hook in disposable Git-fixture commits.
- Changed-path ESLint (zero warnings), Prettier, and `git diff --check` — PASS.

The exact-head packaged visual verification and installed-app replacement are
the remaining post-commit steps.
