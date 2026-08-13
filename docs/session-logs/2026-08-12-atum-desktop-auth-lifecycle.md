# Atum desktop auth lifecycle hardening — 2026-08-12

## Scope and base

- Isolated branch: `fix/atum-auth-lifecycle`
- Exact assembly base: `b02ca17275101770b5aa575fc55674e5b4d6a68c`
- Scope: Electron-main Atum account authentication, refresh ownership, native IPC validation, and
  the single refresh-signal wiring in `electron/main.ts`.
- No installed application, hosted environment, credential, Atum repository, or deployment was
  changed.

## Behavior

- PKCE token exchange, hosted `/session` verification, and Supabase refresh-token exchange now use
  a bounded 15-second request window. Explicit cancellation wins over timeout and maps to a stable
  cancellation code; malformed and oversized JSON remain distinct failures.
- The messaging runtime now owns a single refresh flight for the exact tuple of hosted base URL,
  account ID, access token, and refresh token. Concurrent 401s share that flight. After rotation,
  later rejected requests use the newly installed session instead of attempting the consumed
  refresh token again.
- Stop, sign-out, successful account switch, and direct runtime session replacement abort the old
  refresh signal. Generation and exact-session checks prevent a late response from persisting or
  replaying the previous account.
- Invalid password-login IPC payloads return a sanitized `account_credentials_invalid` account
  status rather than throwing an Electron-wrapped remote-method error into renderer state.
  Password policy remains hosted-authoritative: main enforces non-empty input and a 4096-character
  transport bound, but no independent minimum-strength rule.
- Native identifier normalization matches the hosted resolver for `0…`, `84…`, and `+84…`
  Vietnamese phone forms and for three-to-32-character, lowercase alphanumeric/hyphen Atum handles.
  Credentials are still neither logged nor retained after the request.

## Lifecycle matrix

| Event | In-flight refresh | Result allowed to persist/replay |
|---|---|---|
| Parallel 401, same exact session | Shared single flight | One rotated session; every live request replays once |
| Stop | Aborted | No |
| Sign-out | Aborted before vault clear | No |
| Account switch/session replacement | Aborted before new partition starts | Only the new session |
| Request timeout | Aborted by bounded signal | No; account transitions to expired |
| Explicit login cancellation | Aborted | No partial session install |

## Verification

Run from `apps/desktop` unless noted:

```text
npx vitest run --project electron electron/atum-messaging/account-auth.test.ts electron/atum-messaging/account-ipc.test.ts electron/atum-messaging/integration.test.ts
  3 files, 34 tests passed

npm run typecheck
  passed

ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms
  70 files passed, 1 skipped; 756 tests passed, 2 skipped

npm run lint
  passed

git diff --check
  passed
```

The first full Electron invocation omitted `ALLOW_NO_DOCS_LOG=1`; the host's global commit hook then
blocked `git-review-ops.test.ts` from seeding its temporary fixture repository. The scoped rerun used
the repository-documented hook exception for that temporary test commit and passed. No product test
failure was suppressed.
