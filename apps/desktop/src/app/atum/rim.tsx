import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { $workspaceOpen, toggleWorkspace } from '@/store/atum-shell'

interface AtumRimProps {
  /** Where content may start so the macOS traffic lights stay clear. */
  controlsLeft: number
  /** Reserved width on the right for native Windows/Linux overlay controls. */
  nativeOverlayWidth: number
  /** Compact-only roster door; wide layouts already keep the roster visible. */
  onToggleRoster?: () => void
  rosterOpen?: boolean
  /** The foreground conversation, rendered once in the native title band. */
  title: string
}

/**
 * The Atum top rim — macOS/Hermes geometry with Atum-only contents. The
 * foreground conversation sits left and the workspace toggle sits right; the
 * compact roster door joins the title when needed. It is a drag region, while
 * every interactive control opts out.
 *
 * Never restored here (they are Hermes organisation surfaces, not product):
 * session dropdown, profile switcher, project/worktree picker, pin, split,
 * flip, pane-tree toggles, model pill, approval-mode menu, context-usage
 * meter, gateway menu, tool clusters. Those stay in the account menu,
 * Settings, and ⌘K.
 */
export function AtumRim({ controlsLeft, nativeOverlayWidth, onToggleRoster, rosterOpen = false, title }: AtumRimProps) {
  const { t } = useI18n()
  const workspaceOpen = useStore($workspaceOpen)

  return (
    <header
      className="atum-rim flex w-full shrink-0 items-center gap-2 [-webkit-app-region:drag]"
      data-atum-rim
      style={{
        paddingLeft: `${Math.max(78, controlsLeft + 12)}px`,
        paddingRight: `${Math.max(12, nativeOverlayWidth + 12)}px`
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5 select-none">
        {onToggleRoster && (
          <Tip label={rosterOpen ? t.atum.chat.closeRoster : t.atum.chat.openRoster}>
            <Button
              aria-expanded={rosterOpen}
              aria-label={rosterOpen ? t.atum.chat.closeRoster : t.atum.chat.openRoster}
              className="[-webkit-app-region:no-drag]"
              onClick={onToggleRoster}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="list-unordered" size="0.875rem" />
            </Button>
          </Tip>
        )}
        <span className="truncate text-[12px] font-medium tracking-[-0.005em] text-(--atum-ink)">{title}</span>
      </span>

      <span className="flex-1" />

      <span className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
        <Tip label={workspaceOpen ? t.atum.workspace.close : t.atum.workspace.open}>
          <Button
            aria-label={workspaceOpen ? t.atum.workspace.close : t.atum.workspace.open}
            aria-pressed={workspaceOpen}
            className="rounded-[var(--atum-r-control)]"
            onClick={toggleWorkspace}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="layout-sidebar-right" size="1rem" />
          </Button>
        </Tip>
      </span>
    </header>
  )
}
