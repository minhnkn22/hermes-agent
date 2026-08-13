# 2026-08-12 — Atum signed-in shell correction (P0/P1)

Job: `ca205f66-d7e9-4d48-99b9-2e33697dde09` (Opus design specification
`~/.claude/plans/you-are-claude-acting-noble-snowglobe.md`). Lane: desktop Atum
shell/renderer + tests + docs only. Electron main/preload, packaging, hosted
systems, and `/Applications/Atum.app` were **not** touched; no git
fetch/commit/push.

Trigger: `.review-evidence/atum-signed-in-regression.png` — Finder-launched
signed-in app read as a Hermes regression (roster degenerate, composer square,
liquid glass imperceptible, no rim) and showed a faint portrait watermark
through the main panel.

## Root causes confirmed in source

1. All three planes collapsed into one cream field: `--atum-desk` vs
   `--atum-panel` differed by ~8/255 before alpha; panel shadow was below
   perceptual threshold; `--atum-sheen` was an x-offset (left-edge) highlight
   at 18% white — invisible.
2. No top rim: traffic lights floated on bare desk; product identity was a
   13px label in the chat header.
3. Roster degenerated to one row: `dmsAvailable` required signed-in while the
   shell gated only on `account.configured`, and the search field self-hid at
   `entries.length > 1`.
4. Composer was Hermes-shaped: `--atum-r-composer`/`--atum-r-card` were
   declared and never referenced; `--dt-input-inset` recess survived.
5. The watermark was TWO leaks: the legacy `Backdrop` statue
   (`ds-assets/filler-bg0.jpg`, mounted by `ChatView`) plus the translucent
   `--atum-chat` (84%) over the transparent/vibrant window root.

## Exact changes

### Material (`apps/desktop/src/styles.css`)

- Re-graded the three planes per Opus with a user-mandated deviation on the
  chat ground: desk `rgb(222 218 210 / 90%)`, panel `rgb(249 248 245 / 74%)`,
  chat `rgb(253 252 250 / 96%)` + new `--atum-chat-solid: rgb(252 251 248)`,
  chat-veil 62%, new `--atum-rim: rgb(250 249 246 / 60%)`, card 88%, sunk
  `rgb(236 233 227 / 88%)`. Dark ramp keeps the same ratios (desk
  `rgb(12 11 10 / 92%)`, panel `rgb(30 28 24 / 74%)`, chat
  `rgb(38 35 30 / 96%)`, chat-solid `rgb(36 33 29)`).
- `--atum-sheen` is now a true TOP-edge hairline:
  `inset 0 1px 0 color-mix(in srgb, white 62%, transparent)` (dark: 12%).
- Shadows carry real elevation: panel `0 1px 1px /6% + 0 8px 20px -12px /22%`,
  chat `0 1px 1px /7% + 0 24px 48px -24px /34%`, row
  `0 1px 2px /6% + 0 8px 18px -12px /24%`; dark ramp scaled to match.
- Plates, rim, and chat header use `blur(30px) saturate(180%)`. The "no
  backdrop-filter on scrolling content" rule is unchanged (rows, transcript,
  workspace body get none) and DESIGN.md was updated — the stale "exactly one
  backdrop-filter" line now reads "pinned structural surfaces only".
- New `.atum-rim` recipe (44px `--atum-rim-h`, rim material, bottom hairline,
  top sheen).
- Opaque chat plane: `.atum-shell` re-points `--ui-chat-surface-background` to
  `var(--atum-chat-solid)` so every chat descendant (thread column, sticky
  user-message headers, empty state) paints opaquely. Scoped — the legacy
  Hermes shell keeps its own chrome color.
- Composer (scoped to `.atum-shell` only): root `border-radius:
  var(--atum-r-composer)` (18px), surface border `--atum-line-strong`,
  `--atum-card`-mixed fill, elevation + sheen shadow, `min-height: 44px`,
  focus-within `--atum-focus` ring; `--dt-input-inset: none`; fade above the
  composer merges into `--atum-chat-solid`; `--composer-width: 45rem`,
  surface pads `0.5rem / 0.375rem`, shell pad-block-end `0.875rem`.

### Rim (`apps/desktop/src/app/atum/rim.tsx`, new)

