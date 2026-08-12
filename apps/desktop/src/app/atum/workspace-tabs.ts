/**
 * Which workspace tabs the CURRENT conversation can actually offer.
 *
 * Tabs are derived from live capability, never rendered-and-disabled: a tab
 * whose capability is absent is not rendered at all, so the workspace never
 * shows a door that opens onto nothing. When zero tabs qualify, the chat rim's
 * workspace toggle is the disabled affordance instead — one honest dead end,
 * not three.
 */

import type { AtumWorkspaceTab } from '@/store/atum-shell'

export interface WorkspaceCapability {
  /** A preview target exists (tool result, file click, preview server). */
  hasPreview: boolean
  /** A workspace cwd is set, so the file tree has something to show. */
  hasCwd: boolean
  /** The foreground conversation is a hosted Atum DM. */
  isDm: boolean
}

export function availableWorkspaceTabs(capability: WorkspaceCapability): AtumWorkspaceTab[] {
  const tabs: AtumWorkspaceTab[] = []

  if (capability.hasPreview) {
    tabs.push('view')
  }

  if (capability.hasCwd) {
    tabs.push('files')
  }

  if (capability.isDm) {
    tabs.push('details')
  }

  return tabs
}

/** Resolve the tab to show: the user's choice when it is still available,
 *  otherwise the first available one. Returns null when nothing qualifies. */
export function resolveWorkspaceTab(
  preferred: AtumWorkspaceTab,
  available: readonly AtumWorkspaceTab[]
): AtumWorkspaceTab | null {
  if (available.includes(preferred)) {
    return preferred
  }

  return available[0] ?? null
}
