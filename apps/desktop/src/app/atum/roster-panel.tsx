import { useStore } from '@nanostores/react'
import { useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ATUM_AUTH_ROUTE } from '@/app/routes'
import { BrandMark } from '@/components/brand-mark'
import { StatusDot } from '@/components/status-dot'
import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  $atumAccountStatus,
  $atumConnectivity,
  $atumSortedRoster,
  refreshAtumRoster,
  refreshAtumStatus
} from '@/store/atum-messaging'
import { $rosterQuery, setRosterQuery } from '@/store/atum-shell'
import { $activeSessionId } from '@/store/session'

import { ATUM_AVATAR_TINTS, type AtumRosterEntry, buildAtumRoster, filterRoster } from './roster'

interface AtumRosterPanelProps {
  /** Compact presentations render the roster as a drawer over the chat. */
  compact?: boolean
  onNavigated?: () => void
}

/**
 * The roster plate: search first, then the directory. The local Atum assistant
 * is its own class, followed by app chats and person-to-person chats. No
 * section collapse, no pins, no drag handles, no
 * split menu: those are Hermes organisation and the Atum product does not have
 * them.
 *
 * The hosted directory ALWAYS renders one honest state — signed-out explainer
 * with a way in, skeletons while the first sync runs, an error line with a
 * retry, or the real rows. A silently absent list is the one state that must
 * never ship again.
 */
