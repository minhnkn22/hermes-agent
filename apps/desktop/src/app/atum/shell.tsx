import { useStore } from '@nanostores/react'
import { lazy, Suspense, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { titlebarControlsPosition } from '@/app/shell/titlebar'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useI18n } from '@/i18n'
import { $atumAccountStatus, $atumSortedRoster, initializeAtumMessaging } from '@/store/atum-messaging'
import {
  $rosterDrawerOpen,
  $rosterQuery,
  $workspaceOpen,
  ATUM_COMPACT_BREAKPOINT_PX,
  ATUM_WORKSPACE_DRAWER_BREAKPOINT_PX,
  setRosterDrawerOpen,
  setRosterQuery,
  setWorkspaceOpen
} from '@/store/atum-shell'
import { $connection } from '@/store/session'

import { routeDmConversationId } from '../routes'

import { AtumAuthView } from './auth-view'
import { AtumChatPanel } from './chat-panel'
import { AtumRail } from './rail'
import { AtumRim } from './rim'
import { AtumRosterPanel } from './roster-panel'
import { toDisplayTitle } from './roster'
import { useAtumWorkspace } from './use-workspace'

// The workspace pulls in the real preview rail and file tree. It is closed by
// default and often never opened, so it loads on demand rather than sitting in
// the shell's first paint.
const AtumWorkspacePanel = lazy(async () => ({ default: (await import('./workspace-panel')).AtumWorkspacePanel }))

/**
 * The Atum product shell.
 *
 * Layout: a full-width 44px rim on top (traffic lights + brand lockup +
 * workspace toggle), then the plate row (rail, roster, chat, workspace) inside
 * the 10px gutter. The rim band and gutter are drag regions; the rail and every
 * plate opt out of dragging.
 *
 * This component is mounted INSIDE `ContribWiring`, so contributions, keybinds,
 * overlays, dialogs, notifications, the command palette, the persistent
 * terminal host, and every boot surface are untouched by the branch. The full
 * Hermes engine — plugins, skills, providers, browser and computer control,
 * tool cards, approvals — is alive underneath; only the chrome differs.
 */
export function AtumShellRoot() {
  const { t } = useI18n()
  const account = useStore($atumAccountStatus)
  const roster = useStore($atumSortedRoster)
  const workspaceOpen = useStore($workspaceOpen)
  const rosterDrawerOpen = useStore($rosterDrawerOpen)
  const connection = useStore($connection)
  const location = useLocation()
  const workspace = useAtumWorkspace()

  const compact = useMediaQuery(`(max-width: ${ATUM_COMPACT_BREAKPOINT_PX - 1}px)`)
  const workspaceIsDrawer = useMediaQuery(`(max-width: ${ATUM_WORKSPACE_DRAWER_BREAKPOINT_PX - 1}px)`)

  useEffect(() => {
    void initializeAtumMessaging()
  }, [])

  // A configured account stays inside the full-window auth flow until it is
  // genuinely usable. In particular, `signing_in` and `error` must not flash
  // the product shell between submitting credentials and reaching a terminal
  // result. `configured: false` remains a different fact — the local assistant
  // still works, while hosted DMs simply do not exist.
  const gated = account.configured && account.state !== 'signed_in' && account.state !== 'refreshing'

  // One cancel gesture does exactly one thing, resolved topmost-first: close
  // the roster drawer, else close the workspace drawer, else clear a non-empty
  // search. Never two at once.
  useEffect(() => {
    if (gated) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      if ($rosterDrawerOpen.get()) {
        event.preventDefault()
        setRosterDrawerOpen(false)
      } else if (workspaceIsDrawer && $workspaceOpen.get()) {
        event.preventDefault()
        setWorkspaceOpen(false)
      } else if ($rosterQuery.get()) {
        event.preventDefault()
        setRosterQuery('')
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [gated, workspaceIsDrawer])

  // Breakpoints change PRESENTATION only. Crossing into compact closes the
  // transient roster drawer (it has no inline meaning) but never touches
  // `$workspaceOpen`, so widening the window restores what the user had.
  useEffect(() => {
    if (!compact) {
      setRosterDrawerOpen(false)
    }
  }, [compact])

  if (gated) {
    return <AtumAuthView />
  }

  const dmId = routeDmConversationId(location.pathname)
  const dmEntry = dmId ? roster.find(entry => entry.id === dmId) : undefined
  const title = dmEntry ? toDisplayTitle(dmEntry.title ?? dmEntry.participantIds[0] ?? dmId) : t.atum.roster.assistant
  // Conversation header's second line: the specialist's role when the hosted
  // row supplies one; the local assistant always gets its hint. Never a
  // placeholder when the payload has nothing to say.
  const subtitle = dmEntry
    ? (typeof dmEntry.payload?.role === 'string' && dmEntry.payload.role) || ''
    : t.atum.roster.assistantHint

  // macOS traffic lights live in the rim, so the rim's content has to clear
  // them. Read the real position rather than assuming a platform; Windows and
  // Linux reserve the native overlay width on the right instead.
  const controlsPos = titlebarControlsPosition(connection?.windowButtonPosition, Boolean(connection?.isFullscreen))
  const nativeOverlayWidth = connection?.nativeOverlayWidth ?? 0

  return (
    <main className="atum-shell relative flex h-dvh min-h-[520px] flex-col overflow-hidden bg-(--atum-desk) text-(--atum-ink) [-webkit-app-region:drag]">
      <AtumRim controlsLeft={controlsPos.left} nativeOverlayWidth={nativeOverlayWidth} workspace={workspace} />

      <div className="flex min-h-0 flex-1 gap-2.5 p-2.5">
        <AtumRail />

        {(!compact || rosterDrawerOpen) && (
          <AtumRosterPanel compact={compact} onNavigated={() => compact && setRosterDrawerOpen(false)} />
        )}

        <AtumChatPanel
          onToggleRoster={compact ? () => setRosterDrawerOpen(!rosterDrawerOpen) : undefined}
          rosterOpen={rosterDrawerOpen}
          subtitle={subtitle}
          title={title}
        />

        {workspaceOpen && workspace.available.length > 0 && (
          <Suspense fallback={null}>
            <AtumWorkspacePanel drawer={workspaceIsDrawer} workspace={workspace} />
          </Suspense>
        )}
      </div>
    </main>
  )
}
