import type { MessagingClientBoundary } from './types'

interface IpcMainLike {
  handle(channel: string, listener: (_event: unknown, ...args: any[]) => unknown): void
  removeHandler?(channel: string): void
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value || value.length > 256) {
    throw new Error(`${name} must be a non-empty identifier`)
  }

  return value
}

function boundedLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error('limit must be an integer from 1 to 500')
  }

  return parsed
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }

  return value as Record<string, unknown>
}

function draftInput(value: unknown) {
  const input = record(value, 'draft')
  const attachmentIds = input.attachmentIds === undefined ? [] : input.attachmentIds

  if (typeof input.text !== 'string' || input.text.length > 20_000 || !Array.isArray(attachmentIds)) {
    throw new Error('draft is invalid')
  }

  return {
    text: input.text,
    replyToMessageId:
      input.replyToMessageId === null || input.replyToMessageId === undefined
        ? null
        : identifier(input.replyToMessageId, 'replyToMessageId'),
    attachmentIds: attachmentIds.map((id, index) => identifier(id, `attachmentIds.${index}`))
  }
}

function sendInput(value: unknown) {
  const input = record(value, 'send')

  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 20_000) {
    throw new Error('message content is invalid')
  }

  if (input.locale !== 'vi' && input.locale !== 'en') {
    throw new Error('message locale is invalid')
  }

  const attachments = input.attachmentIds === undefined ? [] : input.attachmentIds

  if (!Array.isArray(attachments) || attachments.length > 10) {
    throw new Error('message attachments are invalid')
  }

  return {
    conversationId: identifier(input.conversationId, 'conversationId'),
    clientMessageId: identifier(input.clientMessageId, 'clientMessageId'),
    content: input.content,
    locale: input.locale,
    replyToMessageId:
      input.replyToMessageId === null || input.replyToMessageId === undefined
        ? null
        : identifier(input.replyToMessageId, 'replyToMessageId'),
    attachmentIds: attachments.map((id, index) => identifier(id, `attachmentIds.${index}`))
  }
}

export const ATUM_MESSAGING_IPC_CHANNELS = [
  'atum:messaging:status',
  'atum:messaging:roster',
  'atum:messaging:messages',
  'atum:messaging:draft:get',
  'atum:messaging:draft:save',
  'atum:messaging:send',
  'atum:messaging:retry',
  'atum:messaging:read',
  'atum:messaging:sync'
] as const

export function registerAtumMessagingIpc(ipc: IpcMainLike, client: MessagingClientBoundary): () => void {
  ipc.handle('atum:messaging:status', () => client.status())
  ipc.handle('atum:messaging:roster', (_event, limit) => client.roster(boundedLimit(limit)))
  ipc.handle('atum:messaging:messages', (_event, conversationId, limit) =>
    client.messages(identifier(conversationId, 'conversationId'), boundedLimit(limit))
  )
  ipc.handle('atum:messaging:draft:get', (_event, conversationId) =>
    client.draft(identifier(conversationId, 'conversationId'))
  )
  ipc.handle('atum:messaging:draft:save', (_event, conversationId, draft) =>
    client.saveDraft(identifier(conversationId, 'conversationId'), draftInput(draft))
  )
  ipc.handle('atum:messaging:send', (_event, input) => client.send(sendInput(input)))
  ipc.handle('atum:messaging:retry', (_event, clientMessageId) =>
    client.retry(identifier(clientMessageId, 'clientMessageId'))
  )
  ipc.handle('atum:messaging:read', (_event, conversationId, throughMessageId) =>
    client.markRead(
      identifier(conversationId, 'conversationId'),
      identifier(throughMessageId, 'throughMessageId')
    )
  )
  ipc.handle('atum:messaging:sync', () => client.sync())

  return () => {
    for (const channel of ATUM_MESSAGING_IPC_CHANNELS) {
      ipc.removeHandler?.(channel)
    }
  }
}
