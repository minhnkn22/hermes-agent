import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { AtumMessagingHttpClient} from './http-client';
import { MessagingHttpError } from './http-client'
import { AtumMessagingStore } from './store'
import type {
  ConversationDraft,
  MessagingAccountSession,
  MessagingClientBoundary,
  MessagingConversation,
  MessagingStoreBoundary,
  MessagingSyncStatus,
  PendingMutation,
  QueueSendInput,
  SaveDraftInput,
  StoredMessage
} from './types'
import type { SyncChange, SyncPage } from './wire'

export interface MessagingEngineOptions {
  userDataPath: string
  http: AtumMessagingHttpClient
  session: () => MessagingAccountSession | null
  persistVerifiedSession?: (session: MessagingAccountSession) => void
  openStore?: (accountId: string, databasePath: string) => MessagingStoreBoundary
  now?: () => Date
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  retryBaseMs?: number
  pollMs?: number
}

function nextDelay(attempt: number, base: number): number {
  return Math.min(base * 2 ** Math.min(attempt, 6), 60_000)
}

function statusCopy(status: MessagingSyncStatus): MessagingSyncStatus {
  return { ...status }
}

export class AtumMessagingSyncEngine implements MessagingClientBoundary {
  private readonly openStore: NonNullable<MessagingEngineOptions['openStore']>
  private readonly now: () => Date
  private readonly setTimer: NonNullable<MessagingEngineOptions['setTimer']>
  private readonly clearTimer: NonNullable<MessagingEngineOptions['clearTimer']>
  private readonly retryBaseMs: number
  private readonly pollMs: number
  private store: MessagingStoreBoundary | null = null
  private activeAccountId: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private inFlight: Promise<MessagingSyncStatus> | null = null
  private retryAttempt = 0
  private state: MessagingSyncStatus = {
    accountId: null,
    connectivity: 'loading',
    synchronized: false,
    cursor: null,
    lastSuccessfulSyncAt: null,
    nextRetryAt: null,
    errorCode: null
  }

  constructor(private readonly options: MessagingEngineOptions) {
    this.openStore = options.openStore ?? ((accountId, databasePath) => new AtumMessagingStore({ accountId, databasePath }))
    this.now = options.now ?? (() => new Date())
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
    this.retryBaseMs = options.retryBaseMs ?? 1_000
    this.pollMs = options.pollMs ?? 30_000
  }

  async start(): Promise<MessagingSyncStatus> {
    this.stopped = false
    this.ensureActiveStore()

    if (!this.store) {
      this.transition('auth_expired', 'auth_unavailable')

      return this.status()
    }

    return this.sync()
  }

  stop(): void {
    this.stopped = true

    if (this.timer) {
      this.clearTimer(this.timer)
      this.timer = null
    }

    this.store?.close()
    this.store = null
    this.activeAccountId = null
  }

  replaceSession(session: MessagingAccountSession | null): Promise<MessagingSyncStatus> {
    this.stopped = false
    this.store?.close()
    this.store = null
    this.activeAccountId = null
    this.state = {
      accountId: session?.user.id ?? null,
      connectivity: session ? 'loading' : 'auth_expired',
      synchronized: false,
      cursor: null,
      lastSuccessfulSyncAt: null,
      nextRetryAt: null,
      errorCode: session ? null : 'auth_unavailable'
    }
    this.ensureActiveStore()

    return this.store ? this.sync() : Promise.resolve(this.status())
  }

  status(): Promise<MessagingSyncStatus> {
    if (this.store) {
      this.state.cursor = this.store.getSyncCursor().cursor
    }

    return Promise.resolve(statusCopy(this.state))
  }

  roster(limit = 100): Promise<MessagingConversation[]> {
    return Promise.resolve(this.requireStore().listConversations(limit))
  }

  messages(conversationId: string, limit = 100): Promise<StoredMessage[]> {
    return Promise.resolve(this.requireStore().listMessages(conversationId, limit))
  }

  draft(conversationId: string): Promise<ConversationDraft | null> {
    return Promise.resolve(this.requireStore().getDraft(conversationId))
  }

