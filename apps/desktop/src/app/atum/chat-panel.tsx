import { useStore } from '@nanostores/react'

import { WiredPane } from '@/app/contrib/context'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $atumConnectivity } from '@/store/atum-messaging'
import { $workspaceOpen, toggleWorkspace } from '@/store/atum-shell'

import type { AtumWorkspaceState } from './use-workspace'

interface AtumChatPanelProps {
  /** Only rendered below the compact breakpoint, where the roster is a drawer. */
  onToggleRoster?: () => void
  rosterOpen?: boolean
  title: string
  workspace: AtumWorkspaceState
}

/**
 * The chat plate — the product centre, and the only plate that carries
 * `--atum-shadow-chat`.
 *
 * The top rim is one row: identity on the left, ONE control on the right.
 * Everything the Hermes titlebar used to stack there (model pill, approval-mode
 * menu, context usage, gateway menu, session dropdown, pin, split, flip,
 * haptics, keybinds, settings gear, sidebar toggles) is not deleted — it lives
 * in the account menu, Settings, and the ⌘K palette, which stay registered.
 *
 * The BODY is `WiredPane part="chatRoutes"` — the same assistant-ui transcript,
 * tool cards, approvals, and DM view the Hermes shell renders. There is exactly
 * one transcript renderer in this app and this is not a second one.
 */
export function AtumChatPanel({ onToggleRoster, rosterOpen = false, title, workspace }: AtumChatPanelProps) {
  const { t } = useI18n()
  const workspaceOpen = useStore($workspaceOpen)
  const connectivity = useStore($atumConnectivity)
  const workspaceAvailable = workspace.available.length > 0

  const offlineCopy =
    connectivity === 'offline_cached'
      ? t.atum.offline.banner
      : connectivity === 'reconnecting'
        ? t.atum.offline.reconnecting
        : null

  return (
    <section className="atum-plate-chat relative flex min-w-0 flex-1 flex-col overflow-hidden [-webkit-app-region:no-drag]">
      <header className="atum-chat-header flex h-[60px] shrink-0 items-center gap-2.5 px-[18px]">
        {onToggleRoster && (
          <Tip label={rosterOpen ? t.atum.chat.closeRoster : t.atum.chat.openRoster}>
            <Button
              aria-expanded={rosterOpen}
              aria-label={rosterOpen ? t.atum.chat.closeRoster : t.atum.chat.openRoster}
              onClick={onToggleRoster}
              size="icon-sm"
              variant="ghost"
            >
              <Codicon name="list-unordered" size="1rem" />
            </Button>
          </Tip>
        )}

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-(--atum-ink)">{title}</span>

        <Tip label={workspaceAvailable ? (workspaceOpen ? t.atum.workspace.close : t.atum.workspace.open) : t.atum.workspace.none}>
          {/* Stays visible even when unavailable: an affordance that vanishes
              teaches the user nothing about why. */}
          <Button
            aria-disabled={!workspaceAvailable}
            aria-label={workspaceOpen ? t.atum.workspace.close : t.atum.workspace.open}
            aria-pressed={workspaceOpen}
            className={cn(!workspaceAvailable && 'cursor-default opacity-50')}
            onClick={workspaceAvailable ? toggleWorkspace : undefined}
            size="icon-sm"
            variant="ghost"
          >
            <Codicon name="layout-sidebar-right" size="1rem" />
          </Button>
        </Tip>
      </header>

      {/* Cached content never renders without saying so. */}
      {offlineCopy && (
        <p
          className="shrink-0 border-b border-(--atum-line) px-[18px] py-1.5 text-[11px] text-(--atum-ink-soft)"
          role="status"
        >
          {offlineCopy}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <WiredPane part="chatRoutes" />
      </div>
    </section>
  )
}
