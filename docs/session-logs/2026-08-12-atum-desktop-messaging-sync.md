# Atum desktop messaging sync boundary

## Scope

WS3b adds the smallest end-to-end Electron main-process messaging integration on top of the
account-partitioned `AtumMessagingStore`. The hosted API contract is the frozen Atum
`atum.local-macos.hosted-messaging` v1 pack. Hosted route code is an observed dependency, not an
edited surface in this lane.

The renderer receives only typed projections and commands. Access tokens, refresh tokens, the
SQLite handle, service-role credentials, and direct Supabase access remain unavailable to it.

## State matrix (written before implementation)

| State            | Local projection                                                            | Network behavior                                                         | Mutation behavior                                                                                            | Recovery                                                                |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `loading`        | Open the selected account database; never show another account              | Validate the main-process session, then perform bounded initial backfill | Do not lose an already durable outbox                                                                        | Move to `online`, an explicit cached/error state, or `auth_expired`     |
| `online`         | Serve roster/messages/drafts from SQLite                                    | Drain sync pages and poll/realtime hints from the last committed cursor  | Send due outbox rows; reconcile HTTP acknowledgement and later duplicate echoes by client/canonical identity | Continue from the durable cursor after transient failure                |
| `offline_cached` | Serve cached rows and drafts, visibly stale                                 | No success-as-empty projection                                           | Queue sends with stable client identity                                                                      | Bounded retry timer or explicit `retry`/`sync`                          |
| `reconnecting`   | Keep the previous account projection mounted                                | Retry session/sync with bounded exponential delay                        | Retain request bytes and identity                                                                            | Successful session + sync returns to `online`                           |
| `auth_expired`   | Keep cache, drafts, and outbox                                              | Refresh exactly once after a 401/token-expired response                  | Do not send with a rejected token and do not discard drafts                                                  | Fresh main-process token resumes sync; refresh failure requires sign-in |
| `error`          | Keep cache; never translate a malformed/error response into an empty roster | Stop the hot loop and expose the typed error code                        | Terminal/conflicted rows remain inspectable/retryable only when allowed                                      | Explicit retry or account/session replacement                           |

Additional transitions:

- Account switch closes the prior store handle and opens the new verified account partition in the
  shared messaging database. Every persisted messaging table includes the account id in its key, so
  no previous-account row can cross the API boundary.
- Process restart recovers interrupted `sending` rows to `queued`; the engine drains them only after
  auth/session recovery.
- A sync page is applied durably before its opaque cursor is committed. Failed page projection leaves
  the previous cursor intact.
- Realtime `sync_available` carries no message body. It only coalesces a call to authoritative HTTP
  sync. Duplicate realtime/HTTP echoes are harmless.
- `sync_cursor_expired` resets only the server projection and cursor; drafts and pending mutations
  survive before full backfill and safe replay.

## Planned implementation seams

- `credential-vault.ts`: safeStorage-shaped encrypted token persistence owned by Electron main.
- `http-client.ts`: bearer-only `/api/desktop/v1` adapter with one 401 refresh replay and validated
  error envelopes.
- `sync-engine.ts`: account/store lifecycle, initial roster/history backfill, cursor-safe sync, outbox
  drain, retry/reconnect scheduling, and typed renderer model operations.
- `ipc.ts` plus minimal main/preload registration: allowlisted methods only; no generic fetch, token,
  or database capability.
- Fake HTTP server tests carry JSON bytes through the real adapter and on-disk SQLite store.

## Verification

Focused implementation checkpoint:

```bash
cd apps/desktop
npm run typecheck
npx vitest run --project electron \
  electron/atum-messaging/store.test.ts \
  electron/atum-messaging/integration.test.ts \
  electron/atum-messaging/ipc.test.ts
npx eslint electron/atum-messaging src/lib/atum-messaging-client.ts \
  electron/main.ts electron/preload.ts src/global.d.ts
git diff --check
```

After consuming independently reviewed store correction `f87e2d99e` (recorded locally as
`641d9f55a`), the final result was:

- Typecheck passed.
- Focused messaging suite: 15/15 passed across store, real-byte integration, and IPC tests.
- Full Electron project: 722 passed, 2 skipped across 66 passing files and one intentionally skipped
  file. The command uses `ALLOW_NO_DOCS_LOG=1` because existing git-review fixtures create temporary
  commits without documentation and otherwise trigger the developer machine's global commit hook.
- Changed-path ESLint passed with no warnings or errors.
- Exact-base diff check passed against `000ac333e004c796ec12f2dda49e1cae95012901`.

Commands:

