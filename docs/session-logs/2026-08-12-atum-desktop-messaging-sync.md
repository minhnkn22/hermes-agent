# Atum desktop messaging sync boundary

## Scope

WS3b adds the smallest end-to-end Electron main-process messaging integration on top of the
account-partitioned `AtumMessagingStore`. The hosted API contract is the frozen Atum
`atum.local-macos.hosted-messaging` v1 pack. Hosted route code is an observed dependency, not an
edited surface in this lane.

The renderer receives only typed projections and commands. Access tokens, refresh tokens, the
SQLite handle, service-role credentials, and direct Supabase access remain unavailable to it.

## State matrix (written before implementation)

| State | Local projection | Network behavior | Mutation behavior | Recovery |
|---|---|---|---|---|
| `loading` | Open the selected account database; never show another account | Validate the main-process session, then perform bounded initial backfill | Do not lose an already durable outbox | Move to `online`, an explicit cached/error state, or `auth_expired` |
| `online` | Serve roster/messages/drafts from SQLite | Drain sync pages and poll/realtime hints from the last committed cursor | Send due outbox rows; reconcile HTTP acknowledgement and later duplicate echoes by client/canonical identity | Continue from the durable cursor after transient failure |
| `offline_cached` | Serve cached rows and drafts, visibly stale | No success-as-empty projection | Queue sends with stable client identity | Bounded retry timer or explicit `retry`/`sync` |
| `reconnecting` | Keep the previous account projection mounted | Retry session/sync with bounded exponential delay | Retain request bytes and identity | Successful session + sync returns to `online` |
| `auth_expired` | Keep cache, drafts, and outbox | Refresh exactly once after a 401/token-expired response | Do not send with a rejected token and do not discard drafts | Fresh main-process token resumes sync; refresh failure requires sign-in |
| `error` | Keep cache; never translate a malformed/error response into an empty roster | Stop the hot loop and expose the typed error code | Terminal/conflicted rows remain inspectable/retryable only when allowed | Explicit retry or account/session replacement |

Additional transitions:

- Account switch closes the prior store and opens a database path derived from the new verified
  account id. No previous account rows can cross the API boundary.
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

Result: typecheck passed; 13/13 focused tests passed; changed-path lint and diff check passed.
The final checkpoint will rerun the full Electron suite after consuming the independently reviewed
store corrections from the assembly branch.
