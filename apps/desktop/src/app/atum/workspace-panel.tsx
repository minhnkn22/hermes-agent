import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'

import { FilesPane, PreviewRailPane } from '@/app/contrib/panes'
import { Button } from '@/components/ui/button'
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $atumSortedRoster } from '@/store/atum-messaging'
import {
  $workspaceWidth,
  ATUM_WORKSPACE_MAX_WIDTH,
  ATUM_WORKSPACE_MIN_WIDTH,
  type AtumWorkspaceTab,
  setWorkspaceOpen,
  setWorkspaceTab,
  setWorkspaceWidth
} from '@/store/atum-shell'

import type { AtumWorkspaceState } from './use-workspace'

interface AtumWorkspacePanelProps {
  /** Drawer presentation (<1280px): overlays the chat, focus-trapped, Esc closes. */
  drawer?: boolean
  workspace: AtumWorkspaceState
}

/**
 * The right workspace plate. It keeps Hermes' modular capability rendering —
 * the REAL preview rail and the REAL file tree, not reimplementations — behind
 * a flattened, capability-derived tab set.
 *
 * Deliberately absent in P0: terminal, logs, review/diff, devtools/monitor
 * clusters, drag-to-rearrange, and layout presets. They still exist in the app
 * and stay reachable from ⌘K.
 */
export function AtumWorkspacePanel({ drawer = false, workspace }: AtumWorkspacePanelProps) {
  const { t } = useI18n()
  const width = useStore($workspaceWidth)
  const asideRef = useRef<HTMLElement>(null)
  const { activeTab, available } = workspace

  // Drawer presentation is modal-shaped: trap focus and restore it on close so
  // the toggle the user pressed gets focus back.
  useEffect(() => {
    if (!drawer) {
      return
    }

    const previous = document.activeElement as HTMLElement | null

    asideRef.current?.focus()

    return () => previous?.focus()
  }, [drawer])

  const options: Array<SegmentedControlOption<AtumWorkspaceTab>> = available.map(tab => ({
    id: tab,
    label: tab === 'view' ? t.atum.workspace.tabView : tab === 'files' ? t.atum.workspace.tabFiles : t.atum.workspace.tabDetails
  }))

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = $workspaceWidth.get()
    let frame = 0
    let pending = startWidth

    // Pointer work coalesces to one write per frame — a resize must never queue
    // a store write (and a full plate re-render) per pointermove event.
    const onMove = (move: PointerEvent) => {
      pending = startWidth + (startX - move.clientX)

      if (frame) {
        return
      }

      frame = requestAnimationFrame(() => {
        frame = 0
        setWorkspaceWidth(pending)
      })
    }

    const onUp = () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }

      setWorkspaceWidth(pending)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = $workspaceWidth.get()

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setWorkspaceWidth(current + 16)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setWorkspaceWidth(current - 16)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setWorkspaceWidth(ATUM_WORKSPACE_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWorkspaceWidth(ATUM_WORKSPACE_MAX_WIDTH)
    }
  }

  return (
    <aside
      aria-label={t.atum.workspace.title}
      className={cn(
        'atum-plate relative flex shrink-0 flex-col overflow-hidden [-webkit-app-region:no-drag]',
        drawer && 'absolute inset-y-0 right-0 z-30 shadow-(--atum-shadow-chat)'
      )}
      data-atum-workspace
      onKeyDown={event => {
        if (drawer && event.key === 'Escape') {
          event.preventDefault()
          setWorkspaceOpen(false)
        }
      }}
      ref={asideRef}
      style={{ width }}
      tabIndex={-1}
    >
      {!drawer && (
        <div
          aria-label={t.atum.workspace.resize}
          aria-orientation="vertical"
          aria-valuemax={ATUM_WORKSPACE_MAX_WIDTH}
          aria-valuemin={ATUM_WORKSPACE_MIN_WIDTH}
          aria-valuenow={width}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize"
          onKeyDown={onResizeKeyDown}
          onPointerDown={startResize}
          role="separator"
          tabIndex={0}
        />
      )}

      <header className="flex h-[44px] shrink-0 items-center gap-2 px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-(--atum-ink)">
          {t.atum.workspace.title}
        </span>
        <Tip label={t.atum.workspace.close}>
          <Button aria-label={t.atum.workspace.close} onClick={() => setWorkspaceOpen(false)} size="icon-xs" variant="ghost">
            <X />
          </Button>
        </Tip>
      </header>

      {options.length > 1 && activeTab && (
        <div className="px-3 pb-2">
          <SegmentedControl className="w-full" onChange={setWorkspaceTab} options={options} value={activeTab} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'view' && <PreviewRailPane />}
        {activeTab === 'files' && <FilesPane />}
        {activeTab === 'details' && <AtumConversationDetails conversationId={workspace.dmConversationId} />}
        {!activeTab && (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-(--atum-ink-muted)">
            {t.atum.workspace.empty}
          </div>
        )}
      </div>
    </aside>
  )
}

function AtumConversationDetails({ conversationId }: { conversationId: null | string }) {
  const { t } = useI18n()
  const roster = useStore($atumSortedRoster)
  const conversation = roster.find(entry => entry.id === conversationId)

  if (!conversation) {
    return (
      <div className="grid h-full place-items-center px-4 text-center text-xs text-(--atum-ink-muted)">
        {t.atum.workspace.empty}
      </div>
    )
  }

  return (
    <dl className="space-y-3 px-3 py-2 text-xs">
      <div>
        <dt className="text-(--atum-ink-muted)">{t.atum.workspace.detailsConversation}</dt>
        <dd className="mt-0.5 truncate text-(--atum-ink)">{conversation.title ?? conversation.id}</dd>
      </div>
      <div>
        <dt className="text-(--atum-ink-muted)">{t.atum.workspace.detailsParticipants}</dt>
        <dd className="mt-0.5 text-(--atum-ink)">{conversation.participantIds.join(', ')}</dd>
      </div>
      <div>
        <dt className="text-(--atum-ink-muted)">{t.atum.workspace.detailsUpdated}</dt>
        <dd className="mt-0.5 text-(--atum-ink)">{conversation.lastMessageAt ?? conversation.updatedAt}</dd>
      </div>
    </dl>
  )
}
