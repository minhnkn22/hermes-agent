# Atum local messaging store (WS3a)

## Scope and source contract

This change adds a local-only, Electron-main-process messaging data engine under
`apps/desktop/electron/atum-messaging/`. It does not add hosted calls, renderer UI, auth, IPC wiring,
or change the Hermes agent/runtime capability surface.

Implementation input is the frozen Atum contract
`spec/local-macos-messaging/v1` at pinned SHA-256
`dcb1ba213e8ea758d2854b95d17075a483c31243714f1e17771fdb00c99afb65`. The local database is a
non-authoritative, account-partitioned projection. Drafts and pending mutation identities are local
user state and survive projection resets; cached server entities do not authorize hosted writes.

## State matrix (written before implementation)

| Concern | Loading / empty | Healthy | Degraded / partial | Failure | Recovery invariant |
|---|---|---|---|---|---|
| Database open | migrations pending | current schema open | prior schema opens and migrates transactionally | migration checksum/version mismatch aborts open | never continue with an unknown schema |
| Conversation list | no cached rows | ordered cached conversations | offline cache is explicitly a projection | query error is surfaced, never projected as empty | reopen the same account partition and retry |
| Message history | no cached rows | indexed newest-first page | pending local messages coexist with canonical rows | read error is surfaced | canonical echo reconciles into the optimistic row |
| Draft | absent draft | one draft per account + conversation | draft remains while send is queued/failed | write failure leaves the previous committed draft | clear only after canonical acknowledgement |
| Outbound mutation | queued | sending, then sent | failed-retryable with same idempotency identity | failed-terminal/conflicted remains inspectable | crash-relaunch converts stranded `sending` back to `queued` |
| Connectivity | offline cache usable | caller may drain due mutations | reconnect/backoff delays due work | outage never deletes draft or mutation | hosted adapter later owns auth/network and invokes typed local transitions |
| Sync cursor | absent means initial sync | opaque committed cursor | realtime hint does not advance it | stale expected cursor is rejected | only authoritative backfill commits the next cursor |
| Read state | no read marker | monotonic through-message marker | incoming cached messages increment unread | older read attempts are no-ops | read position and unread projection update in one transaction |
| Projection reset | cached projection present | not required | expired cursor requires reset | reset failure rolls back | retain drafts, pending mutations, and their optimistic messages |
| Duplicate delivery | optimistic row only | one canonicalized row | echo may arrive before or after HTTP ack | conflicting identity is rejected | unique canonical/client identities collapse repeats deterministically |

## Planned proof

- deterministic fresh install and v1-to-current migration checks;
- per-account/per-conversation isolation for conversations, messages, drafts, cursors, and unread;
- optimistic send, acknowledgement canonicalization, duplicate echo collapse, and draft clearing only
  after acknowledgement;
- retryable failure, outage, process crash, relaunch recovery, cursor conflict, and projection reset;
- a 10,000-message indexed conversation switch/query benchmark with p95 at or below 100 ms on the
  implementation host.

Verification commands and measured evidence are appended after implementation.

## Implemented boundary and integration seam

`openAtumMessagingStore({ accountId, databasePath })` returns the typed
`MessagingStoreBoundary`. The module owns no network or auth token. A later main/preload lane should:

1. open one store per active authenticated account, using an app-owned path under Electron's
   `userData` directory;
2. expose explicit preload operations rather than the store object, database path, SQLite handle,
   or bearer/refresh tokens;
3. process each authoritative sync change with an idempotent entity upsert, then call
   `recordSyncChange`; commit `next_cursor` only after every change in the page is durable, using
   `commitSyncCursor(expected, next)` to reject stale concurrent pages;
4. use `queueSend` once, retain its `clientMessageId` across retries, transition due work through
   `markMutationSending`, and report retryable/terminal/conflict outcomes through
   `markMutationFailed`;
5. pass the canonical HTTP/realtime message to `canonicalizeMessage`. That operation collapses an
   optimistic row and duplicate echo in one transaction, marks the outbox row sent, and clears only
   the exact draft revision captured when the send was queued.

The database uses WAL on disk, foreign keys, bounded query limits, account-qualified primary/index
keys, checksum-verified migrations, an opaque cursor slot, a processed-change de-duplication table,
a durable mutation outbox, per-conversation drafts, and monotonic read state. Opening a store recovers
any mutation stranded in `sending` to `queued`. `resetProjection` removes cached canonical state and
the cursor while preserving drafts, unsent outbox rows, and their optimistic messages.

## Verification (2026-08-12, Apple Silicon host)

From `apps/desktop` in this exact worktree, with the parent checkout's dependency install linked into
the isolated worktree:

```bash
../../node_modules/.bin/tsc -p tsconfig.electron.json --noEmit --pretty false
../../node_modules/.bin/eslint electron/atum-messaging
../../node_modules/.bin/vitest run --project electron electron/atum-messaging/store.test.ts --reporter=verbose --disableConsoleIntercept
ALLOW_NO_DOCS_LOG=1 ../../node_modules/.bin/vitest run --project electron --reporter=dot
```

Results:

- focused messaging store: 6/6 passed;
- complete Electron project: 64 files passed, 1 intentional file skip; 713 tests passed, 2 skipped;
- 10,000 cached messages, 200 alternating conversation queries of the newest 100 messages:
  `ATUM_MESSAGING_SWITCH_P95_MS=1.841` while the complete Electron suite ran concurrently, under the
  required 100 ms p95 ceiling;
- TypeScript compile and targeted ESLint completed with zero errors.

`ALLOW_NO_DOCS_LOG=1` is required only because an existing repository commit hook is inherited by a
test's temporary Git repository; without the flag, that unrelated fixture commit is blocked before
the code under test runs.
