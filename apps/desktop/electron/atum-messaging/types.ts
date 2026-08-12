export type ConnectivityState = 'loading' | 'online' | 'offline_cached' | 'reconnecting' | 'auth_expired' | 'error'

export type MutationState = 'queued' | 'sending' | 'sent' | 'failed_retryable' | 'failed_terminal' | 'conflicted'

export interface MessagingConversation {
  id: string
  title: string | null
  kind: string
  participantIds: string[]
  updatedAt: string
  lastMessageAt: string | null
  unreadCount: number
  payload: Record<string, unknown>
}

export interface CanonicalMessage {
  id: string
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
}

export interface StoredMessage extends Omit<CanonicalMessage, 'id'> {
  localId: string
  id: string | null
  clientMessageId: string | null
  optimistic: boolean
}

export interface ConversationDraft {
  text: string
  replyToMessageId: string | null
  attachmentIds: string[]
  revision: number
  updatedAt: string
}

export interface SaveDraftInput {
  text: string
  replyToMessageId?: string | null
  attachmentIds?: string[]
}

export interface QueueSendInput {
  conversationId: string
  clientMessageId: string
  content: string
  locale: string
  replyToMessageId?: string | null
  attachmentIds?: string[]
  now?: string
}

export interface PendingMutation {
  id: string
  kind: 'send_message'
  conversationId: string
  clientMessageId: string
  request: {
    client_message_id: string
    content: string
    locale: string
    reply_to_message_id: string | null
    attachment_ids: string[]
  }
  state: MutationState
  attemptCount: number
  nextAttemptAt: string | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}

export interface MutationFailure {
  code: string
  retryable: boolean
  retryAt?: string | null
  conflicted?: boolean
  now?: string
}

export interface CanonicalizeMessageInput {
  clientMessageId?: string | null
  message: CanonicalMessage
  incrementUnread?: boolean
  now?: string
}

export interface SyncCursor {
  cursor: string | null
  updatedAt: string | null
}

export interface MessagingStoreBoundary {
  readonly accountId: string
  close(): void
  upsertConversation(conversation: Omit<MessagingConversation, 'unreadCount'>): void
  listConversations(limit?: number): MessagingConversation[]
  listMessages(conversationId: string, limit?: number): StoredMessage[]
  saveDraft(conversationId: string, draft: SaveDraftInput, now?: string): ConversationDraft
  getDraft(conversationId: string): ConversationDraft | null
  queueSend(input: QueueSendInput): PendingMutation
  markMutationSending(clientMessageId: string, now?: string): PendingMutation
  markMutationFailed(clientMessageId: string, failure: MutationFailure): PendingMutation
  listDueMutations(now?: string, limit?: number): PendingMutation[]
  canonicalizeMessage(input: CanonicalizeMessageInput): StoredMessage
  markRead(conversationId: string, throughMessageId: string, now?: string): boolean
  getSyncCursor(): SyncCursor
  commitSyncCursor(expectedCursor: string | null, nextCursor: string, now?: string): boolean
  recordSyncChange(changeId: string, now?: string): boolean
  resetProjection(): void
}

export interface OpenMessagingStoreOptions {
  accountId: string
  databasePath: string
}
