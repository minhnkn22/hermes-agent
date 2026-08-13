import { useStore } from '@nanostores/react'
import { useLocation } from 'react-router-dom'

import { routeDmConversationId } from '@/app/routes'
import type { AtumWorkspaceTab } from '@/store/atum-shell'
import { $workspaceTab } from '@/store/atum-shell'
import { $filePreviewTarget, $previewTarget } from '@/store/preview'

import { availableWorkspaceTabs, resolveWorkspaceTab } from './workspace-tabs'

export interface AtumWorkspaceState {
  available: AtumWorkspaceTab[]
  /** The tab actually shown. Atum's consumer files pane is always available. */
  activeTab: AtumWorkspaceTab
  /** The DM conversation id when the foreground conversation is a hosted DM. */
  dmConversationId: null | string
}

/**
 * Live workspace capability for the foreground conversation. Reading the
 * preview atoms here is a capability check, not a trigger — nothing in this
 * hook opens the workspace. `$workspaceOpen` is only ever set by an explicit
 * user gesture (the rim toggle), which is what keeps a background tool result
 * from stealing the layout.
 */
export function useAtumWorkspace(): AtumWorkspaceState {
  const previewTarget = useStore($previewTarget)
  const filePreviewTarget = useStore($filePreviewTarget)
  const preferred = useStore($workspaceTab)
  const location = useLocation()
  const dmConversationId = routeDmConversationId(location.pathname)

  const available = availableWorkspaceTabs({
    hasPreview: Boolean(previewTarget || filePreviewTarget),
    isDm: Boolean(dmConversationId)
  })

  return { activeTab: resolveWorkspaceTab(preferred, available), available, dmConversationId }
}
