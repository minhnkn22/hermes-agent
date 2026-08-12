import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { applyMessagingMigrations } from './migrations'
import type {
  CanonicalizeMessageInput,
  CanonicalMessage,
  ConversationDraft,
  MessagingConversation,
  MessagingStoreBoundary,
  MutationFailure,
  OpenMessagingStoreOptions,
  PendingMutation,
  QueueSendInput,
  SaveDraftInput,
  StoredMessage,
  SyncCursor
} from './types'

type SqlValue = string | number | bigint | null
type SqlRow = Record<string, SqlValue>

function nowIso(value?: string): string {
  return value ?? new Date().toISOString()
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function requestFingerprint(request: unknown): string {
  return createHash('sha256').update(stableJson(request), 'utf8').digest('hex')
}

function parseJson<T>(value: SqlValue): T {
  return JSON.parse(String(value)) as T
}

function transaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN IMMEDIATE')

  try {
    const result = work()
    database.exec('COMMIT')

    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function assertIdentifier(name: string, value: string): void {
  if (!value || value.length > 256) {
    throw new Error(`${name} must be a non-empty identifier`)
  }
}

function assertOpaqueSyncToken(name: string, value: string): void {
  if (!value || value.length > 8192) {
    throw new Error(`${name} must be a non-empty opaque sync token no longer than 8192 characters`)
  }
}

function conversationFromRow(row: SqlRow): MessagingConversation {
  return {
    id: String(row.id),
    title: row.title === null ? null : String(row.title),
    kind: String(row.kind),
    participantIds: parseJson<string[]>(row.participant_ids_json),
    updatedAt: String(row.updated_at),
    lastMessageAt: row.last_message_at === null ? null : String(row.last_message_at),
    unreadCount: Number(row.unread_count),
    payload: parseJson<Record<string, unknown>>(row.payload_json)
  }
}

function messageFromRow(row: SqlRow): StoredMessage {
  return {
    localId: String(row.local_id),
    id: row.canonical_id === null ? null : String(row.canonical_id),
    clientMessageId: row.client_message_id === null ? null : String(row.client_message_id),
    conversationId: String(row.conversation_id),
    sender: { type: String(row.sender_type), id: String(row.sender_id) },
    content: String(row.content),
    kind: String(row.kind),
    attachments: parseJson<unknown[]>(row.attachments_json),
    replyToMessageId: row.reply_to_message_id === null ? null : String(row.reply_to_message_id),
    forwardedFrom: row.forwarded_from_json === null ? null : parseJson<unknown>(row.forwarded_from_json),
    reactions: parseJson<unknown[]>(row.reactions_json),
    version: Number(row.version),
    createdAt: String(row.created_at),
    editedAt: row.edited_at === null ? null : String(row.edited_at),
    recalledAt: row.recalled_at === null ? null : String(row.recalled_at),
    delivery: String(row.delivery),
    optimistic: Number(row.optimistic) === 1
  }
}

function mutationFromRow(row: SqlRow): PendingMutation {
  return {
    id: String(row.id),
    kind: 'send_message',
    conversationId: String(row.conversation_id),
    clientMessageId: String(row.client_message_id),
    request: parseJson<PendingMutation['request']>(row.request_json),
    state: String(row.state) as PendingMutation['state'],
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at === null ? null : String(row.next_attempt_at),
    lastErrorCode: row.last_error_code === null ? null : String(row.last_error_code),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

const MESSAGE_COLUMNS = `
  local_id, conversation_id, canonical_id, client_message_id, sender_type, sender_id, content,
  kind, attachments_json, reply_to_message_id, forwarded_from_json, reactions_json, version,
  created_at, edited_at, recalled_at, delivery, optimistic
`

const MUTATION_COLUMNS = `
  id, conversation_id, client_message_id, request_json, state, attempt_count, next_attempt_at,
  last_error_code, created_at, updated_at
`

export class AtumMessagingStore implements MessagingStoreBoundary {
  readonly accountId: string
  private readonly database: DatabaseSync
  private closed = false

  constructor({ accountId, databasePath }: OpenMessagingStoreOptions) {
    assertIdentifier('accountId', accountId)
    this.accountId = accountId

    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true })
    }

    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

    if (databasePath !== ':memory:') {
      this.database.exec('PRAGMA journal_mode = WAL;')
    }

    applyMessagingMigrations(this.database)
    this.recoverInterruptedMutations()
  }

  close(): void {
    if (this.closed) {
      return
    }

    this.database.close()
    this.closed = true
  }

  upsertConversation(conversation: Omit<MessagingConversation, 'unreadCount'>): void {
    assertIdentifier('conversation.id', conversation.id)
    this.database
      .prepare(
        `
        INSERT INTO messaging_conversations(
          account_id, id, title, kind, participant_ids_json, updated_at, last_message_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          title = excluded.title,
          kind = excluded.kind,
          participant_ids_json = excluded.participant_ids_json,
          updated_at = excluded.updated_at,
          last_message_at = excluded.last_message_at,
          payload_json = excluded.payload_json
        WHERE excluded.updated_at >= messaging_conversations.updated_at
      `
      )
      .run(
        this.accountId,
        conversation.id,
        conversation.title,
        conversation.kind,
        JSON.stringify(conversation.participantIds),
        conversation.updatedAt,
        conversation.lastMessageAt,
        JSON.stringify(conversation.payload)
      )
  }

  listConversations(limit = 100): MessagingConversation[] {
    const boundedLimit = Math.max(1, Math.min(limit, 500))

    return (
      this.database
        .prepare(
          `
          SELECT id, title, kind, participant_ids_json, updated_at, last_message_at,
                 unread_count, payload_json
          FROM messaging_conversations
          WHERE account_id = ?
          ORDER BY last_message_at DESC, updated_at DESC, id DESC
          LIMIT ?
        `
        )
        .all(this.accountId, boundedLimit) as SqlRow[]
    ).map(conversationFromRow)
  }

  listMessages(conversationId: string, limit = 100): StoredMessage[] {
    const boundedLimit = Math.max(1, Math.min(limit, 500))

    return (
      this.database
        .prepare(
          `
          SELECT ${MESSAGE_COLUMNS}
          FROM messaging_messages
          WHERE account_id = ? AND conversation_id = ?
          ORDER BY sort_at DESC, local_id DESC
          LIMIT ?
        `
        )
        .all(this.accountId, conversationId, boundedLimit) as SqlRow[]
    ).map(messageFromRow)
  }

  saveDraft(conversationId: string, draft: SaveDraftInput, now = new Date().toISOString()): ConversationDraft {
    assertIdentifier('conversationId', conversationId)
    const attachmentIds = draft.attachmentIds ?? []
    this.database
      .prepare(
        `
        INSERT INTO messaging_drafts(
          account_id, conversation_id, text, reply_to_message_id, attachment_ids_json, revision,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(account_id, conversation_id) DO UPDATE SET
          text = excluded.text,
          reply_to_message_id = excluded.reply_to_message_id,
          attachment_ids_json = excluded.attachment_ids_json,
          revision = messaging_drafts.revision + 1,
          updated_at = excluded.updated_at
      `
      )
      .run(
        this.accountId,
        conversationId,
        draft.text,
        draft.replyToMessageId ?? null,
        JSON.stringify(attachmentIds),
        now
      )

    return this.getDraft(conversationId)!
  }

  getDraft(conversationId: string): ConversationDraft | null {
    const row = this.database
      .prepare(
        `
        SELECT text, reply_to_message_id, attachment_ids_json, revision, updated_at
        FROM messaging_drafts WHERE account_id = ? AND conversation_id = ?
      `
      )
      .get(this.accountId, conversationId) as SqlRow | undefined

    if (!row) {
      return null
    }

    return {
      text: String(row.text),
      replyToMessageId: row.reply_to_message_id === null ? null : String(row.reply_to_message_id),
      attachmentIds: parseJson<string[]>(row.attachment_ids_json),
      revision: Number(row.revision),
      updatedAt: String(row.updated_at)
    }
  }

  queueSend(input: QueueSendInput): PendingMutation {
    assertIdentifier('conversationId', input.conversationId)
    assertIdentifier('clientMessageId', input.clientMessageId)
    const timestamp = nowIso(input.now)

    const request = {
      client_message_id: input.clientMessageId,
      content: input.content,
      locale: input.locale,
      reply_to_message_id: input.replyToMessageId ?? null,
      attachment_ids: input.attachmentIds ?? []
    }

    const requestJson = stableJson(request)
    const fingerprint = requestFingerprint(request)
    const mutationId = `send:${this.accountId}:${input.conversationId}:${input.clientMessageId}`
    const localId = `client:${this.accountId}:${input.conversationId}:${input.clientMessageId}`

    transaction(this.database, () => {
      const existing = this.database
        .prepare(
          `
          SELECT request_fingerprint FROM messaging_pending_mutations
          WHERE account_id = ? AND conversation_id = ? AND client_message_id = ?
        `
        )
        .get(this.accountId, input.conversationId, input.clientMessageId) as SqlRow | undefined

      if (existing) {
        if (String(existing.request_fingerprint) !== fingerprint) {
          throw new Error('idempotency_conflict: clientMessageId was reused with different content')
        }

        return
      }

      const conversation = this.database
        .prepare('SELECT 1 AS present FROM messaging_conversations WHERE account_id = ? AND id = ?')
        .get(this.accountId, input.conversationId)

      if (!conversation) {
        throw new Error(`Unknown conversation: ${input.conversationId}`)
      }

      const draft = this.database
        .prepare(
          `
          SELECT revision FROM messaging_drafts WHERE account_id = ? AND conversation_id = ?
        `
        )
        .get(this.accountId, input.conversationId) as SqlRow | undefined

      this.database
        .prepare(
          `
          INSERT INTO messaging_messages(
            local_id, account_id, conversation_id, canonical_id, client_message_id, sender_type,
            sender_id, content, kind, attachments_json, reply_to_message_id, forwarded_from_json,
            reactions_json, version, created_at, edited_at, recalled_at, delivery, sort_at, optimistic
          ) VALUES (?, ?, ?, NULL, ?, 'user', ?, ?, 'text', ?, ?, NULL, '[]', 0, ?, NULL, NULL,
                    'queued', ?, 1)
        `
        )
        .run(
          localId,
          this.accountId,
          input.conversationId,
          input.clientMessageId,
          this.accountId,
          input.content,
          JSON.stringify(input.attachmentIds ?? []),
          input.replyToMessageId ?? null,
          timestamp,
          timestamp
        )
      this.database
        .prepare(
          `
          INSERT INTO messaging_pending_mutations(
            id, account_id, conversation_id, client_message_id, kind, request_json,
            request_fingerprint, state, attempt_count, next_attempt_at, last_error_code,
            draft_revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'send_message', ?, ?, 'queued', 0, ?, NULL, ?, ?, ?)
        `
        )
        .run(
          mutationId,
          this.accountId,
          input.conversationId,
          input.clientMessageId,
          requestJson,
          fingerprint,
          timestamp,
          draft ? Number(draft.revision) : null,
          timestamp,
          timestamp
        )
      this.database
        .prepare(
          `
          UPDATE messaging_conversations
          SET last_message_at = ?, updated_at = ?
          WHERE account_id = ? AND id = ?
        `
        )
        .run(timestamp, timestamp, this.accountId, input.conversationId)
    })

    return this.getMutation(input.clientMessageId)
  }

  markMutationSending(clientMessageId: string, now = new Date().toISOString()): PendingMutation {
    const result = this.database
      .prepare(
        `
        UPDATE messaging_pending_mutations
        SET state = 'sending', attempt_count = attempt_count + 1, next_attempt_at = NULL,
            last_error_code = NULL, updated_at = ?
        WHERE account_id = ? AND client_message_id = ?
          AND state IN ('queued', 'failed_retryable')
      `
      )
      .run(now, this.accountId, clientMessageId)

    if (result.changes !== 1) {
      throw new Error(`Mutation is not sendable: ${clientMessageId}`)
    }

    this.setOptimisticDelivery(clientMessageId, 'sending')

    return this.getMutation(clientMessageId)
  }

  markMutationFailed(clientMessageId: string, failure: MutationFailure): PendingMutation {
    const state = failure.conflicted ? 'conflicted' : failure.retryable ? 'failed_retryable' : 'failed_terminal'

    const timestamp = nowIso(failure.now)

    const result = this.database
      .prepare(
        `
        UPDATE messaging_pending_mutations
        SET state = ?, next_attempt_at = ?, last_error_code = ?, updated_at = ?
        WHERE account_id = ? AND client_message_id = ? AND state != 'sent'
      `
      )
      .run(
        state,
        failure.retryable ? (failure.retryAt ?? timestamp) : null,
        failure.code,
        timestamp,
        this.accountId,
        clientMessageId
      )

    if (result.changes !== 1) {
      throw new Error(`Mutation cannot fail: ${clientMessageId}`)
    }

    this.setOptimisticDelivery(clientMessageId, state)

    return this.getMutation(clientMessageId)
  }

  retryMutation(clientMessageId: string, now = new Date().toISOString()): PendingMutation {
    const result = this.database
      .prepare(
        `
        UPDATE messaging_pending_mutations
        SET state = 'queued', next_attempt_at = ?, last_error_code = NULL, updated_at = ?
        WHERE account_id = ? AND client_message_id = ? AND state = 'failed_retryable'
      `
      )
      .run(now, now, this.accountId, clientMessageId)

    if (result.changes !== 1) {
      throw new Error(`Mutation is not retryable: ${clientMessageId}`)
    }

    this.setOptimisticDelivery(clientMessageId, 'queued')

    return this.getMutation(clientMessageId)
  }

  listDueMutations(now = new Date().toISOString(), limit = 100): PendingMutation[] {
    const boundedLimit = Math.max(1, Math.min(limit, 500))

    return (
      this.database
        .prepare(
          `
          SELECT ${MUTATION_COLUMNS}
          FROM messaging_pending_mutations
          WHERE account_id = ?
            AND (state = 'queued' OR (state = 'failed_retryable' AND next_attempt_at <= ?))
          ORDER BY created_at, id
          LIMIT ?
        `
        )
        .all(this.accountId, now, boundedLimit) as SqlRow[]
    ).map(mutationFromRow)
  }

  canonicalizeMessage(input: CanonicalizeMessageInput): StoredMessage {
    const timestamp = nowIso(input.now)
    const { message } = input
    assertIdentifier('message.id', message.id)
    assertIdentifier('message.conversationId', message.conversationId)

    return transaction(this.database, () => {
      this.database
        .prepare(
          `
          INSERT OR IGNORE INTO messaging_conversations(
            account_id, id, title, kind, participant_ids_json, updated_at, last_message_at,
            unread_count, payload_json
          ) VALUES (?, ?, NULL, 'unknown', '[]', ?, ?, 0, '{}')
        `
        )
        .run(this.accountId, message.conversationId, message.createdAt, message.createdAt)
      const canonicalRow = this.findMessageByCanonicalId(message.id)

      const clientRow = input.clientMessageId
        ? this.findMessageByClientId(message.conversationId, input.clientMessageId)
        : undefined

      const wasCanonicalPresent = Boolean(canonicalRow)
      let targetLocalId = canonicalRow?.local_id ? String(canonicalRow.local_id) : null

      if (canonicalRow && clientRow && canonicalRow.local_id !== clientRow.local_id) {
        this.database.prepare('DELETE FROM messaging_messages WHERE local_id = ?').run(String(clientRow.local_id))
      } else if (!targetLocalId && clientRow) {
        targetLocalId = String(clientRow.local_id)
      }

      targetLocalId ??= `server:${this.accountId}:${message.id}`

      this.writeCanonicalMessage(targetLocalId, message, input.clientMessageId ?? null)

      const readState = this.database
        .prepare(
          `
          SELECT last_read_sort_at, last_read_message_id FROM messaging_read_state
          WHERE account_id = ? AND conversation_id = ?
        `
        )
        .get(this.accountId, message.conversationId) as SqlRow | undefined

      const isAfterReadPosition =
        !readState ||
        String(readState.last_read_sort_at) < message.createdAt ||
        (String(readState.last_read_sort_at) === message.createdAt &&
          String(readState.last_read_message_id) < message.id)

      const shouldIncrementUnread = Boolean(input.incrementUnread) && !wasCanonicalPresent && isAfterReadPosition

      if (input.clientMessageId) {
        const mutation = this.database
          .prepare(
            `
            SELECT draft_revision FROM messaging_pending_mutations
            WHERE account_id = ? AND conversation_id = ? AND client_message_id = ?
          `
          )
          .get(this.accountId, message.conversationId, input.clientMessageId) as SqlRow | undefined

        const transition = this.database
          .prepare(
            `
            UPDATE messaging_pending_mutations
            SET state = 'sent', next_attempt_at = NULL, last_error_code = NULL, updated_at = ?
            WHERE account_id = ? AND conversation_id = ? AND client_message_id = ?
              AND state != 'sent'
          `
          )
          .run(timestamp, this.accountId, message.conversationId, input.clientMessageId)

        if (transition.changes === 1 && mutation?.draft_revision !== null && mutation?.draft_revision !== undefined) {
          this.database
            .prepare(
              `
              DELETE FROM messaging_drafts
              WHERE account_id = ? AND conversation_id = ? AND revision = ?
            `
            )
            .run(this.accountId, message.conversationId, Number(mutation.draft_revision))
        }
      }

      this.database
        .prepare(
          `
          UPDATE messaging_conversations
          SET last_message_at = CASE
                WHEN last_message_at IS NULL OR last_message_at < ? THEN ? ELSE last_message_at END,
              updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END,
              unread_count = unread_count + ?
          WHERE account_id = ? AND id = ?
        `
        )
        .run(
          message.createdAt,
          message.createdAt,
          message.createdAt,
          message.createdAt,
          shouldIncrementUnread ? 1 : 0,
          this.accountId,
          message.conversationId
        )

      return messageFromRow(this.findMessageByCanonicalId(message.id)!)
    })
  }

  deleteCanonicalMessage(messageId: string): boolean {
    assertIdentifier('messageId', messageId)
    const row = this.findMessageByCanonicalId(messageId)

    if (!row) {
      return false
    }

    const result = this.database
      .prepare('DELETE FROM messaging_messages WHERE account_id = ? AND canonical_id = ?')
      .run(this.accountId, messageId)

    return result.changes === 1
  }

  markRead(conversationId: string, throughMessageId: string, now = new Date().toISOString()): boolean {
    return transaction(this.database, () => {
      const through = this.findMessageByCanonicalId(throughMessageId)

      if (!through || String(through.conversation_id) !== conversationId) {
        throw new Error(`Unknown through message: ${throughMessageId}`)
      }

      const previous = this.database
        .prepare(
          `
          SELECT last_read_sort_at, last_read_message_id FROM messaging_read_state
          WHERE account_id = ? AND conversation_id = ?
        `
        )
        .get(this.accountId, conversationId) as SqlRow | undefined

      const sortAt = String(through.sort_at)

      if (
        previous &&
        (String(previous.last_read_sort_at) > sortAt ||
          (String(previous.last_read_sort_at) === sortAt && String(previous.last_read_message_id) >= throughMessageId))
      ) {
        return false
      }

      this.database
        .prepare(
          `
          INSERT INTO messaging_read_state(
            account_id, conversation_id, last_read_message_id, last_read_sort_at, read_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(account_id, conversation_id) DO UPDATE SET
            last_read_message_id = excluded.last_read_message_id,
            last_read_sort_at = excluded.last_read_sort_at,
            read_at = excluded.read_at
        `
        )
        .run(this.accountId, conversationId, throughMessageId, sortAt, now)

      const unread = this.database
        .prepare(
          `
          SELECT count(*) AS count FROM messaging_messages
          WHERE account_id = ? AND conversation_id = ? AND canonical_id IS NOT NULL
            AND (sort_at > ? OR (sort_at = ? AND canonical_id > ?))
        `
        )
        .get(this.accountId, conversationId, sortAt, sortAt, throughMessageId) as SqlRow

      this.database
        .prepare(
          `
          UPDATE messaging_conversations SET unread_count = ? WHERE account_id = ? AND id = ?
        `
        )
        .run(Number(unread.count), this.accountId, conversationId)

      return true
    })
  }

  getSyncCursor(): SyncCursor {
    const row = this.database
      .prepare('SELECT cursor, updated_at FROM messaging_sync_state WHERE account_id = ?')
      .get(this.accountId) as SqlRow | undefined

    return {
      cursor: row?.cursor === null || row?.cursor === undefined ? null : String(row.cursor),
      updatedAt: row?.updated_at === null || row?.updated_at === undefined ? null : String(row.updated_at)
    }
  }

  commitSyncCursor(expectedCursor: string | null, nextCursor: string, now = new Date().toISOString()): boolean {
    assertOpaqueSyncToken('nextCursor', nextCursor)

    return transaction(this.database, () => {
      const current = this.getSyncCursor().cursor

      if (current !== expectedCursor) {
        return false
      }

      this.database
        .prepare(
          `
          INSERT INTO messaging_sync_state(account_id, cursor, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
        `
        )
        .run(this.accountId, nextCursor, now)

      return true
    })
  }

  recordSyncChange(changeId: string, now = new Date().toISOString()): boolean {
    assertOpaqueSyncToken('changeId', changeId)

    const result = this.database
      .prepare(
        `
        INSERT OR IGNORE INTO messaging_sync_changes(account_id, change_id, committed_at)
        VALUES (?, ?, ?)
      `
      )
      .run(this.accountId, changeId, now)

    return result.changes === 1
  }

  resetProjection(): void {
    transaction(this.database, () => {
      this.database
        .prepare('DELETE FROM messaging_messages WHERE account_id = ? AND canonical_id IS NOT NULL')
        .run(this.accountId)
      this.database.prepare('DELETE FROM messaging_read_state WHERE account_id = ?').run(this.accountId)
      this.database.prepare('DELETE FROM messaging_sync_changes WHERE account_id = ?').run(this.accountId)
      this.database.prepare('DELETE FROM messaging_sync_state WHERE account_id = ?').run(this.accountId)
      this.database
        .prepare(
          `
          DELETE FROM messaging_conversations
          WHERE account_id = ? AND NOT EXISTS (
            SELECT 1 FROM messaging_messages message
            WHERE message.account_id = messaging_conversations.account_id
              AND message.conversation_id = messaging_conversations.id
              AND message.optimistic = 1
          )
        `
        )
        .run(this.accountId)
      this.database
        .prepare(
          `
          UPDATE messaging_conversations
          SET title = NULL, participant_ids_json = '[]', payload_json = '{}', unread_count = 0
          WHERE account_id = ?
        `
        )
        .run(this.accountId)
    })
  }

  private recoverInterruptedMutations(): void {
    const timestamp = new Date().toISOString()
    transaction(this.database, () => {
      this.database
        .prepare(
          `
          UPDATE messaging_pending_mutations
          SET state = 'queued', next_attempt_at = ?, updated_at = ?
          WHERE account_id = ? AND state = 'sending'
        `
        )
        .run(timestamp, timestamp, this.accountId)
      this.database
        .prepare(
          `
          UPDATE messaging_messages SET delivery = 'queued'
          WHERE account_id = ? AND optimistic = 1 AND delivery = 'sending'
        `
        )
        .run(this.accountId)
    })
  }

  private getMutation(clientMessageId: string): PendingMutation {
    const row = this.database
      .prepare(
        `
        SELECT ${MUTATION_COLUMNS}
        FROM messaging_pending_mutations WHERE account_id = ? AND client_message_id = ?
      `
      )
      .get(this.accountId, clientMessageId) as SqlRow | undefined

    if (!row) {
      throw new Error(`Unknown mutation: ${clientMessageId}`)
    }

    return mutationFromRow(row)
  }

  private setOptimisticDelivery(clientMessageId: string, delivery: string): void {
    this.database
      .prepare(
        `
        UPDATE messaging_messages SET delivery = ?
        WHERE account_id = ? AND client_message_id = ? AND optimistic = 1
      `
      )
      .run(delivery, this.accountId, clientMessageId)
  }

  private findMessageByCanonicalId(canonicalId: string): SqlRow | undefined {
    return this.database
      .prepare(
        `
        SELECT ${MESSAGE_COLUMNS}, sort_at FROM messaging_messages
        WHERE account_id = ? AND canonical_id = ?
      `
      )
      .get(this.accountId, canonicalId) as SqlRow | undefined
  }

  private findMessageByClientId(conversationId: string, clientMessageId: string): SqlRow | undefined {
    return this.database
      .prepare(
        `
        SELECT ${MESSAGE_COLUMNS}, sort_at FROM messaging_messages
        WHERE account_id = ? AND conversation_id = ? AND client_message_id = ?
      `
      )
      .get(this.accountId, conversationId, clientMessageId) as SqlRow | undefined
  }

  private writeCanonicalMessage(localId: string, message: CanonicalMessage, clientMessageId: string | null): void {
    this.database
      .prepare(
        `
        INSERT INTO messaging_messages(
          local_id, account_id, conversation_id, canonical_id, client_message_id, sender_type,
          sender_id, content, kind, attachments_json, reply_to_message_id, forwarded_from_json,
          reactions_json, version, created_at, edited_at, recalled_at, delivery, sort_at, optimistic
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(local_id) DO UPDATE SET
          canonical_id = excluded.canonical_id,
          client_message_id = COALESCE(excluded.client_message_id, messaging_messages.client_message_id),
          sender_type = excluded.sender_type,
          sender_id = excluded.sender_id,
          content = excluded.content,
          kind = excluded.kind,
          attachments_json = excluded.attachments_json,
          reply_to_message_id = excluded.reply_to_message_id,
          forwarded_from_json = excluded.forwarded_from_json,
          reactions_json = excluded.reactions_json,
          version = excluded.version,
          created_at = excluded.created_at,
          edited_at = excluded.edited_at,
          recalled_at = excluded.recalled_at,
          delivery = excluded.delivery,
          sort_at = excluded.sort_at,
          optimistic = 0
        WHERE excluded.version >= messaging_messages.version
      `
      )
      .run(
        localId,
        this.accountId,
        message.conversationId,
        message.id,
        clientMessageId,
        message.sender.type,
        message.sender.id,
        message.content,
        message.kind,
        JSON.stringify(message.attachments),
        message.replyToMessageId,
        message.forwardedFrom === null ? null : JSON.stringify(message.forwardedFrom),
        JSON.stringify(message.reactions),
        message.version,
        message.createdAt,
        message.editedAt,
        message.recalledAt,
        message.delivery,
        message.createdAt
      )
  }
}

export function openAtumMessagingStore(options: OpenMessagingStoreOptions): MessagingStoreBoundary {
  return new AtumMessagingStore(options)
}
