# 2026-08-12 — Atum liquid-glass product shell (P0)

Branch: `feat/atum-liquid-glass-ui` (isolated worktree
`~/.hermes/worktrees/atum-liquid-glass-ui`), branched from `555616603`.
Lane: **renderer/design only**. Electron main/preload, packaging, icon assets,
package manifests, and backend/state-home logic are owned by a separate Kimi
lane and are **not touched here**.

Source specification:
`~/.claude/plans/you-are-claude-acting-enchanted-journal.md` (Opus, complete).
The user's explicit decisions below override the spec where they disagree.

---

## 1. Decisions that override the specification

| # | Spec said | Decision taken here | Why |
| --- | --- | --- | --- |
| 1 | Roster is a **merge** of `$atumSortedRoster` (Atum DMs) and `$sessions` (Hermes chats) | Roster is **Atum-only**: one local assistant conversation + hosted Atum DMs. Hermes sessions, profiles, projects, worktrees, pins, cron, and session groups are never listed and never named. | The visible product model is Atum. Exposing the Hermes session list leaks Hermes nouns and organization into a product that must read as a single assistant plus hosted DMs. |
| 2 | `ATUM_AUTH_ROUTE = '/dang-nhap'` | `ATUM_AUTH_ROUTE = '/sign-in'` | Routes are internal plumbing and stay conventional English; user-facing copy stays Vietnamese-first. |
| 3 | — | Full Hermes engine, plugins, skills, providers, browser/computer control, tool cards, approvals, transcript, and command palette stay mounted and reachable. | This is a chrome/product-model branch, not a capability deletion. |
| 4 | Devices rail button disabled | Unchanged — disabled, gray, focusable, tooltip-explained, **no** pairing UI and no device strings. | Honesty: never render a fake pairing state. |
| 5 | Auth is a full-window surface | Unchanged. Google appears only when provider truth says so; identifier (username / email / Vietnamese phone) + password is the fallback. No inline sidebar auth anywhere. | The inline 274px sidebar sign-in was the worst product signal in the app. |
| 6 | — | One fixed bare rail (account, chat, devices-disabled, settings); roster search at top; rounded floating plates; simplified chat top rim; **no** statusbar and **no** titlebar tool cluster in the Atum shell. | Product-shell requirement. |
| 9 | — | New shell branches cleanly into `src/app/atum/**`. Legacy Hermes chrome is preserved verbatim behind `$atumShellEnabled`. | Avoids a massive rewrite of legacy components and keeps a working escape hatch. |

## 2. Architecture

```
ContribController
└─ ContribWiring                       ← unchanged: contributions, keybinds,
   │                                     overlays, dialogs, notifications,
   │                                     boot surfaces, palette, terminal host
   └─ $atumShellEnabled
      ├─ true  → AtumShellRoot         ← src/app/atum/shell.tsx (new)
      └─ false → legacy Hermes chrome  ← titlebar + LayoutTreeRoot + statusbar
                                         (existing body, moved verbatim into
                                         LegacyHermesChrome)
```

`ContribWiring` deliberately stays **outside** the branch, so every capability
the wiring publishes (`chatRoutes`, `terminal`, `sidebar`, `statusbar`) is still
constructed. The Atum shell consumes `WiredPane part="chatRoutes"` for the chat
body — there is exactly one transcript renderer in the app, as `DESIGN.md`
requires.

```
AtumShellRoot                        flex h-dvh gap-2.5 bg-(--atum-desk) p-2.5
├─ AtumRail            52px   bare on the desk, no plate
│   ├─ AtumTile        30px   brand + account menu
│   ├─ chat                   only nav destination in P0
│   ├─ devices                DISABLED, focusable, tooltip
│   └─ settings               bottom, navigates SETTINGS_ROUTE (overlay)
├─ AtumRosterPanel     274px  plate: title + SearchField (top) + rows
├─ AtumChatPanel       flex-1 plate: 60px rim + WiredPane chatRoutes
└─ AtumWorkspacePanel  360–640px plate, collapsible, capability-derived tabs
```

### Selection model — `src/store/atum-shell.ts`

| Atom | Type | Persistence |
| --- | --- | --- |
| `$atumShellEnabled` | bool, default **true** | `hermes.desktop.atum.shell` |
| `$rosterQuery` | string | ephemeral |
| `$workspaceOpen` | bool | `hermes.desktop.atum.workspaceOpen` |
| `$workspaceTab` | `'view' \| 'files' \| 'details'` | `hermes.desktop.atum.workspaceTab` |
| `$workspaceWidth` | number, clamped `[360, 640]` | `hermes.desktop.atum.workspaceWidth` |
| `$railDestination` | `'chat'` | ephemeral (only value in P0) |

Falling back to the legacy Hermes shell is one line in devtools:
`localStorage.setItem('hermes.desktop.atum.shell','false')` then reload.

### Roster adapter — the narrow honest one

