import { useStore } from '@nanostores/react'
import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { SETTINGS_ROUTE } from '@/app/routes'
import { StatusDot, type StatusTone } from '@/components/status-dot'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $atumAccountStatus, $atumConnectivity } from '@/store/atum-messaging'
import { $railDestination } from '@/store/atum-shell'

import { AtumAccountDialog } from './account-menu'

const RAIL_BUTTON = 'flex size-8 items-center justify-center rounded-[var(--atum-r-control)] transition-colors'

function connectivityTone(connectivity: string): StatusTone | null {
  if (connectivity === 'offline_cached' || connectivity === 'reconnecting') {
    return 'warn'
  }

  if (connectivity === 'error' || connectivity === 'auth_expired') {
    return 'bad'
  }

  return null
}

/**
 * The one fixed rail. Bare on the desk — no plate, no hairline — with exactly
 * four interactive elements: account, chat, devices (disabled), settings.
 *
 * Devices is present but genuinely disabled: `aria-disabled`, no `onClick`, no
 * pairing UI, no device names. Rendering a control that promises a capability
 * we do not have would be the dishonest option; hiding it entirely would make
 * the affordance appear from nowhere in P1. It stays focusable so its tooltip
 * is reachable by keyboard.
 *
 * Keyboard: the rail is one tab stop group with a roving tabindex — ↑/↓ move
 * between buttons, Home/End jump to the ends.
 */
export function AtumRail() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const destination = useStore($railDestination)
  const connectivity = useStore($atumConnectivity)
  const account = useStore($atumAccountStatus)
  const navRef = useRef<HTMLElement>(null)
  const tone = connectivityTone(connectivity)
  const accountLabel = account.account?.displayName || account.account?.handle || ''
  const accountInitial = account.account ? accountLabel.trim().charAt(0).toLocaleUpperCase() || null : null

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'End', 'Home']

    if (!keys.includes(event.key)) {
      return
    }

    const items = Array.from(navRef.current?.querySelectorAll<HTMLElement>('[data-rail-item]') ?? [])

    if (items.length === 0) {
      return
    }

    const current = items.findIndex(item => item === document.activeElement)

    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(items.length - 1, current + 1)
            : Math.max(0, current - 1)

    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <nav
      aria-label={t.atum.nav.aria}
      className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 py-1.5 [-webkit-app-region:no-drag]"
      onKeyDown={onKeyDown}
      ref={navRef}
    >
      <AtumAccountDialog>
        <button
          aria-label={t.atum.nav.account}
          className="relative mb-1 grid size-[30px] place-items-center rounded-full border border-(--atum-line-strong) bg-(--atum-card) text-[length:var(--conversation-text-font-size)] font-semibold text-(--atum-ink) shadow-(--atum-shadow-tile) transition-colors hover:bg-(--atum-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--atum-focus)"
          data-rail-item
          type="button"
        >
          {accountInitial ? <span aria-hidden>{accountInitial}</span> : <Codicon name="account" size="1rem" />}
          {tone && <StatusDot className="absolute -bottom-0.5 -right-0.5" tone={tone} />}
        </button>
      </AtumAccountDialog>

      <Tip label={t.atum.nav.chat} side="right">
        <button
          aria-current={destination === 'chat' ? 'page' : undefined}
          aria-label={t.atum.nav.chat}
          className={cn(
            RAIL_BUTTON,
            destination === 'chat'
              ? 'bg-(--atum-pressed) text-(--atum-ink)'
              : 'text-(--atum-ink-muted) hover:bg-(--atum-hover)'
          )}
          data-rail-item
          onClick={() => $railDestination.set('chat')}
          type="button"
        >
          <Codicon name="comment-discussion" size="1rem" />
        </button>
      </Tip>

      <Tip label={t.atum.nav.devicesSoon} side="right">
        <button
          aria-disabled="true"
          aria-label={t.atum.nav.devices}
          className={cn(RAIL_BUTTON, 'cursor-default text-(--atum-ink-faint) opacity-60')}
          data-rail-item
          type="button"
        >
          <Codicon name="device-desktop" size="1rem" />
        </button>
      </Tip>

      <Tip label={t.atum.nav.settings} side="right">
        <button
          aria-label={t.atum.nav.settings}
          className={cn(RAIL_BUTTON, 'mt-auto text-(--atum-ink-muted) hover:bg-(--atum-hover)')}
          data-rail-item
          onClick={() => navigate(SETTINGS_ROUTE)}
          type="button"
        >
          <Codicon name="settings-gear" size="1rem" />
        </button>
      </Tip>
    </nav>
  )
}