  saveDraft(conversationId: string, draft: SaveDraftInput): Promise<ConversationDraft> {
    return Promise.resolve(this.requireStore().saveDraft(conversationId, draft, this.now().toISOString()))
  }

  async send(input: QueueSendInput): Promise<PendingMutation> {
    const queued = this.requireStore().queueSend({ ...input, now: input.now ?? this.now().toISOString() })

    if (this.state.connectivity === 'online') {
      await this.drainOutbox()
    } else {
      this.scheduleRetry(this.retryBaseMs)
    }

    return queued
  }

  async retry(clientMessageId: string): Promise<PendingMutation> {
    const mutation = this.requireStore().retryMutation(clientMessageId, this.now().toISOString())

    if (this.state.connectivity === 'online') {
      await this.drainOutbox()
    } else {
      this.scheduleRetry(0)
    }

    return mutation
  }

  async markRead(conversationId: string, throughMessageId: string): Promise<boolean> {
    await this.options.http.markRead(conversationId, throughMessageId, randomUUID())

    return this.requireStore().markRead(conversationId, throughMessageId, this.now().toISOString())
  }

  sync(): Promise<MessagingSyncStatus> {
    if (this.inFlight) {
      return this.inFlight
    }

    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null
    })

    return this.inFlight
  }

  /** Realtime is deliberately only a coalesced wake-up hint. */
  realtimeHint(): Promise<MessagingSyncStatus> {
    return this.sync()
  }

  private async performSync(): Promise<MessagingSyncStatus> {
    this.ensureActiveStore()

    if (!this.store) {
      this.transition('auth_expired', 'auth_unavailable')

      return this.status()
    }

    this.transition(this.state.synchronized ? 'reconnecting' : 'loading', null)

    try {
      const verified = await this.options.http.session()
      const selected = this.options.session()

      if (!selected) {
        throw new MessagingHttpError('auth_unavailable', 401, false, null, null, null)
      }

      if (verified.user.id !== this.activeAccountId) {
        const corrected = { ...selected, user: verified.user }
        this.options.persistVerifiedSession?.(corrected)
        this.store.close()
        this.activeAccountId = verified.user.id
        this.store = this.openStore(verified.user.id, this.databasePath())
        this.state.accountId = verified.user.id
        this.state.synchronized = false
      }

      let cursor = this.store.getSyncCursor().cursor
      let firstPage = true

      for (;;) {
        const page = await this.options.http.sync(cursor)
        await this.applyPage(page, firstPage)

        if (!this.store.commitSyncCursor(cursor, page.nextCursor, this.now().toISOString())) {
          throw new Error('sync_cursor_race')
        }

        cursor = page.nextCursor
        firstPage = false

        if (!page.hasMore) {
          break
        }
      }

      await this.drainOutbox()
      this.retryAttempt = 0
      this.state = {
        accountId: this.activeAccountId,
        connectivity: 'online',
        synchronized: true,
        cursor,
        lastSuccessfulSyncAt: this.now().toISOString(),
        nextRetryAt: null,
        errorCode: null
      }
      this.scheduleRetry(this.pollMs)
    } catch (error) {
      await this.handleSyncFailure(error)
    }

    return this.status()
  }

  private async applyPage(page: SyncPage, firstPage: boolean): Promise<void> {
    const store = this.requireStore()
    const affected = new Set<string>()

    for (const change of page.changes) {
      if (change.conversationId) {
        affected.add(change.conversationId)
      }

      if (change.entity === 'message' && change.operation === 'delete') {
        store.deleteCanonicalMessage(change.entityId)
      }
    }

    // Ledger rows are watermarks and intentionally omit message bodies. Refresh
    // the authoritative allowlisted resources before committing the page cursor.
    const roster = await this.options.http.conversations()

    for (const conversation of roster.conversations) {
      store.upsertConversation(conversation)

      if (firstPage || page.changes.some(change => change.entity === 'conversation' || change.entity === 'participant')) {
        affected.add(conversation.id)
      }
    }

    for (const conversationId of [...affected].sort()) {
      const history = await this.options.http.messages(conversationId)

      for (const message of [...history.messages].reverse()) {
        store.canonicalizeMessage({ message, incrementUnread: false, now: this.now().toISOString() })
      }
    }

    // Mark each watermark only after every resource fetch and SQLite projection
    // above completed. A crash before here replays the idempotent page; a crash
    // after here but before cursor commit also replays it safely.
    for (const change of page.changes) {
      store.recordSyncChange(change.changeId, this.now().toISOString())
    }
  }

  private async drainOutbox(): Promise<void> {
    const store = this.requireStore()

    for (const due of store.listDueMutations(this.now().toISOString(), 100)) {
      const sending = store.markMutationSending(due.clientMessageId, this.now().toISOString())

      try {
        const acknowledged = await this.options.http.send(sending)
        store.canonicalizeMessage({
          message: acknowledged.message,
          clientMessageId: sending.clientMessageId,
          incrementUnread: false,
          now: this.now().toISOString()
        })
      } catch (error) {
        const failure = this.failure(error, sending.attemptCount)
        store.markMutationFailed(sending.clientMessageId, failure)

        if (error instanceof MessagingHttpError && error.status === 401) {
          throw error
        }
      }
    }
  }

  private failure(error: unknown, attempt: number) {
    if (error instanceof MessagingHttpError) {
      const retryAt = new Date(
        this.now().getTime() + (error.retryAfterMs ?? nextDelay(attempt, this.retryBaseMs))
      ).toISOString()

      return {
        code: error.code,
        retryable: error.retryable || error.status === 0 || error.status >= 500,
        conflicted: error.code === 'idempotency_conflict' || error.code === 'version_conflict',
        retryAt,
        now: this.now().toISOString()
      }
    }

    return {
      code: error instanceof Error ? error.message : 'internal_error',
      retryable: true,
      retryAt: new Date(this.now().getTime() + nextDelay(attempt, this.retryBaseMs)).toISOString(),
      now: this.now().toISOString()
    }
  }

  private async handleSyncFailure(error: unknown): Promise<void> {
    if (error instanceof MessagingHttpError && error.code === 'sync_cursor_expired' && error.details?.reset_required) {
      this.requireStore().resetProjection()
      this.state.synchronized = false
      this.scheduleRetry(0)
      this.transition('reconnecting', error.code)

      return
    }

    if (error instanceof MessagingHttpError && error.status === 401) {
      this.transition('auth_expired', error.code)

      return
    }

    this.retryAttempt += 1
    const cached = this.requireStore().listConversations(1).length > 0
    this.transition(cached ? 'offline_cached' : 'error', error instanceof Error ? error.message : 'internal_error')
    this.scheduleRetry(nextDelay(this.retryAttempt, this.retryBaseMs))
  }

  private ensureActiveStore(): void {
    const session = this.options.session()

    if (!session) {
      return
    }

    if (this.activeAccountId === session.user.id && this.store) {
      return
    }

    this.store?.close()
    this.activeAccountId = session.user.id
    this.store = this.openStore(session.user.id, this.databasePath())
    this.state.accountId = session.user.id
    this.state.cursor = this.store.getSyncCursor().cursor
  }

  private databasePath(): string {
    return join(this.options.userDataPath, 'atum-messaging', 'messaging.sqlite3')
  }

  private requireStore(): MessagingStoreBoundary {
    this.ensureActiveStore()

    if (!this.store) {
      throw new Error('auth_unavailable')
    }

    return this.store
  }

  private transition(connectivity: MessagingSyncStatus['connectivity'], errorCode: string | null): void {
    this.state = { ...this.state, connectivity, errorCode }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.stopped) {
      return
    }

    if (this.timer) {
      this.clearTimer(this.timer)
    }

    const delay = Math.max(0, delayMs)
    this.state.nextRetryAt = new Date(this.now().getTime() + delay).toISOString()
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.sync()
    }, delay)
  }
}

export function conversationsAffectedBy(changes: readonly SyncChange[]): string[] {
  return [...new Set(changes.flatMap(change => (change.conversationId ? [change.conversationId] : [])))].sort()
}