Full-width 44px drag band, first child of the shell (the shell is now
`flex-col`; the plate row is the second child). Left inset clears the real
traffic-light position via `titlebarControlsPosition()`
(`max(78px, controlsLeft + 12px)`); right inset reserves the native overlay
width on Windows/Linux. Contents: BrandMark 18px + "Atum" 13px/600 lockup,
then exactly two `no-drag` controls — the workspace toggle (moved out of the
chat header) and the account avatar (`AtumAccountMenu`, 24px mark +
connectivity `StatusDot`). `data-atum-rim` for tests. No session/profile/
project/worktree/model/approval/gateway/pin/split/flip chrome.

### Rail / account menu

- `rail.tsx`: the account tile moved to the rim; the rail is now exactly three
  controls (chat, devices-disabled, settings). Still one fixed bare rail.
- `account-menu.tsx`: menu now opens `side="bottom" align="end"` from the rim.

### Chat panel (`chat-panel.tsx`)

The header is a conversation header (44px): title 13px/600 + one muted 11px
line (specialist role from the hosted payload, or the assistant hint), roster
toggle in compact only. Workspace toggle removed (now in the rim).

### Roster (`roster.ts` + `roster-panel.tsx`)

- Two product groups: TRỢ LÝ (local assistant, always first) and CHUYÊN GIA
  (hosted DMs). Labels 10px/600 uppercase, `--atum-ink-faint`.
- The specialists group always renders one of four honest states: signed-out
  explainer + `Đăng nhập` → `ATUM_AUTH_ROUTE`; 3 skeleton rows on first sync
  (`connectivity === 'loading'`, zero rows); error line + `Thử lại` (re-fetches
  status + roster); `Chưa có chuyên gia nào` when signed in with zero DMs.
- Rows 56px: 34px avatar (hosted image when `payload.avatar_url` exists, else
  initial on a deterministic `color-mix(var(--ui-accent) N%, var(--atum-sunk))`
  tint, `N ∈ {8,14,20,26}` hashed from the conversation id), 9px presence dot
  only when the hosted row reports `presence: 'online'` (never on the
  assistant), title 13px/500 title-cased (`toDisplayTitle` — lowercase hosted
  names like `moon` → `Moon`; self-cased titles untouched), line 2 = role →
  preview → nothing, unread pill replacing the relative-time trailing label.
- Search shows whenever `dmsAvailable || entries.length > 1 || query` (the
  `entries.length > 1` self-hide was the failing case), stays borderless, and
  folds Vietnamese diacritics (`tro chuyen` matches `Trò chuyện`).
- Real hosted rows only — nothing is hard-coded or fabricated.

### Watermark removal

- `components/Backdrop.tsx`: the legacy statue is gated off while
  `$atumShellEnabled` is on.
- The opaque chat plane (above) covers the vibrancy/wallpaper leak.

### Empty state (`components/chat/intro.tsx`)

When the Atum shell is active, the thread empty state is an Atum-branded
centered stack (`data-atum-empty`): BrandMark 44px @ 0.9, headline 15px/600,
body 12.5px muted, and three i18n starter chips (`atum.empty.chips`) that
insert real prompt text into the composer via `requestComposerInsert`. No
Nous/Hermes art or portrait.

### Auth

Submit and Google buttons are rounded with `rounded-[var(--atum-r-control)]`.
The Google button still renders **only** when the sanitized
`account.providers.google` is true — no fake button, no provider/secret
changes. External Google enablement remains an operator/config task.

### i18n

New keys `atum.roster.{groupAssistant, groupSpecialists, signedOutTitle,
signedOutBody, signIn, retry, emptySpecialists}` and `atum.empty.chips` in all
five catalogs (vi, en, ja, zh, zh-hant) + `i18n/types.ts`;
`vi-coverage.test.ts` updated.

## Deliberate deviations from the Opus spec

