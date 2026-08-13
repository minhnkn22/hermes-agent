/**
 * Atum product-shell selection state.
 *
 * This is the ONLY store the Atum shell owns. It deliberately does not model
 * sessions, profiles, projects, worktrees, pins, or cron — the Atum product
 * surface shows one local assistant conversation plus hosted Atum DMs, and the
 * Hermes organisation of those things stays where it already lives.
 *
 * Scope: every key below is window/presentation state, so it is global-scoped
 * (`hermes.desktop.atum.*`) rather than connection- or profile-scoped.
 */

import { atom } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'

/** Geometry the Atum shell is specified in. Exported so tests and the panels
 *  read one copy instead of re-deriving the numbers. */
export const ATUM_RAIL_WIDTH = 52
export const ATUM_ROSTER_WIDTH = 274
export const ATUM_GUTTER = 10
export const ATUM_CHAT_MIN_WIDTH = 420

export const ATUM_WORKSPACE_MIN_WIDTH = 360
export const ATUM_WORKSPACE_MAX_WIDTH = 640
export const ATUM_WORKSPACE_DEFAULT_WIDTH = 380

/** Below this the roster becomes an overlay drawer and the workspace a sheet.
 *  Presentation only — it never changes `$workspaceOpen`. */
export const ATUM_COMPACT_BREAKPOINT_PX = 800
/** Below this the workspace presents as a right-edge drawer instead of inline. */
export const ATUM_WORKSPACE_DRAWER_BREAKPOINT_PX = 1280

/** The width the shell needs before an inline workspace can exist at all. */
export const ATUM_WORKSPACE_INLINE_RESERVE =
  ATUM_RAIL_WIDTH + ATUM_ROSTER_WIDTH + ATUM_CHAT_MIN_WIDTH + ATUM_GUTTER * 4

export type AtumWorkspaceTab = 'details' | 'files' | 'view'
export type AtumRailDestination = 'chat'

const SHELL_KEY = 'hermes.desktop.atum.shell'
const WORKSPACE_OPEN_KEY = 'hermes.desktop.atum.workspaceOpen'
const WORKSPACE_TAB_KEY = 'hermes.desktop.atum.workspaceTab'
const WORKSPACE_WIDTH_KEY = 'hermes.desktop.atum.workspaceWidth'

const WORKSPACE_TABS: readonly AtumWorkspaceTab[] = ['view', 'files', 'details']

function isWorkspaceTab(value: string): value is AtumWorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(value)
}

/**
 * Clamp a requested workspace width into what the viewport can actually give.
 * Returns 0 when the viewport cannot host an inline workspace at all — callers
 * treat that as "present as a drawer", never as "silently collapse".
 */
export function clampWorkspaceWidth(width: number, viewportWidth: number): number {
  const available = viewportWidth - ATUM_WORKSPACE_INLINE_RESERVE

  if (!Number.isFinite(width)) {
    return ATUM_WORKSPACE_DEFAULT_WIDTH
  }

  const ceiling = Math.min(ATUM_WORKSPACE_MAX_WIDTH, available)

  if (ceiling < ATUM_WORKSPACE_MIN_WIDTH) {
    return 0
  }

  return Math.round(Math.min(Math.max(width, ATUM_WORKSPACE_MIN_WIDTH), ceiling))
}

/** The Atum product shell. `false` restores the legacy Hermes chrome verbatim
 *  (titlebar tool clusters, pane tree, statusbar) for debugging and fallback. */
export const $atumShellEnabled = persistentAtom(SHELL_KEY, true, Codecs.bool)

/** Roster search box. Ephemeral: a query is not worth restoring across launches. */
export const $rosterQuery = atom('')

export const $workspaceOpen = persistentAtom(WORKSPACE_OPEN_KEY, false, Codecs.bool)

export const $workspaceTab = persistentAtom<AtumWorkspaceTab>(WORKSPACE_TAB_KEY, 'view', {
  decode: raw => (isWorkspaceTab(raw) ? raw : 'view'),
  encode: value => value
})

export const $workspaceWidth = persistentAtom<number>(WORKSPACE_WIDTH_KEY, ATUM_WORKSPACE_DEFAULT_WIDTH, {
  decode: raw => {
    const parsed = Number.parseInt(raw, 10)

    return Number.isFinite(parsed) ? parsed : ATUM_WORKSPACE_DEFAULT_WIDTH
  },
  encode: value => String(value)
})

/** Only value in P0. Kept as an atom so the rail's active state has one owner
 *  when devices/other destinations become real. */
export const $railDestination = atom<AtumRailDestination>('chat')

/** Compact presentations open the roster over the chat instead of beside it. */
export const $rosterDrawerOpen = atom(false)

export function setRosterQuery(query: string): void {
  if (query !== $rosterQuery.get()) {
    $rosterQuery.set(query)
  }
}

export function setWorkspaceOpen(open: boolean): void {
  if (open !== $workspaceOpen.get()) {
    $workspaceOpen.set(open)
  }
}

export function toggleWorkspace(): void {
  $workspaceOpen.set(!$workspaceOpen.get())
}

export function setWorkspaceTab(tab: AtumWorkspaceTab): void {
  if (tab !== $workspaceTab.get()) {
    $workspaceTab.set(tab)
  }
}

/** Persist a resize. The stored value keeps the user's INTENT (unclamped by a
 *  transiently narrow window) so widening the window restores what they chose. */
export function setWorkspaceWidth(width: number): void {
  const next = Math.round(Math.min(Math.max(width, ATUM_WORKSPACE_MIN_WIDTH), ATUM_WORKSPACE_MAX_WIDTH))

  if (next !== $workspaceWidth.get()) {
    $workspaceWidth.set(next)
  }
}

export function setRosterDrawerOpen(open: boolean): void {
  if (open !== $rosterDrawerOpen.get()) {
    $rosterDrawerOpen.set(open)
  }
}

/** Test seam: reset every Atum shell atom to its default. */
export function resetAtumShellState(): void {
  $rosterQuery.set('')
  $workspaceOpen.set(false)
  $workspaceTab.set('view')
  $workspaceWidth.set(ATUM_WORKSPACE_DEFAULT_WIDTH)
  $railDestination.set('chat')
  $rosterDrawerOpen.set(false)
}
