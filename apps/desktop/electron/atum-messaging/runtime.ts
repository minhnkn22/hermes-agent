import { join } from 'node:path'

import { MessagingCredentialVault, type SafeStorageLike } from './credential-vault'
import { AtumMessagingHttpClient, type MessagingFetch, type MessagingTokenSource } from './http-client'
import { AtumMessagingSyncEngine } from './sync-engine'
import type { MessagingAccountSession, MessagingClientBoundary, MessagingSyncStatus } from './types'

export interface AtumMessagingRuntimeOptions {
  userDataPath: string
  safeStorage: SafeStorageLike
  fetchImpl?: MessagingFetch
  refreshSession?: (session: MessagingAccountSession, signal: AbortSignal) => Promise<MessagingAccountSession | null>
  requestTimeoutMs?: number
  maxResponseBytes?: number
  maxSyncPages?: number
}

/**
 * Owns credentials and the sync engine in Electron main. `installSession` is a
 * main-only assembly seam for the account-login lane; it is intentionally not
 * registered in preload/IPC.
 */
export class AtumMessagingRuntime implements MessagingClientBoundary {
  private readonly vault: MessagingCredentialVault
  private readonly engine: AtumMessagingSyncEngine
  private sessionValue: MessagingAccountSession | null
  private refreshFlight: {
    controller: AbortController
    generation: number
    identity: string
    promise: Promise<MessagingAccountSession | null>
  } | null = null
  private sessionGeneration = 0

  constructor(private readonly options: AtumMessagingRuntimeOptions) {
    this.vault = new MessagingCredentialVault(
      join(options.userDataPath, 'atum-messaging', 'session.json'),
      options.safeStorage
    )

    try {
      this.sessionValue = this.vault.load()
    } catch {
      // A locked/unavailable keychain must not brick the Hermes-powered app.
      // The messaging surface reports auth_expired until the main-process
      // account flow can install a decryptable session.
      this.sessionValue = null
    }

    const tokenSource: MessagingTokenSource = {
      current: () => this.sessionValue,
      refresh: rejected => {
        // Do not refresh a session which was replaced while the rejected
        // request was in flight.
        if (!this.sameSession(this.sessionValue, rejected)) {
          return Promise.resolve(this.sessionValue)
        }

        const generation = this.sessionGeneration
        const identity = this.sessionIdentity(rejected)

        if (this.refreshFlight?.generation === generation && this.refreshFlight.identity === identity) {
          return this.refreshFlight.promise
        }

        const controller = new AbortController()
        // Defer execution one microtask so even a non-conforming refresh
        // callback that throws synchronously cannot settle before the flight
        // is published for concurrent 401s.
        const promise = Promise.resolve().then(() => this.performRefresh(rejected, generation, identity, controller))
        this.refreshFlight = { controller, generation, identity, promise }

        return promise
      }
    }

    const http = new AtumMessagingHttpClient(tokenSource, options.fetchImpl, {
      requestTimeoutMs: options.requestTimeoutMs,
      maxResponseBytes: options.maxResponseBytes
    })

    this.engine = new AtumMessagingSyncEngine({
      userDataPath: options.userDataPath,
      http,
      session: () => this.sessionValue,
      maxSyncPages: options.maxSyncPages,
      persistVerifiedSession: session => {
        this.sessionValue = session
        this.vault.save(session)
      }
    })
  }

  start(): Promise<MessagingSyncStatus> {
    return this.engine.start()
  }

  stop(): void {
    this.beginSessionLifecycle()
    this.engine.stop()
  }

  async installSession(session: MessagingAccountSession): Promise<MessagingSyncStatus> {
    this.beginSessionLifecycle()
    this.vault.save(session)
    this.sessionValue = this.vault.load()

    return this.engine.replaceSession(this.sessionValue)
  }

  async clearSession(): Promise<MessagingSyncStatus> {
    this.beginSessionLifecycle()
    this.vault.clear()
    this.sessionValue = null

    return this.engine.replaceSession(null)
  }

  /** Sanitized account metadata for the account controller; tokens stay private. */
  accountProfile() {
    return this.sessionValue ? { ...this.sessionValue.user } : null
  }

  status = () => this.engine.status()
  roster = (limit?: number) => this.engine.roster(limit)
  messages = (conversationId: string, limit?: number) => this.engine.messages(conversationId, limit)
  draft = (conversationId: string) => this.engine.draft(conversationId)
  saveDraft = (conversationId: string, draft: Parameters<MessagingClientBoundary['saveDraft']>[1]) =>
    this.engine.saveDraft(conversationId, draft)
  send = (input: Parameters<MessagingClientBoundary['send']>[0]) => this.engine.send(input)
  retry = (clientMessageId: string) => this.engine.retry(clientMessageId)
  markRead = (conversationId: string, throughMessageId: string) =>
    this.engine.markRead(conversationId, throughMessageId)
  sync = () => this.engine.sync()
  realtimeHint = () => this.engine.realtimeHint()

  private beginSessionLifecycle(): void {
    this.sessionGeneration += 1
    this.refreshFlight?.controller.abort()
    this.refreshFlight = null
  }

  private sameSession(current: MessagingAccountSession | null, expected: MessagingAccountSession): boolean {
    return current !== null && this.sessionIdentity(current) === this.sessionIdentity(expected)
  }

  private sessionIdentity(session: MessagingAccountSession): string {
    return [session.baseUrl, session.user.id, session.tokens.accessToken, session.tokens.refreshToken].join('\0')
  }

  private async performRefresh(
    rejected: MessagingAccountSession,
    generation: number,
    identity: string,
    controller: AbortController
  ): Promise<MessagingAccountSession | null> {
    let refreshed: MessagingAccountSession | null = null

    try {
      refreshed = (await this.options.refreshSession?.(rejected, controller.signal)) ?? null

      if (
        controller.signal.aborted ||
        generation !== this.sessionGeneration ||
        !this.sameSession(this.sessionValue, rejected)
      ) {
        return this.sessionValue
      }

      if (refreshed) {
        this.sessionValue = refreshed
        this.vault.save(refreshed)
      }

      return refreshed
    } finally {
      if (this.refreshFlight?.generation === generation && this.refreshFlight.identity === identity) {
        this.refreshFlight = null
      }
    }
  }
}
