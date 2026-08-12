# Atum desktop account-session authentication

## Scope

WS3c acquires and refreshes the Atum account session entirely in Electron main. It uses the
system browser, an ephemeral `127.0.0.1` callback, Supabase PKCE, Electron `safeStorage` through
the existing messaging runtime vault, and the bearer-only hosted desktop API. The renderer gets
only typed account state and commands; access tokens, refresh tokens, the PKCE verifier, Supabase
keys, and arbitrary network access never cross preload.

This lane does not add or change account UI, copy, visual states, hosted configuration, redirects,
credentials, deploys, or the installed application.

## State matrix (written before implementation)

| State | Durable session | Browser/listener | Messaging runtime | Recovery |
|---|---|---|---|---|
| `unconfigured` | Existing encrypted session may remain readable | Never starts | Existing cache remains available; network cannot acquire a new session | Install valid desktop account configuration and retry |
| `signed_out` | No active session | Closed | `auth_expired`; account-partitioned cache is retained | Start sign-in |
| `signing_in` | Previous account remains installed until replacement succeeds | Exactly one system-browser attempt and one ephemeral loopback listener | Previous account remains authoritative; no partial token is installed | Valid callback installs atomically; cancel/error returns to prior stable state |
| `signed_in` | Encrypted with OS secure storage | Closed | Runtime owns the verified account and syncs bearer routes | Refresh on expiry/401; sign out; or start an explicit account switch |
| `refreshing` | Old refresh token remains until a valid replacement is parsed | Closed | Rejected request is replayed at most once by the existing runtime HTTP boundary | Success replaces the vault atomically; failure becomes `expired` |
| `expired` | Cache/drafts/outbox remain; rejected credentials are not exposed | Closed | `auth_expired`; no error-as-empty projection | Sign in again or switch account |
| `error` | Last stable session is preserved unless explicit logout already cleared it | Listener is closed and timer cleared | Last stable runtime state remains authoritative | Explicit retry; malformed/auth/config errors never become signed-out success |

Additional invariants:

- The callback path carries independent high-entropy state and nonce segments. Both must match
  before the one-time code is exchanged; a mismatched path is rejected.
- The PKCE verifier remains in main memory only, is checked for RFC 7636 shape locally, and is sent
  only to Supabase's token endpoint. Supabase validates it against the authorize challenge.
- Only one attempt may run. A second start reports the existing `signing_in` state rather than
  opening another browser. Cancel, timeout, shutdown, callback error, state/nonce mismatch, and
  browser-open failure all close the listener and clear the timeout.
- Account switch is install-after-verify: the old account remains active until the new token response
  and hosted `/session` identity agree. Logout is the only operation that intentionally clears it.
- Configuration accepts HTTPS outside loopback, rejects credentials in hosted base URLs, rejects
  non-HTTP(S) schemes, and never returns the Supabase public key over IPC.
- Restart restore reads the existing encrypted runtime vault. IPC reports only account id/profile
  metadata and coarse auth state.

## Hosted redirect dependency

The currently evidenced hosted Supabase redirect inventory contains fixed web callbacks and does
not yet evidence an ephemeral desktop loopback pattern. Code and loopback tests can be completed
without mutating hosted configuration, but real Google sign-in requires the selected Supabase
project to allow the governed desktop pattern:

```text
http://127.0.0.1:*/atum-auth/callback/**
```

The exact wildcard syntax must be confirmed in the Supabase dashboard before dogfood. A fixed port
is not substituted silently because the governing architecture explicitly requires an ephemeral
loopback listener.

## Planned seams

- `account-auth.ts`: config parsing, PKCE/state/nonce helpers, loopback driver, token exchange,
  refresh, account controller, cancellation, and sanitized status.
- `account-ipc.ts`: allowlisted status/sign-in/cancel/sign-out operations.
- Existing messaging runtime: main-only session metadata and the existing encrypted install/clear
  seams.
- Minimal main/preload/type registration: no visual behavior and no renderer token path.

## Packaged public configuration

Finder launches do not inherit a shell environment. Packaging therefore writes exactly one
`Contents/Resources/atum-public-config.json` from three explicit build variables:

| Build variable | Packaged field |
|---|---|
| `ATUM_PUBLIC_HOSTED_BASE_URL` | `hostedBaseUrl` |
| `ATUM_PUBLIC_SUPABASE_URL` | `supabaseUrl` |
| `ATUM_PUBLIC_SUPABASE_ANON_KEY` | `supabaseAnonKey` |

The generator reads no `.env` file. It cannot serialize a service-role key, app/platform token,
cron secret, or arbitrary environment field because it constructs a new object from the allowlist.
The packaged reader rejects unknown fields, unsupported schema versions, world-writable files,
non-files, and files over 32 KiB. A complete development environment takes precedence; partial
environment configuration fails rather than mixing projects with packaged values.

The current owner-machine `.env.local` was not opened, parsed, logged, or mutated. Assembly must
export the three public build variables explicitly when invoking `npm run pack`. For nonproduction,
the governed hosted origin is `https://atum-shell-nonprod.vercel.app`; the Supabase public URL/key
must come from the selected project's public configuration. The public anon key is intentionally
shippable; no privileged key is.

## Verification

```bash
cd apps/desktop
npm run typecheck
npx vitest run --project electron \
  electron/atum-messaging/account-auth.test.ts \
  electron/atum-messaging/account-ipc.test.ts \
  electron/atum-messaging/public-config.test.ts \
  electron/atum-messaging/integration.test.ts \
  electron/atum-messaging/ipc.test.ts
ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms
npx eslint electron/atum-messaging/account-auth.ts \
  electron/atum-messaging/account-auth.test.ts \
  electron/atum-messaging/account-ipc.ts \
  electron/atum-messaging/account-ipc.test.ts \
  electron/atum-messaging/public-config.ts \
  electron/atum-messaging/public-config.test.ts \
  electron/atum-messaging/runtime.ts electron/atum-messaging/index.ts \
  electron/main.ts electron/preload.ts src/global.d.ts \
  src/lib/atum-account-client.ts
git diff --check 777f64f79bb325fc4ec8d6cefc01bb56ce4f5449..HEAD
```

Local result:

- Typecheck passed.
- Focused real-byte/auth boundary suite: 21/21 passed before the full Electron sweep; the later
  account-switch/cancel additions are included in the full count below.
- Full Electron project: 738 passed, 2 skipped across 70 passing files and one intentionally skipped
  file. The command uses `ALLOW_NO_DOCS_LOG=1` because existing git-review fixtures create temporary
  commits without documentation and otherwise trigger the developer machine's global commit hook.
- Changed-path ESLint and exact-base diff check passed.

## Exact external dependency and integration notes

- A real Google browser flow remains blocked until the selected Supabase Auth redirect allowlist
  accepts the ephemeral loopback callback pattern documented above. No hosted setting was changed.
- The WS3c commit is based on exact assembly `777f64f79bb325fc4ec8d6cefc01bb56ce4f5449`.
  The concurrent WS3b review-fix lane is expected to overlap `runtime.ts` and `main.ts`; preserve its
  generation/stop/account-switch fixes while retaining WS3c's `accountProfile()` seam, auth-client
  construction, refresh callback, account controller, and registrations. `preload.ts` is additive.
- `scripts/after-pack.mjs` overlaps the runtime pack lane by design. Its integration is one import,
  one Resources path, and one `writeAtumPublicConfig` call immediately after runtime staging.
- No installed app, hosted system, deployment, credential, or `.env` file was touched.
