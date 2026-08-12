import { useStore } from '@nanostores/react'
import { useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $atumAccountStatus, $atumSortedRoster } from '@/store/atum-messaging'
import { $rosterQuery, setRosterQuery } from '@/store/atum-shell'
import { $activeSessionId } from '@/store/session'

import { type AtumRosterEntry, buildAtumRoster, filterRoster } from './roster'

interface AtumRosterPanelProps {
  /** Compact presentations render the roster as a drawer over the chat. */
  compact?: boolean
  onNavigated?: () => void
}

/**
 * The roster plate: title, search at the top, rows. One list of conversations —
 * the local Atum assistant plus hosted Atum DMs. No section headers, no group
 * toggles, no pins, no drag handles, no split menu. Those are Hermes
 * organisation and the Atum product does not have them.
 */
export function AtumRosterPanel({ compact = false, onNavigated }: AtumRosterPanelProps) {
  const { t } = useI18n()
  const query = useStore($rosterQuery)
  const conversations = useStore($atumSortedRoster)
  const account = useStore($atumAccountStatus)
  const activeSessionId = useStore($activeSessionId)
  const location = useLocation()
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const dmsAvailable = account.state === 'signed_in' || account.state === 'refreshing'

  const entries = useMemo(
    () =>
      buildAtumRoster({
        activeSessionId,
        assistantHint: t.atum.roster.assistantHint,
        assistantTitle: t.atum.roster.assistant,
        conversations,
        dmsAvailable
      }),
    [activeSessionId, conversations, dmsAvailable, t.atum.roster.assistant, t.atum.roster.assistantHint]
  )

  const visible = useMemo(() => filterRoster(entries, query), [entries, query])

  // A search field over a one-row list is noise (DESIGN.md: empty lists hide
  // their search). It stays visible once a query is typed so the no-match state
  // has a way out.
  const showSearch = entries.length > 1 || query.length > 0

  const open = (entry: AtumRosterEntry) => {
    navigate(entry.route)
    onNavigated?.()
  }

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-roster-row]') ?? [])
    const current = rows.findIndex(row => row === document.activeElement)
    const next =
      event.key === 'ArrowDown' ? Math.min(rows.length - 1, current + 1) : Math.max(0, current - 1)

    event.preventDefault()
    rows[next]?.focus()
  }

  return (
    <aside
      className={cn(
        'atum-plate flex w-[274px] shrink-0 flex-col overflow-hidden [-webkit-app-region:no-drag]',
        compact && 'absolute inset-y-0 left-0 z-30 w-[274px] shadow-(--atum-shadow-chat)'
      )}
      data-atum-roster
    >
      <h1 className="px-[18px] pb-2 pt-[18px] text-[16px] font-semibold tracking-[-0.02em] text-(--atum-ink)">
        {t.atum.roster.title}
      </h1>

      {showSearch && (
        <div className="px-[18px] pb-2.5">
          <SearchField
            aria-label={t.atum.roster.search}
            containerClassName="w-full"
            inputRef={searchRef}
            onChange={setRosterQuery}
            placeholder={t.atum.roster.search}
            value={query}
          />
        </div>
      )}

      {/* Result count is announced, not drawn — the list itself is the answer. */}
      <span aria-live="polite" className="sr-only">
        {query ? t.atum.roster.results(visible.length) : ''}
      </span>

      {/* No `role="list"`: overriding the rows' roles would cost them their
          button semantics, and the rows ARE the interaction. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5" onKeyDown={onListKeyDown} ref={listRef}>
        {visible.length === 0 ? (
          <div className="grid min-h-32 place-items-center px-3 text-center">
            <div>
              <div className="text-sm font-medium text-(--atum-ink)">{t.atum.roster.emptySearch}</div>
              <div className="mt-1 text-xs text-(--atum-ink-muted)">{t.atum.roster.emptySearchHint}</div>
            </div>
          </div>
        ) : (
          visible.map(entry => (
            <AtumRosterRow
              active={location.pathname === entry.route}
              entry={entry}
              key={entry.id}
              onOpen={() => open(entry)}
              unreadLabel={t.atum.roster.unread}
            />
          ))
        )}
      </div>
    </aside>
  )
}

function AtumRosterRow({
  active,
  entry,
  onOpen,
  unreadLabel
}: {
  active: boolean
  entry: AtumRosterEntry
  onOpen: () => void
  unreadLabel: (count: number) => string
}) {
  const label = entry.unreadCount > 0 ? `${entry.title}, ${unreadLabel(entry.unreadCount)}` : entry.title

  return (
    <button
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={cn(
        'flex min-h-[52px] w-full items-center gap-[11px] rounded-[var(--atum-r-row)] px-2.5 py-[9px] text-left transition-colors',
        // Selection is a LIFT, not a highlight bar.
        active ? 'bg-(--atum-card) shadow-(--atum-shadow-row)' : 'hover:bg-(--atum-hover)'
      )}
      data-roster-row
      onClick={onOpen}
      type="button"
    >
      <span
        aria-hidden="true"
        className="grid size-[34px] shrink-0 place-items-center rounded-full bg-(--atum-sunk) text-[13px] font-semibold text-(--atum-ink-soft)"
      >
        {entry.title.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-(--atum-ink)">{entry.title}</span>
        {entry.preview && (
          <span className="block truncate text-[11px] text-(--atum-ink-muted)">{entry.preview}</span>
        )}
      </span>
      {entry.unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-(--atum-ink) px-1 text-[10px] font-medium text-(--atum-card)"
        >
          {entry.unreadCount}
        </span>
      )}
    </button>
  )
}
