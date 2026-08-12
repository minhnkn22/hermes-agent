import { useStore } from '@nanostores/react'

import { WiredPane } from '@/app/contrib/context'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { $atumConnectivity } from '@/store/atum-messaging'

interface AtumChatPanelProps {
  /** Only rendered below the compact breakpoint, where the roster is a drawer. */
  onToggleRoster?: () => void
  rosterOpen?: boolean
  /** Muted second line under the title (specialist role / assistant hint). */
  subtitle?: string
  title: string
}

/**
 * The chat plate — the product centre, and the only plate that carries
 * `--atum-shadow-chat`.
 *
 * The header is a CONVERSATION header, not a product header: identity (title +
 * one quiet line) on the left, the roster toggle on the left edge in compact
 * only. Product identity and the workspace toggle live in the rim; everything
 * the Hermes titlebar used to stack (model pill, approval-mode menu, context
 * usage, gateway menu, session dropdown, pin, split, flip, haptics, keybinds,
 * settings gear, sidebar toggles) lives in the account menu, Settings, and the
 * ⌘K palette, which stay registered.
 *
 * The BODY is `WiredPane part="chatRoutes"` — the same assistant-ui transcript,
 * tool cards, approvals, and DM view the Hermes shell renders. There is exactly
 * one transcript renderer in this app and this is not a second one.
 */
export function AtumChatPanel({ onToggleRoster, rosterOpen = false, subtitle = '', title }: AtumChatPanelProps) {
  const { t } = useI18n()
  const connectivity = useStore($atumConnectivity)

  const offlineCopy =
    connectivity === 'offline_cached'
      ? t.atum.offline.banner
      : connectivity === 'reconnecting'
        ? t.atum.offline.reconnecting
        : null

  return (
    <section className="atum-plate-chat relative flex min-w-0 flex-1 flex-col overflow-hidden [-webkit-app-region:no-drag]">
      <header className="atum-chat-header flex h-[44px] shrink-0 items-center gap-2.5 px-3">
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

        <span className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-[13px] font-semibold leading-4 text-(--atum-ink)">{title}</span>
          {subtitle && <span className="truncate text-[11px] leading-3.5 text-(--atum-ink-muted)">{subtitle}</span>}
        </span>
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
