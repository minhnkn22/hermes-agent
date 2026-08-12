import type { CanonicalMessage, MessagingConversation, MessagingUser } from './types'

export interface DesktopErrorBody {
  error: {
    code: string
    message_key: string
    retryable: boolean
    request_id: string
    retry_after_ms?: number
    details?: Record<string, unknown>
  }
}

export interface DesktopSessionBody {
  user: MessagingUser
  syncCursor: string | null
  serverTime: string
}

export interface SyncChange {
  changeId: string
  entity: 'conversation' | 'participant' | 'message' | 'reaction' | 'read_state' | 'attachment'
  operation: 'upsert' | 'delete'
  entityId: string
  conversationId: string | null
  value: Record<string, unknown> | null
  occurredAt: string
}

export interface SyncPage {
  changes: SyncChange[]
  nextCursor: string
  hasMore: boolean
  serverTime: string
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid_response:${label}`)
  }

  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`invalid_response:${label}`)
  }

  return value
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label)
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`invalid_response:${label}`)
  }

  return value
}

export function parseDesktopError(value: unknown): DesktopErrorBody | null {
  try {
    const root = object(value, 'error_envelope')
    const error = object(root.error, 'error')

    if (
      typeof error.code !== 'string' ||
      typeof error.message_key !== 'string' ||
      typeof error.retryable !== 'boolean' ||
      typeof error.request_id !== 'string'
    ) {
      return null
    }

    return { error: error as DesktopErrorBody['error'] }
  } catch {
    return null
  }
}

export function parseDesktopSession(value: unknown): DesktopSessionBody {
  const root = object(value, 'session')
  const user = object(root.user, 'session.user')

  return {
    user: {
      id: string(user.id, 'session.user.id'),
      displayName: user.display_name === null ? null : string(user.display_name, 'session.user.display_name'),
      handle: user.handle === null ? null : string(user.handle, 'session.user.handle')
    },
    syncCursor: root.sync_cursor === null ? null : string(root.sync_cursor, 'session.sync_cursor'),
    serverTime: string(root.server_time, 'session.server_time')
  }
}

export function parseConversation(value: unknown): Omit<MessagingConversation, 'unreadCount'> {
  const row = object(value, 'conversation')

  const participants = array(row.participants, 'conversation.participants').map((participant, index) => {
    const projected = object(participant, `conversation.participants.${index}`)

    return string(projected.id, `conversation.participants.${index}.id`)
  })

  const updatedAt = string(row.updated_at, 'conversation.updated_at')

  return {
    id: string(row.id, 'conversation.id'),
    title: typeof row.specialist === 'string' ? row.specialist : null,
    kind: typeof row.specialist === 'string' && row.specialist ? 'specialist' : 'direct',
    participantIds: participants,
    updatedAt,
    lastMessageAt: updatedAt,
    payload: row
  }
}

export function parseCanonicalMessage(value: unknown): CanonicalMessage {
  const row = object(value, 'message')
  const sender = object(row.sender, 'message.sender')

  const version = Number(row.version)

  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('invalid_response:message.version')
  }

  return {
    id: string(row.id, 'message.id'),
    conversationId: string(row.conversation_id, 'message.conversation_id'),
    sender: { type: string(sender.type, 'message.sender.type'), id: string(sender.id, 'message.sender.id') },
    content: typeof row.content === 'string' ? row.content : '',
    kind: string(row.kind, 'message.kind'),
    attachments: array(row.attachments, 'message.attachments'),
    replyToMessageId: nullableString(row.reply_to_message_id, 'message.reply_to_message_id'),
    forwardedFrom: row.forwarded_from ?? null,
    reactions: array(row.reactions, 'message.reactions'),
    version,
    createdAt: string(row.created_at, 'message.created_at'),
    editedAt: nullableString(row.edited_at, 'message.edited_at'),
    recalledAt: nullableString(row.recalled_at, 'message.recalled_at'),
    delivery: string(row.delivery, 'message.delivery')
  }
}

export function parseSyncPage(value: unknown): SyncPage {
  const root = object(value, 'sync')
  const nextCursor = string(root.next_cursor, 'sync.next_cursor')

  const changes = array(root.changes, 'sync.changes').map((value, index): SyncChange => {
    const row = object(value, `sync.changes.${index}`)
    const entity = string(row.entity, `sync.changes.${index}.entity`) as SyncChange['entity']
    const operation = string(row.operation, `sync.changes.${index}.operation`) as SyncChange['operation']

    if (!['conversation', 'participant', 'message', 'reaction', 'read_state', 'attachment'].includes(entity)) {
      throw new Error(`invalid_response:sync.changes.${index}.entity`)
    }

    if (operation !== 'upsert' && operation !== 'delete') {
      throw new Error(`invalid_response:sync.changes.${index}.operation`)
    }

    return {
      changeId: string(row.change_id, `sync.changes.${index}.change_id`),
      entity,
      operation,
      entityId: string(row.entity_id, `sync.changes.${index}.entity_id`),
      conversationId:
        row.conversation_id === null ? null : string(row.conversation_id, `sync.changes.${index}.conversation_id`),
      value: row.value === null ? null : object(row.value, `sync.changes.${index}.value`),
      occurredAt: string(row.occurred_at, `sync.changes.${index}.occurred_at`)
    }
  })

  if (typeof root.has_more !== 'boolean') {
    throw new Error('invalid_response:sync.has_more')
  }

  return { changes, nextCursor, hasMore: root.has_more, serverTime: string(root.server_time, 'sync.server_time') }
}

export function parseConversationPage(value: unknown): { conversations: ReturnType<typeof parseConversation>[] } {
  const root = object(value, 'conversations')

  return { conversations: array(root.conversations, 'conversations.rows').map(parseConversation) }
}

export function parseMessagePage(value: unknown): { messages: CanonicalMessage[] } {
  const root = object(value, 'messages')

  return { messages: array(root.messages, 'messages.rows').map(parseCanonicalMessage) }
}

export function parseSendResponse(value: unknown): { message: CanonicalMessage } {
  const root = object(value, 'send')

  return { message: parseCanonicalMessage(root.message) }
}
