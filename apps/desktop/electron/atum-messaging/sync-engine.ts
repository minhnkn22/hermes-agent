import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { AtumMessagingHttpClient } from './http-client'
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
  maxSyncPages?: number
}

const DEFAULT_MAX_SYNC_PAGES = 100
const MAX_SYNC_PAGES = 500

class StaleMessagingLifecycle extends Error {
  constructor() {
    super('stale_messaging_lifecycle')
  }
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
  private readonly maxSyncPages: number
  private store: MessagingStoreBoundary | null = null
  private activeAccountId: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private inFlight: { generation: number; promise: Promise<MessagingSyncStatus> } | null = null
  private generation = 0
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
    this.openStore =
      options.openStore ?? ((accountId, databasePath) => new AtumMessagingStore({ accountId, databasePath }))
    this.now = options.now ?? (() => new Date())
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
    this.retryBaseMs = options.retryBaseMs ?? 1_000
    this.pollMs = options.pollMs ?? 30_000
    this.maxSyncPages = Math.max(
      1,
      Math.min(Math.trunc(options.maxSyncPages ?? DEFAULT_MAX_SYNC_PAGES), MAX_SYNC_PAGES)
    )
  }

  async start(): Promise<MessagingSyncStatus> {
    this.beginLifecycle()
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
    this.generation += 1
    this.options.http.abortAll()
    this.cancelTimer()

    this.store?.close()
    this.store = null
    this.activeAccountId = null
  }

  replaceSession(session: MessagingAccountSession | null): Promise<MessagingSyncStatus> {
    this.beginLifecycle()
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
      try {
        await this.drainOutbox()
      } catch (error) {
        if (!this.transitionAuthFailure(error)) {
          throw error
        }
      }
    } else {
      this.scheduleRetry(this.retryBaseMs)
    }

    return queued
  }

  async retry(clientMessageId: string): Promise<PendingMutation> {
    const mutation = this.requireStore().retryMutation(clientMessageId, this.now().toISOString())

    if (this.state.connectivity === 'online') {
      try {
        await this.drainOutbox()
      } catch (error) {
        if (!this.transitionAuthFailure(error)) {
          throw error
        }
      }
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
    if (this.stopped) {
      return this.status()
    }

    const generation = this.generation

    if (this.inFlight?.generation === generation) {
      return this.inFlight.promise
    }

    const operation = this.performSync(generation).finally(() => {
      if (this.inFlight?.promise === operation) {
        this.inFlight = null
      }
    })

    this.inFlight = { generation, promise: operation }

    return operation
  }

  /** Realtime is deliberately only a coalesced wake-up hint. */
  realtimeHint(): Promise<MessagingSyncStatus> {
    return this.sync()
  }

  private async performSync(generation: number): Promise<MessagingSyncStatus> {
    this.assertLifecycle(generation)
    this.ensureActiveStore()

    if (!this.store) {
      this.transition('auth_expired', 'auth_unavailable')

      return this.status()
    }

    this.transition(this.state.synchronized ? 'reconnecting' : 'loading', null)

    try {
      const verified = await this.options.http.session()
      this.assertLifecycle(generation)
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

      const activeStore = this.requireStoreFor(generation)
      let cursor = activeStore.getSyncCursor().cursor
      let firstPage = true
      let pageCount = 0

      for (;;) {
        if (pageCount >= this.maxSyncPages) {
          throw new MessagingHttpError('sync_page_limit', 200, false, null, null, null)
        }

        const page = await this.options.http.sync(cursor)
        this.assertStoreLifecycle(generation, activeStore)

        if (page.hasMore && page.nextCursor === cursor) {
          throw new MessagingHttpError('invalid_response', 200, false, null, null, null)
        }

        await this.applyPage(page, firstPage, generation, activeStore)
        this.assertStoreLifecycle(generation, activeStore)

        if (!activeStore.commitSyncCursor(cursor, page.nextCursor, this.now().toISOString())) {
          throw new Error('sync_cursor_race')
        }

        cursor = page.nextCursor
        firstPage = false
        pageCount += 1

        if (!page.hasMore) {
          break
        }
      }

      await this.drainOutbox(generation)
      this.assertStoreLifecycle(generation, activeStore)
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
      this.scheduleRetry(this.pollMs, generation)
    } catch (error) {
      if (error instanceof StaleMessagingLifecycle || !this.isCurrent(generation)) {
        return this.status()
      }

      await this.handleSyncFailure(error, generation)
    }

    return this.status()
  }

  private async applyPage(
    page: SyncPage,
    firstPage: boolean,
    generation: number,
    store: MessagingStoreBoundary
  ): Promise<void> {
    this.assertStoreLifecycle(generation, store)
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
    this.assertStoreLifecycle(generation, store)

    for (const conversation of roster.conversations) {
      store.upsertConversation(conversation)

      if (
        firstPage ||
        page.changes.some(change => change.entity === 'conversation' || change.entity === 'participant')
      ) {
        affected.add(conversation.id)
      }
    }

    for (const conversationId of [...affected].sort()) {
      const history = await this.options.http.messages(conversationId)
      this.assertStoreLifecycle(generation, store)

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

  private async drainOutbox(generation = this.generation): Promise<void> {
    const store = this.requireStoreFor(generation)

    for (const due of store.listDueMutations(this.now().toISOString(), 100)) {
      this.assertStoreLifecycle(generation, store)
      const sending = store.markMutationSending(due.clientMessageId, this.now().toISOString())

      try {
        const acknowledged = await this.options.http.send(sending)
        this.assertStoreLifecycle(generation, store)
        store.canonicalizeMessage({
          message: acknowledged.message,
          clientMessageId: sending.clientMessageId,
          incrementUnread: false,
          now: this.now().toISOString()
        })
      } catch (error) {
        this.assertStoreLifecycle(generation, store)
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

  private async handleSyncFailure(error: unknown, generation: number): Promise<void> {
    this.assertLifecycle(generation)

    if (error instanceof MessagingHttpError && error.code === 'sync_cursor_expired' && error.details?.reset_required) {
      this.requireStore().resetProjection()
      this.state.synchronized = false
      this.scheduleRetry(0, generation)
      this.transition('reconnecting', error.code)

      return
    }

    if (error instanceof MessagingHttpError && error.status === 401) {
      this.cancelTimer()
      this.state.nextRetryAt = null
      this.transition('auth_expired', error.code)

      return
    }

    this.retryAttempt += 1
    const cached = this.requireStore().listConversations(1).length > 0
    this.transition(cached ? 'offline_cached' : 'error', error instanceof Error ? error.message : 'internal_error')

    if (this.isRetryable(error)) {
      this.scheduleRetry(nextDelay(this.retryAttempt, this.retryBaseMs), generation)
    } else {
      this.cancelTimer()
      this.state.nextRetryAt = null
    }
  }

  private ensureActiveStore(): void {
    if (this.stopped) {
      return
    }

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

  private requireStoreFor(generation: number): MessagingStoreBoundary {
    this.assertLifecycle(generation)
    const store = this.requireStore()
    this.assertStoreLifecycle(generation, store)

    return store
  }

  private transition(connectivity: MessagingSyncStatus['connectivity'], errorCode: string | null): void {
    this.state = { ...this.state, connectivity, errorCode }
  }

  private transitionAuthFailure(error: unknown): boolean {
    if (!(error instanceof MessagingHttpError) || error.status !== 401) {
      return false
    }

    this.cancelTimer()
    this.state.nextRetryAt = null
    this.transition('auth_expired', error.code)

    return true
  }

  private scheduleRetry(delayMs: number, generation = this.generation): void {
    if (!this.isCurrent(generation)) {
      return
    }

    if (this.timer) {
      this.clearTimer(this.timer)
    }

    const delay = Math.max(0, delayMs)
    this.state.nextRetryAt = new Date(this.now().getTime() + delay).toISOString()
    this.timer = this.setTimer(() => {
      this.timer = null

      if (!this.isCurrent(generation)) {
        return
      }

      void this.sync()
    }, delay)
  }

  private beginLifecycle(): void {
    this.generation += 1
    this.options.http.abortAll()
    this.cancelTimer()
  }

  private cancelTimer(): void {
    if (this.timer) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.stopped && generation === this.generation
  }

  private assertLifecycle(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new StaleMessagingLifecycle()
    }
  }

  private assertStoreLifecycle(generation: number, store: MessagingStoreBoundary): void {
    this.assertLifecycle(generation)

    if (this.store !== store || this.activeAccountId !== store.accountId) {
      throw new StaleMessagingLifecycle()
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof MessagingHttpError) {
      return error.retryable || error.status === 0 || error.status >= 500
    }

    return true
  }
}

export function conversationsAffectedBy(changes: readonly SyncChange[]): string[] {
  return [...new Set(changes.flatMap(change => (change.conversationId ? [change.conversationId] : [])))].sort()
}
