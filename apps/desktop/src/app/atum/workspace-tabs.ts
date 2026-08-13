/**
 * Which workspace tabs the CURRENT conversation can actually offer.
 *
 * The real Hermes file pane is always available and owns its honest no-folder
 * state. Preview and conversation details remain capability-derived.
 */

import type { AtumWorkspaceTab } from '@/store/atum-shell'

export interface WorkspaceCapability {
  /** A preview target exists (tool result, file click, preview server). */
  hasPreview: boolean
  /** The foreground conversation is a hosted Atum DM. */
  isDm: boolean
}

export function availableWorkspaceTabs(capability: WorkspaceCapability): AtumWorkspaceTab[] {
  const tabs: AtumWorkspaceTab[] = []

  if (capability.hasPreview) {
    tabs.push('view')
  }

  tabs.push('files')

  if (capability.isDm) {
    tabs.push('details')
  }

  return tabs
}

/** Resolve the tab to show: the user's choice when it is still available,
 *  otherwise the first available one. The files pane guarantees a result. */
export function resolveWorkspaceTab(
  preferred: AtumWorkspaceTab,
  available: readonly AtumWorkspaceTab[]
): AtumWorkspaceTab {
  if (available.includes(preferred)) {
    return preferred
  }

  return available[0] ?? 'files'
}
