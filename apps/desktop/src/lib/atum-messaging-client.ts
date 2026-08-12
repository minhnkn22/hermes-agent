export interface AtumMessagingConversation {
  id: string
  title: string | null
  kind: string
  participantIds: string[]
  updatedAt: string
  lastMessageAt: string | null
  unreadCount: number
  payload: Record<string, unknown>
}

export interface AtumMessagingMessage {
  localId: string
  id: string | null
  clientMessageId: string | null
  conversationId: string
  sender: { type: string; id: string }
  content: string
  kind: string
  attachments: unknown[]
  replyToMessageId: string | null
  forwardedFrom: unknown | null
  reactions: unknown[]
  version: number
  createdAt: string
  editedAt: string | null
  recalledAt: string | null
  delivery: string
  optimistic: boolean
}

export interface AtumMessagingDraft {
  text: string
  replyToMessageId: string | null
  attachmentIds: string[]
  revision: number
  updatedAt: string
}

export interface AtumMessagingSyncStatus {
  accountId: string | null
  connectivity: 'loading' | 'online' | 'offline_cached' | 'reconnecting' | 'auth_expired' | 'error'
  synchronized: boolean
  cursor: string | null
  lastSuccessfulSyncAt: string | null
  nextRetryAt: string | null
  errorCode: string | null
}

export interface AtumMessagingClient {
  status(): Promise<AtumMessagingSyncStatus>
  roster(limit?: number): Promise<AtumMessagingConversation[]>
  messages(conversationId: string, limit?: number): Promise<AtumMessagingMessage[]>
  draft(conversationId: string): Promise<AtumMessagingDraft | null>
  saveDraft(
    conversationId: string,
    draft: { text: string; replyToMessageId?: string | null; attachmentIds?: string[] }
  ): Promise<AtumMessagingDraft>
  send(input: {
    conversationId: string
    clientMessageId: string
    content: string
    locale: string
    replyToMessageId?: string | null
    attachmentIds?: string[]
  }): Promise<unknown>
  retry(clientMessageId: string): Promise<unknown>
  markRead(conversationId: string, throughMessageId: string): Promise<boolean>
  sync(): Promise<AtumMessagingSyncStatus>
}

/** Typed renderer model seam for WS4; all authority remains in Electron main. */
export function atumMessagingClient(): AtumMessagingClient {
  if (!window.hermesDesktop?.messaging) {
    throw new Error('Atum messaging is unavailable in this desktop runtime')
  }

  return window.hermesDesktop.messaging
}