```bash
cd apps/desktop
npm run typecheck
npx vitest run --project electron \
  electron/atum-messaging/store.test.ts \
  electron/atum-messaging/integration.test.ts \
  electron/atum-messaging/ipc.test.ts
ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms
npx eslint electron/atum-messaging src/lib/atum-messaging-client.ts \
  electron/main.ts electron/preload.ts src/global.d.ts
git diff --check 000ac333e004c796ec12f2dda49e1cae95012901..HEAD
```

## Exact integration limits

- This lane owns storage, authenticated HTTP, sync/outbox lifecycle, and the renderer-safe model
  bridge. It does not acquire a Supabase session. The account-login lane must call the runtime's
  main-only `installSession` seam and provide the real refresh implementation. The assembled main
  process currently has neither, so a clean install honestly reports `auth_expired` rather than
  exposing a token input to the renderer.
- The engine polls authoritative HTTP and exposes a coalesced main-process `realtimeHint` seam. It
  does not add a Supabase Realtime dependency or subscription in this lane.
- Initial roster and per-conversation history fetch the first bounded 100 rows. Deep pagination,
  search, media, reactions, edit/recall/forward, conversation creation/state, and offline read
  mutation replay remain later messaging lanes.
- No visual messaging surface was added. `atumMessagingClient()` is the typed model seam for WS4.
- No hosted system was contacted or mutated; every network assertion used a loopback fake server.

## Kimi WS3b review correction

Independent code review job `8204ce1d-ba2b-4cd4-a8f6-17315cd8bfa9` identified three merge blockers
and several bounded wire/store hardening items. This correction keeps the renderer model and hosted
route contract unchanged while fixing the Electron-main lifecycle beneath them.

Behavior and architecture changes:

- Every hosted request now has an abortable, clamped 15-second default timeout (configurable for
  assembly/tests from 10 ms through 120 seconds). Timeout and network aborts become retryable
  `temporarily_unavailable`, and response bodies are streamed through a bounded 4 MiB default / 16
  MiB hard ceiling before JSON projection.
- The HTTP client and sync engine both carry lifecycle generations. Stop or account replacement
  aborts current requests, invalidates a refresh that resolves later, clears timers, and prevents a
  stale continuation from reopening a closed store, mutating the new account partition, or
  coalescing a new-account sync behind old work. Timer callbacks recheck both generation and stopped
  state before syncing.
- Send and retry commands translate an exhausted 401 refresh into `auth_expired` without rejecting
  the renderer IPC invocation or leaving connectivity falsely `online`; the durable outbox row stays
  available for authentication recovery.
- `retry_after_ms` must be finite and is clamped to five minutes. Sync cursors and change ids are
  validated as opaque values no longer than 8,192 characters at the wire boundary. Invalid 2xx bodies,
  repeated cursors, oversized responses, and the 100-page default / 500-page hard sync ceiling stop
  in explicit non-auto-retrying error state instead of forming deterministic poison loops.
- Deleting a canonical message recomputes unread state against the read watermark (with a clamped
  fallback for initial-history rows). Base URL normalization strips URL userinfo. Send tests assert
  the stable idempotency-key header as well as identical replay bytes.
- The account isolation documentation now describes the actual account-partitioned shared SQLite
  database, not a nonexistent per-account database path.

Local verification on the host checkout:

```bash
cd apps/desktop
npm run typecheck
npx vitest run --project electron \
  electron/atum-messaging/store.test.ts \
  electron/atum-messaging/integration.test.ts \
  electron/atum-messaging/ipc.test.ts
ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms
npx eslint --max-warnings=0 electron/atum-messaging
npx prettier --check \
  electron/atum-messaging/credential-vault.ts \
  electron/atum-messaging/http-client.ts \
  electron/atum-messaging/integration.test.ts \
  electron/atum-messaging/runtime.ts \
  electron/atum-messaging/store.test.ts \
  electron/atum-messaging/store.ts \
  electron/atum-messaging/sync-engine.ts \
  electron/atum-messaging/wire.ts \
  ../../docs/session-logs/2026-08-12-atum-desktop-messaging-sync.md
git diff --check 777f64f79bb325fc4ec8d6cefc01bb56ce4f5449
```

Results at this checkpoint: focused messaging 23/23 passed; full Electron project 730 passed and 2
skipped across 66 passing files and one intentionally skipped file; typecheck, changed-path ESLint,
Prettier, and exact-base diff checks passed. The hung-server, stop-mid-flight, switch-mid-flight,
late-refresh, send/retry-401, poison-change, page-cap, response-cap, retry-delay clamp, unread-delete,
URL-userinfo, and idempotency assertions all traverse real loopback HTTP bytes and/or an on-disk
SQLite database. No hosted environment and no installed app was contacted or mutated.
