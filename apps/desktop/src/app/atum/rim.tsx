import { useStore } from '@nanostores/react'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $workspaceOpen, toggleWorkspace } from '@/store/atum-shell'

import type { AtumWorkspaceState } from './use-workspace'

interface AtumRimProps {
  /** Where content may start so the macOS traffic lights stay clear. */
  controlsLeft: number
  /** Reserved width on the right for native Windows/Linux overlay controls. */
  nativeOverlayWidth: number
  workspace: AtumWorkspaceState
}

/**
 * The Atum top rim — macOS/Hermes GEOMETRY with Atum-only contents. One brand
 * lockup on the left and the workspace toggle on the right. It is a drag
 * region, so the whole band moves the window; only the control opts out.
 *
 * Never restored here (they are Hermes organisation surfaces, not product):
 * session dropdown, profile switcher, project/worktree picker, pin, split,
 * flip, pane-tree toggles, model pill, approval-mode menu, context-usage
 * meter, gateway menu, tool clusters. Those stay in the account menu,
 * Settings, and ⌘K.
 */
export function AtumRim({ controlsLeft, nativeOverlayWidth, workspace }: AtumRimProps) {
  const { t } = useI18n()
  const workspaceOpen = useStore($workspaceOpen)
  const workspaceAvailable = workspace.available.length > 0

  return (
    <header
      className="atum-rim flex w-full shrink-0 items-center gap-2 [-webkit-app-region:drag]"
      data-atum-rim
      style={{
        paddingLeft: `${Math.max(78, controlsLeft + 12)}px`,
        paddingRight: `${Math.max(12, nativeOverlayWidth + 12)}px`
      }}
    >
      <span className="flex min-w-0 items-center gap-2 select-none">
        <BrandMark className="size-[18px] rounded-[5px]" />
        <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-(--atum-ink)">
          {t.atum.roster.assistant}
        </span>
      </span>

      <span className="flex-1" />

      <span className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
        <Tip
          label={workspaceAvailable ? (workspaceOpen ? t.atum.workspace.close : t.atum.workspace.open) : t.atum.workspace.none}
        >
          {/* Stays visible even when unavailable: an affordance that vanishes
              teaches the user nothing about why. */}
          <Button
            aria-disabled={!workspaceAvailable}
            aria-label={workspaceOpen ? t.atum.workspace.close : t.atum.workspace.open}
            aria-pressed={workspaceOpen}
            className={cn('rounded-[var(--atum-r-control)]', !workspaceAvailable && 'cursor-default opacity-50')}
            onClick={workspaceAvailable ? toggleWorkspace : undefined}
            size="icon-sm"
            variant="ghost"
          >
            <Codicon name="layout-sidebar-right" size="1rem" />
          </Button>
        </Tip>

      </span>
    </header>
  )
}