`src/app/atum/roster.ts` builds `AtumRosterEntry[]` from exactly two sources:

1. **The local Atum assistant** — a single synthetic entry (`kind: 'assistant'`)
   whose route is `sessionRoute($activeSessionId)` when a session is live and
   `NEW_CHAT_ROUTE` otherwise. It is pinned first and is never labelled with a
   session id, profile, project, or worktree.
2. **Hosted Atum DMs** — `$atumSortedRoster` from `store/atum-messaging.ts`,
   already sorted by last activity.

`$sessions`, `$profiles`, `$projects`, `$cronSessions`, and session pins are
**not** read by any file under `src/app/atum/**`. There is a test that asserts
this (`roster.test.ts`), so the Hermes list cannot leak back in silently.

Search folds Vietnamese diacritics (NFD + combining-mark strip) and matches
title + preview, so `tro chuyen` finds `Trò chuyện`.

### Auth

- `authFailureKind` lifted out of `atum-section.tsx` into `src/lib/atum-auth.ts`
  so the view and both test suites import one copy.
- `AtumAuthView` is a full-window gate: no rail, no roster, no chat in the DOM.
  Configured accounts stay gated through signed-out, signing-in, expired, and
  error states; only signed-in or refreshing sessions mount the product shell.
- Reuses `signInToAtum`, `signInToAtumWithPassword`, `cancelAtumSignIn` verbatim,
  and reuses `AtumAccountForm` as the field group (it already owns validation,
  `aria-invalid`, and the required-field messages) with an `appearance="atum"`
  prop that changes container styling only.
- `ATUM_AUTH_ROUTE = '/sign-in'` is reserved in `APP_ROUTES` so the session-id
  parser never mistakes it for a session, and `ChatRoutesSurface` renders `null`
  for it (the gate owns the window).

### Tokens

The repo has **no** `[data-skin='atum']` selector — desktop themes apply through
`themes/presets.ts` writing CSS vars, so the spec's `[data-skin='atum']` block
would have been dead code. Tokens are instead scoped to `.atum-shell` (with a
`.dark .atum-shell` ramp derived from `atumTheme.darkColors`) in
`src/styles.css`, alongside the three material recipes `.atum-plate`,
`.atum-plate-chat`, `.atum-chat-header`. Scoping to the shell root also
guarantees the legacy Hermes shell is visually untouched.

"Liquid glass" is three pure-CSS effects and nothing else: elevation hierarchy
(chat plate shadow > panel plate shadow), exactly **one** `backdrop-filter`
(`.atum-chat-header`, pinned and non-moving), and a soft inset specular hairline
on plate top edges. No `vibrancy`/`backgroundMaterial` BrowserWindow options —
that would be a main-process change and is out of this lane.

## 3. State matrix (as implemented)

`—` = not rendered.

| State | Rail | Roster | Chat | Workspace | Notes |
| --- | --- | --- | --- | --- | --- |
| Signed out (configured) | — | — | — | — | Full-window `AtumAuthView`; `<h1>` focused on mount |
| Signing in | — | — | — | — | Submit → `t.dm.signingIn`, `aria-busy`, disabled; `Hủy` visible; `Esc` cancels |
| Auth failed | — | — | — | — | `role="alert"` band, focused; copy per `authFailureKind` |
| Auth expired | — | — | — | — | `atum.auth.expiredTitle` + `expiredBody`; action `t.dm.authExpiredAction` |
| Auth unconfigured | rail | roster (assistant only) | chat | per capability | `t.dm.unavailable` as a quiet line in the account menu; DM rows absent |
| Roster empty of DMs | rail | search hidden, assistant row only | chat | per capability | The assistant row always exists, so the roster is never truly empty |
| Search no match | rail | search visible, `emptySearch` + hint, `aria-live="polite"` count | unchanged | unchanged | |
| Offline (cached) | rail, tile dot `warn` | rows shown | `offline.banner` band above the transcript, `role="status"` | unchanged | Cached data never renders without the band |
| Reconnecting | tile dot `warn` | unchanged | band `offline.reconnecting` | unchanged | |
| Workspace unavailable | rail | roster | toggle disabled + `<Tip atum.workspace.none>` | — | Toggle stays visible; never silently gone |
| Action/preview arrives while closed | rail | roster | tool card inline | **stays closed** | Intent before automation |
| Compact `<800px` | rail | drawer, focus-trapped, `Esc` closes | full width | full-width sheet | Presentation only; open/closed state survives the breakpoint |
| Reduced motion | — | drawer snaps | — | width/slide snap | `motion-reduce:transition-none` |

## 4. What is deliberately NOT in this change

