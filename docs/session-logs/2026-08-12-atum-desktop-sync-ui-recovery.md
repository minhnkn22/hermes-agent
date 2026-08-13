# Atum desktop auth-recovery and sync-poll correction

## Scope

This checkpoint corrects the renderer/account-cache and Electron sync findings from the assembled
desktop review at exact base `b02ca17275101770b5aa575fc55674e5b4d6a68c`. It changes only Atum
renderer messaging/auth state, the DM recovery affordance, and the Electron messaging sync engine.
It does not change hosted contracts, environment configuration, packaging, or the installed app.

## Behavior and architecture

- Renderer polling refreshes the native account status before network sync. A native `expired`
  transition is therefore actionable without restarting the app. Expiry, refresh, transient auth
  error, failed login, and cancelled login preserve the same account's roster, messages, and drafts;
  a verified different account and explicit sign-out still clear the renderer partition immediately.
- `refreshing` is treated as the same authenticated account for roster/composer behavior. The DM
  expiry banner now exposes a real `Đăng nhập lại` button: it starts Google when configured or moves
  focus to the identifier/password form when Google is unavailable.
- The renderer reads the main-process sync status on every 5-second observation tick but invokes
  `sync()` only when `nextRetryAt` is due. `auth_expired`, a non-retryable terminal error, an invalid
  retry timestamp, and a future retry timestamp do not hot-loop.
- Initial history backfill now occurs only when the durable cursor is null. An ordinary incremental
  poll refreshes only conversations named by the sync change ledger; an empty page no longer fetches
  every conversation's full bounded history.
- Read state advances in the account-partitioned SQLite store before the hosted read receipt. A
  hosted/network failure keeps the local unread view responsive and moves connectivity into the
  existing retry state. Renderer mark-read and draft persistence promises are caught; drafts and
  already-loaded messages remain available on failure.
- The inherited UI locale is projected before narrow messaging IPC: `vi` remains `vi`, while `en`,
  `zh`, `zh-hant`, and `ja` deterministically become hosted locale `en`. Electron IPC continues to
  accept only `vi | en`; the renderer cannot pass a hosted-invalid locale through that boundary.

## Account boundary rules

- Cached data is never relabelled for a different identity. A non-null new account id that differs
  from the current renderer/status scope increments the account epoch and clears roster, messages,
  drafts, and active conversation before publishing the new identity.
- Explicit native `signed_out` observed during normal status polling and the explicit sign-out
  command clear the partition. A `signed_out` result produced while a sign-in attempt is failing or
  being cancelled does not destroy the prior account cache; it stays hidden until the same account
  reauthenticates or is cleared when a different identity arrives.
- Async roster, message, sync, draft, and read continuations still compare the account epoch before
  publishing renderer state.

## Verification

Run from `apps/desktop` unless otherwise noted:

```bash
npm run typecheck
npm run test:ui -- --run \
  src/store/atum-messaging.test.ts \
  src/app/dm/index.test.tsx \
  src/app/dm/dm-composer.test.tsx \
  src/app/chat/sidebar/atum-section.test.tsx
npm run test:desktop:platforms -- --run \
  electron/atum-messaging/integration.test.ts \
  electron/atum-messaging/ipc.test.ts
npm run test:ui
ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms
npx eslint \
  src/store/atum-messaging.ts src/store/atum-messaging.test.ts \
  src/app/dm/index.tsx src/app/dm/index.test.tsx \
  electron/atum-messaging/sync-engine.ts electron/atum-messaging/integration.test.ts
npx prettier --check \
  src/store/atum-messaging.ts src/store/atum-messaging.test.ts \
  src/app/dm/index.tsx src/app/dm/index.test.tsx \
  electron/atum-messaging/sync-engine.ts electron/atum-messaging/integration.test.ts \
  ../../docs/session-logs/2026-08-12-atum-desktop-sync-ui-recovery.md
git diff --check b02ca17275101770b5aa575fc55674e5b4d6a68c
```

Final local host results:

- Desktop renderer/Electron/E2E TypeScript typecheck passed.
- Focused UI/store/DM suite: 29 passed across four files.
- Focused real-byte Electron messaging integration/IPC suite: 17 passed across two files.
- Full UI project: 255 files passed; 2,104 tests passed and one existing test skipped. Existing jsdom
  canvas `getContext()` warnings remained non-failing.
- Full Electron project: 70 files passed and one intentionally skipped; 753 tests passed and two
  skipped. `ALLOW_NO_DOCS_LOG=1` is needed only because the existing git-review fixture creates
  disposable commits that the developer machine's global documentation hook otherwise rejects.
- Changed-path ESLint, changed-path Prettier, and exact-base diff checks passed.
- Full-repository desktop lint remains red on three pre-existing import-sort errors plus unrelated
  warnings outside this diff (`hermes-profile-scope.test.ts`, `profile-scope.test.ts`, and
  `themes/presets.test.ts`); the changed-path lint command above is clean.

No hosted service, account, credential, environment file, packaged artifact, or installed app was
contacted or mutated.