export function AtumRosterPanel({ compact = false, onNavigated }: AtumRosterPanelProps) {
  const { locale, t } = useI18n()
  const query = useStore($rosterQuery)
  const conversations = useStore($atumSortedRoster)
  const account = useStore($atumAccountStatus)
  const connectivity = useStore($atumConnectivity)
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
        dmsAvailable,
        locale
      }),
    [activeSessionId, conversations, dmsAvailable, locale, t.atum.roster.assistant, t.atum.roster.assistantHint]
  )

  const visible = useMemo(() => filterRoster(entries, query), [entries, query])
  const searching = query.trim().length > 0
  const assistantEntries = visible.filter(entry => entry.kind === 'assistant')
  const appEntries = visible.filter(entry => entry.kind === 'app')
  const directEntries = visible.filter(entry => entry.kind === 'direct')
  const hostedEntries = [...appEntries, ...directEntries]

  const open = (entry: AtumRosterEntry) => {
    navigate(entry.route)
    onNavigated?.()
  }

  const retry = () => {
    void refreshAtumStatus()
    void refreshAtumRoster()
  }

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-roster-row]') ?? [])
    const current = rows.findIndex(row => row === document.activeElement)
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, current + 1) : Math.max(0, current - 1)

    event.preventDefault()
    rows[next]?.focus()
  }

  const renderRow = (entry: AtumRosterEntry) => (
    <AtumRosterRow
      active={location.pathname === entry.route}
      entry={entry}
      key={entry.id}
      onOpen={() => open(entry)}
      unreadLabel={t.atum.roster.unread}
    />
  )

  // The hosted directory state, exactly one of four. Skeletons only stand in
  // for the FIRST sync — once rows exist they stay on screen while refreshing.
  const hostedState: 'error' | 'loading' | 'rows' | 'signedOut' | 'empty' = !dmsAvailable
    ? 'signedOut'
    : hostedEntries.length > 0
      ? 'rows'
      : connectivity === 'error'
        ? 'error'
        : connectivity === 'loading'
          ? 'loading'
          : 'empty'

  return (
    <aside
      className={cn(
        'atum-plate flex w-[274px] shrink-0 flex-col overflow-hidden [-webkit-app-region:no-drag]',
        compact && 'absolute inset-y-0 left-0 z-30 w-[274px] shadow-(--atum-shadow-chat)'
      )}
      data-atum-roster
    >
      <h1 className="sr-only">{t.atum.roster.title}</h1>
      <div className="px-3 pb-2 pt-3">
        <SearchField
          aria-label={t.atum.roster.search}
          containerClassName="w-full rounded-[var(--atum-r-control)] border-none bg-(--atum-sunk) px-2 !opacity-100 focus-within:ring-2 focus-within:ring-(--atum-focus)"
          inputClassName="flex-1"
          inputRef={searchRef}
          onChange={setRosterQuery}
          placeholder={t.atum.roster.search}
          value={query}
        />
      </div>

      {/* Result count is announced, not drawn — the list itself is the answer. */}
      <span aria-live="polite" className="sr-only">
        {query ? t.atum.roster.results(visible.length) : ''}
      </span>

      {/* No `role="list"`: overriding the rows' roles would cost them their
          button semantics, and the rows ARE the interaction. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onKeyDown={onListKeyDown} ref={listRef}>
        {searching && visible.length === 0 ? (
          <div className="grid min-h-32 place-items-center px-3 text-center">
            <div>
              <div className="text-sm font-medium text-(--atum-ink)">{t.atum.roster.emptySearch}</div>
              <div className="mt-1 text-xs text-(--atum-ink-muted)">{t.atum.roster.emptySearchHint}</div>
            </div>
          </div>
        ) : searching ? (
          visible.map(renderRow)
        ) : (
          <>
            <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--atum-ink-faint)">
              {t.atum.roster.groupAssistant}
            </p>
            {assistantEntries.map(renderRow)}

            {appEntries.length > 0 && (
              <>
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--atum-ink-faint)">
                  {t.atum.roster.groupApps}
                </p>
                <div data-roster-group="apps">{appEntries.map(renderRow)}</div>
              </>
            )}

            {directEntries.length > 0 && (
              <>
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--atum-ink-faint)">
                  {t.atum.roster.groupPeople}
                </p>
                <div data-roster-group="people">{directEntries.map(renderRow)}</div>
              </>
            )}

            <div data-roster-state="hosted">
              {hostedState === 'signedOut' && (
                <div className="px-3 py-2">
                  <p className="text-[12px] font-medium text-(--atum-ink)">{t.atum.roster.signedOutTitle}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-(--atum-ink-muted)">{t.atum.roster.signedOutBody}</p>
                  <button
                    className="mt-1.5 text-[12px] font-medium text-(--atum-ink) underline decoration-(--atum-line-strong) underline-offset-2 hover:decoration-(--atum-ink-muted)"
                    onClick={() => navigate(ATUM_AUTH_ROUTE)}
                    type="button"
                  >
                    {t.atum.roster.signIn}
                  </button>
                </div>
              )}

              {hostedState === 'loading' && (
                <div aria-hidden="true" className="space-y-1 px-1 py-1">
                  {[0, 1, 2].map(index => (
                    <div className="flex h-14 items-center gap-[11px] px-2" key={index}>
                      <div className="size-[34px] shrink-0 animate-pulse rounded-full bg-(--atum-sunk) opacity-60 motion-reduce:animate-none" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="h-2.5 w-2/5 animate-pulse rounded-full bg-(--atum-sunk) opacity-60 motion-reduce:animate-none" />
                        <div className="h-2 w-3/5 animate-pulse rounded-full bg-(--atum-sunk) opacity-60 motion-reduce:animate-none" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {hostedState === 'error' && (
                <div className="flex items-center gap-2 px-3 py-2">
                  <p className="min-w-0 flex-1 text-[12px] text-(--atum-ink-muted)">{t.atum.roster.loadFailed}</p>
                  <button
                    className="shrink-0 text-[12px] font-medium text-(--atum-ink) underline decoration-(--atum-line-strong) underline-offset-2 hover:decoration-(--atum-ink-muted)"
                    onClick={retry}
                    type="button"
                  >
                    {t.atum.roster.retry}
                  </button>
                </div>
              )}

              {hostedState === 'empty' && (
                <p className="px-3 py-2 text-[12px] text-(--atum-ink-muted)">{t.atum.roster.emptyChats}</p>
              )}
            </div>
          </>
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
  const line2 = entry.role || entry.preview
  const activityMs = entry.activityAt ? Date.parse(entry.activityAt) : Number.NaN

  return (
    <button
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={cn(
        'flex h-14 w-full items-center gap-[11px] rounded-[var(--atum-r-row)] px-2.5 py-2 text-left transition-colors',
        // Selection is a LIFT, not a highlight bar.
        active ? 'bg-(--atum-card) shadow-(--atum-shadow-row)' : 'hover:bg-(--atum-hover)'
      )}
      data-roster-row
      onClick={onOpen}
      type="button"
    >
      <span className="relative shrink-0">
        {entry.kind === 'assistant' ? (
          <BrandMark className="size-[34px] rounded-[var(--atum-r-tile)]" />
        ) : entry.avatarUrl ? (
          <img alt="" className="size-[34px] rounded-full object-cover" src={entry.avatarUrl} />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-[34px] place-items-center rounded-full text-[13px] font-semibold text-(--atum-ink-soft)"
            style={{
              background: `color-mix(in srgb, var(--ui-accent) ${ATUM_AVATAR_TINTS[entry.avatarTint]}%, var(--atum-sunk))`
            }}
          >
            {entry.title.slice(0, 1).toUpperCase()}
          </span>
        )}
        {/* Presence belongs to hosted rows only, and only when the
            hosted row actually reports it — never faked, never on the local
            assistant. */}
        {entry.presence === 'online' && (
          <StatusDot className="absolute right-0 bottom-0 size-[9px] ring-2 ring-(--atum-panel)" tone="good" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-(--atum-ink)">{entry.title}</span>
        {line2 && <span className="block truncate text-[11px] text-(--atum-ink-muted)">{line2}</span>}
      </span>
      {entry.unreadCount > 0 ? (
        <span
          aria-hidden="true"
          className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-(--atum-ink) px-1 text-[10px] font-medium text-(--atum-card)"
        >
          {entry.unreadCount}
        </span>
      ) : (
        Number.isFinite(activityMs) && (
          <span aria-hidden="true" className="shrink-0 text-[11px] text-(--atum-ink-faint)">
            {relativeTime(activityMs)}
          </span>
        )
      )}
    </button>
  )
}
