# Atum direct messaging UI — 2026-08-12

## Scope and authority

This lane binds the existing Electron-main Atum messaging client to the Hermes
renderer without weakening the preload boundary. It follows Opus design job
`5b68730c-194a-4ea6-a67e-a9d74a8fd68e`, with deliberate evidence-driven
authentication corrections from the assembly owner. No token/JSON paste,
credential-bearing deep link, pairing flow, or renderer credential mutation
is permitted.

The Hermes assistant, terminal, files, browser, plugins, skills, providers,
cron, gateway, and existing navigation remain intact. Atum direct messages add
one section to the existing rail and one purpose-built workspace route.

## Evidence-driven authentication adjustment

During implementation, the assembly owner verified that the nonproduction
Supabase project has Google OAuth disabled and has no Google client
credentials, while email/password authentication is enabled with autoconfirm
and already supported by the hosted login. Therefore the generic
system-browser button from the original Opus proposal would only fail in the
actual dogfood environment.

The sanitized native status now advertises
`providers:{google,password}`. Google is the primary affordance when and only
when `google` is true; current nonproduction truthfully hides it. The fallback
uses one Vietnamese-first identifier field — `Tên người dùng, email hoặc số
điện thoại` — plus `Mật khẩu`, targeting
`account.signInWithPassword({identifier,password})`. This intentionally adds
Atum handle / `@handle` support alongside Moon-compatible email and Vietnamese
phone identifiers. The password exists only in component state for one narrow
IPC request and is never persisted, logged, or returned. It is cleared after
success or a credential rejection; a network/provider interruption preserves
the input so the user is not forced to retype it.

## State matrix (locked before implementation)

| State | Rail | Thread | Composer | Recovery |
|---|---|---|---|---|
| Initial loading | Loading row; no stale identity claimed | Skeleton | Disabled, `Đang tải...` | Automatic status/roster load |
| Signed out | `Tin nhắn`; Google first only when configured, then identifier/password | Branded signed-out state | Disabled | Native provider-specific login |
| Signing in | Inputs and submit disabled | Keep current cached content hidden from an unknown account | Disabled | Await the one native request |
| Online | Live roster and green status | Canonical/cached messages | Enabled; Enter sends, Shift+Enter newline | Automatic polling |
| Offline with cache | Cached roster and yellow status | Cached messages plus stale banner | Enabled; send is queued optimistically | Automatic reconnect/sync |
| Reconnecting | Cached roster and yellow spinner/status | Keep cached messages visible | Enabled; send is queued | Automatic retry |
| Auth expired | Red status; roster is not relabelled as empty | Expiry banner | Disabled | Native `Đăng nhập lại` |
| Error | Red status with stable error code | Error banner; cached content remains visible only for the same account | Disabled | `Thử lại`; sign out remains available |
| Empty roster | Explicit no-conversations state | No route selected | Disabled | Refresh; this is distinct from error |
| Partial sync | Roster remains usable | Cached/canonical messages plus non-blocking status | Enabled when account is valid | Next poll reconciles |
| Account switch/sign-out | Immediately clear renderer roster, messages, drafts, active conversation | Neutral account state | Disabled | Native account status refresh, then load the selected account partition |

### Optimistic delivery matrix

| Delivery | Presentation | Action |
|---|---|---|
| `queued` / `sending` | Immediate outgoing bubble with subtle clock | None |
| Canonical/confirmed | Normal outgoing bubble | None |
| `failed_retryable` | Error marker and `Thử lại` | Retry using the original client message id |
| `failed_permanent` | Dimmed bubble and error marker | No blind retry |
| `conflicted` | Warning treatment | Preserve content; do not silently overwrite |

## Planned renderer seams

- Route: `/#/dm/:conversationId`; DM identifiers never enter Hermes session
  selection atoms.
- Messaging: existing `atumMessagingClient()` methods only.
- Account: sanitized provider status, Google `signIn()`, one-shot
  `signInWithPassword({identifier,password})`, `cancel()`, and `signOut()`.
  No token or credential is persisted or returned through preload.
- Polling: foreground cadence with a slower hidden-window cadence; every poll
  refreshes the active account's roster and active conversation.
- Drafts: main-process persisted through the existing messaging client and
  cleared from renderer memory on account change/sign-out.

## Verification

Run from `apps/desktop` on this branch:

- `npm run typecheck` — passed for renderer, Electron, and E2E TypeScript
  projects.
- `npx vitest run --project ui src/store/atum-messaging.test.ts
  src/app/dm/dm-composer.test.tsx
  src/app/chat/sidebar/atum-account-form.test.tsx
  src/app/chat/sidebar/atum-section.test.tsx src/app/routes.test.ts` — 19/19
  passed across five files.
- `npm run test:ui` — 254 files passed; 2,087 tests passed and one existing
  test skipped. jsdom printed its existing canvas `getContext()` warnings;
  they were non-failing.
- Changed-path ESLint — zero errors and zero warnings.
- `git diff --check` — passed.

## Assembly note

This renderer branch targets a native-auth contract newer than its exact
`777f64f79` base: `AtumAccountStatus.providers` and
`signInWithPassword({identifier,password})`. Assembly must resolve the narrow
`src/global.d.ts` / account-client overlap with WS3c, preserve the
main-process-only credentials boundary, and implement handle, email, and
Vietnamese-phone identifier resolution before the dogfood login can work.

## Targeted Opus auth follow-up

Targeted Opus UI/copy job `9f50b518-b566-42a9-ba40-de8c88b3f954`
reviewed the assembled auth surface. Its actionable findings were applied in
the assembly: a rejected Google IPC call can no longer strand the rail in
`signing_in`; pending login has a native Cancel/Escape recovery; sanitized
error codes map separately to invalid credentials, connectivity failure, and
provider/configuration failure; identifier/password fields use visible labels,
accepted-input hints, validation focus, and linked descriptions; dead local
ring utilities were removed in favor of the global focus token; and signed-in
identity/logout text and target sizing were raised for Vietnamese legibility.

Focused post-assembly verification:

- `npm run typecheck` — passed.
- `npx vitest run --project ui
  src/app/chat/sidebar/atum-account-form.test.tsx
  src/app/chat/sidebar/atum-section.test.tsx
  src/store/atum-messaging.test.ts` — 16/16 passed.
- `npm run test:ui` — 254 files, 2,091 passed and one existing skip. The
  existing jsdom canvas warnings remained non-failing.
- `ALLOW_NO_DOCS_LOG=1 npm run test:desktop:platforms` — 70 files passed and
  one intentionally skipped; 751 tests passed and two skipped. The environment
  variable is required only because this machine's global Git hook otherwise
  rejects disposable fixture commits; the initial run's sole failure was that
  harness hook, not product code.

The Kimi assembly review `12e52ad1-52f2-464c-9193-7466e33d57a4` found that
the Electron test's hosted credential rejection used HTTP 400 while the
renderer regression covered only 401. The classifier now treats any hosted
password-bootstrap 4xx rejection as invalid credentials; the visible copy is
truthful and the password-clearing policy applies to the exact native error.