1. **Chat ground opacity 96% + `--atum-chat-solid` 100%** instead of Opus's
   78%: the newer P0 user requirement ("no recognizable desktop image or
   legacy Hermes art can leak through") overrides the spec's lighter ramp.
   Glass stays on rim/rail/panels/edges.
2. **Model-pill restyle (rounded-full pill) not applied**: the pill has no
   `data-slot` and restyling it means touching shared Hermes composer code —
   out of this lane's scope. The pill sits inside the new rounded surface and
   inherits its geometry.
3. `titlebarControlsPosition()` returns `{left, top}` (no width), so the rim
   inset is `max(78px, controlsLeft + 12px)` — equivalent clearance.
4. Group labels are stored proper-case in catalogs and uppercased via CSS, so
   screen readers and tests read natural text.
5. Screenshot/pixel acceptance checks (Opus §Acceptance 1–4, 8–10) require the
   packaged-app E2E harness — deferred to Codex host verification. jsdom
   behavior/render tests cover the same contracts where practical.

## Files changed

New: `app/atum/rim.tsx`, `app/atum/roster-panel.test.tsx`, this log.

Modified: `apps/desktop/src/styles.css`, `apps/desktop/DESIGN.md`,
`app/atum/shell.tsx`, `app/atum/rail.tsx`, `app/atum/account-menu.tsx`,
`app/atum/chat-panel.tsx`, `app/atum/roster.ts`, `app/atum/roster-panel.tsx`,
`app/atum/roster.test.ts`, `app/atum/shell.test.tsx`,
`app/atum/design-contract.test.ts`, `app/atum/auth-view.tsx`,
`components/Backdrop.tsx`, `components/chat/intro.tsx`,
`app/chat/sidebar/atum-account-form.tsx`, `i18n/{types,en,vi,ja,zh,zh-hant}.ts`,
`i18n/vi-coverage.test.ts`.

## Verification

Kimi reached its 3,600-second transport deadline after writing the implementation
and log but before executing verification. Codex then reconciled the working
tree with the founder's final information architecture and ran:

```text
cd apps/desktop
npm run typecheck
npx vitest run src/app/atum/roster.test.ts src/app/atum/roster-panel.test.tsx src/app/atum/shell.test.tsx src/app/atum/design-contract.test.ts src/i18n/vi-coverage.test.ts
```

Result: typecheck passed; 5 files / 92 tests passed.

Broader host verification after the final reconciliation:

```text
npm run test:ui
# 264 files passed; 2,238 passed / 1 existing skip

ALLOW_NO_DOCS_LOG=1 npx vitest run --project electron
# 73 files passed / 1 file failed / 1 skipped; 802 passed / 2 skipped.
# The sole failure was stage-bundled-runtime.test.mjs hitting its 5-second
# timeout while this suite ran concurrently with the full UI suite.

ALLOW_NO_DOCS_LOG=1 npx vitest run --project electron scripts/stage-bundled-runtime.test.mjs
# isolated rerun: 1 file / 7 tests passed in 174 ms
```

The docs-log bypass affects only disposable Git-fixture hooks in the Electron
suite; it does not bypass product assertions. Changed TypeScript/TSX ESLint,
Prettier, and `git diff --check` also passed.

## Final founder reconciliation (supersedes earlier implementation notes)

The final direction arrived after the Opus brief and therefore supersedes the
earlier two-group/account-in-rim/backdrop-gating notes above:

- Search is always the first visible roster control.
- The directory order is local **Atum** assistant, first-party **Apps**, then
  person-to-person **People** chats. Empty Apps/People headings are omitted.
- The existing wire truth (`specialist` versus `direct`) drives those groups;
  no schema/API change or guessed classification was introduced.
- First-party apps use the product order Moon, Andy, Ben, Taylor and the
  Vietnamese/English role copy already governed by Atum's specialist registry.
  P2P chats remain activity ordered.
- The account control stays in the fixed rail with chat, disabled computer,
  and settings. The rim keeps the proven Hermes/macOS geometry but only Atum
  brand and workspace contents.
- The legacy Hermes `Backdrop` is not merely hidden or gated: `ChatView` no
  longer imports or mounts it. The unused legacy component may remain elsewhere
  in source, but it is not part of the Atum product transcript.
- Final i18n keys are `groupAssistant`, `groupApps`, `groupPeople`, and
  `emptyChats` in all five catalogs.

## Known external gate

Google sign-in button visibility follows the sanitized
`providers.google` from the account status IPC. Enabling Google externally is
an operator/config task and is intentionally untouched here.