- **Composer chrome reduction** (spec §2.4's `variant="atum"`). Threading a
  variant from `ChatView` through `composer/*` touches the Hermes composer's
  props, model pill, approval mode, attachments, and voice paths — exactly the
  capability set decision #3 says to preserve. Reducing it via CSS from the
  shell would be a hidden override of a primitive, which `DESIGN.md` forbids.
  Deferred as its own reviewable change. **The shell statusbar and titlebar tool
  cluster ARE gone** — that part of requirement #6 is done.
- Device pairing, multi-device routing (P1).
- Terminal / logs / review workspace tabs (P0 exclusion in the spec).
- App icon replacement (`assets/`, `build/`) — other lane owns packaging.
- Playwright `e2e/` specs for ≤799px and reduced motion — the harness needs a
  packaged build (`npm run test:e2e` runs `npm run build` first), which is out of
  this lane's allowed surface. Covered by jsdom tests instead where observable.

## 5. Files changed

New (`apps/desktop/src/`):

| File | Role |
| --- | --- |
| `app/atum/shell.tsx` | Shell root, auth gate, breakpoints, single-action `Esc` |
| `app/atum/rail.tsx` | The one rail, roving-tabindex keyboard model |
| `app/atum/account-menu.tsx` | Identity, language, appearance, settings, sign-out |
| `app/atum/roster-panel.tsx` | Plate, search-at-top, rows |
| `app/atum/roster.ts` | The Atum-only roster adapter (pure) |
| `app/atum/chat-panel.tsx` | Simplified rim + `WiredPane part="chatRoutes"` |
| `app/atum/workspace-panel.tsx` | Capability tabs, resizer, drawer presentation |
| `app/atum/workspace-tabs.ts` | Capability → tab derivation (pure) |
| `app/atum/use-workspace.ts` | Live capability read (no side effects) |
| `app/atum/auth-view.tsx` | Full-window sign-in gate |
| `store/atum-shell.ts` | Shell selection state + width clamp |
| `lib/atum-auth.ts` | `authFailureKind`, lifted out of `atum-section.tsx` |

New tests: `app/atum/roster.test.ts`, `app/atum/workspace-tabs.test.ts`,
`app/atum/shell.test.tsx`, `app/atum/auth-view.test.tsx`,
`app/atum/design-contract.test.ts`, `store/atum-shell.test.ts`,
`lib/atum-auth.test.ts`.

Modified: `styles.css` (tokens + 3 material recipes), `app/routes.ts` +
`routes.test.ts` (`ATUM_AUTH_ROUTE`, `atum-auth` view), `app/contrib/controller.tsx`
(branch; legacy body extracted verbatim into `LegacyHermesChrome`),
`app/contrib/surfaces.tsx` (null route for `/sign-in`),
`app/chat/sidebar/atum-section.tsx` + its test (inline form deleted, replaced by
a door to the gate), `app/chat/sidebar/atum-account-form.tsx` (`appearance` /
`autoFocus` props; validation untouched), `i18n/{types,en,vi,ja,zh,zh-hant}.ts`,
`i18n/vi-coverage.test.ts`, `DESIGN.md`.

## 6. Verification

The delegated implementation sandbox could not run host commands, so Codex
performed the verification directly in the same isolated worktree after the
handoff:

- `npm run typecheck` — PASS.
- Focused UI run:
  `npx vitest run --project ui src/app/atum src/lib/atum-auth.test.ts
  src/store/atum-shell.test.ts src/app/routes.test.ts
  src/app/chat/sidebar/atum-section.test.tsx src/i18n/vi-coverage.test.ts` —
  **10 files, 117 tests, all passed**.
- `npm run test:ui` — **262 files, 2,210 passed, 1 existing skip**.
- Changed-scope ESLint command — PASS with no output.
- `git diff --check` — PASS.

Two static test files initially used `import.meta.url`; Vitest rewrites that
URL to a non-file scheme. Codex changed only those test path lookups to the
repository's established `__dirname` pattern and reran the focused suite to
the green result above.

Remaining assembly verification:

```bash
cd apps/desktop
npx prettier --write 'src/app/atum/*.{ts,tsx}' src/app/contrib/controller.tsx \
  src/app/chat/sidebar/atum-{section,account-form}.tsx src/store/atum-shell.ts \
  src/lib/atum-auth.ts
npm run dev            # walk the §3 state matrix row by row
```

Known risks a reviewer should check first, in descending order:

1. **`$atumShellEnabled` defaults to `true`**, so the whole app boots into the
   new chrome. If any renderer test asserts on Hermes titlebar/statusbar DOM via
   `ContribController`, it will now fail — flip the default rather than patching
   the shell if that is the wrong trade for this branch.
2. `styles.css` tokens are scoped to `.atum-shell`, not a skin selector — verify
   the legacy shell is pixel-identical with the flag off.
3. `shell.test.tsx` assumes `$currentCwd` is empty for the no-capability
   baseline; it resets it, but a real profile with a cwd will legitimately show
   the `Tệp` tab in the app.
4. The composer chrome is unreduced (see §4) — a visible gap against the
   reference screenshots that is deliberate, not an oversight.
