import { join } from 'node:path'

import { MessagingCredentialVault, type SafeStorageLike } from './credential-vault'
import { AtumMessagingHttpClient, type MessagingFetch, type MessagingTokenSource } from './http-client'
import { AtumMessagingSyncEngine } from './sync-engine'
import type { MessagingAccountSession, MessagingClientBoundary, MessagingSyncStatus } from './types'

export interface AtumMessagingRuntimeOptions {
  userDataPath: string
  safeStorage: SafeStorageLike
  fetchImpl?: MessagingFetch
  refreshSession?: (session: MessagingAccountSession) => Promise<MessagingAccountSession | null>
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
      refresh: async rejected => {
        // Do not refresh a session which was replaced while the rejected
        // request was in flight.
        if (!this.sessionValue || this.sessionValue.tokens.accessToken !== rejected.tokens.accessToken) {
          return this.sessionValue
        }

        const refreshed = (await options.refreshSession?.(rejected)) ?? null

        if (!this.sessionValue || this.sessionValue.tokens.accessToken !== rejected.tokens.accessToken) {
          return this.sessionValue
        }

        if (refreshed) {
          this.sessionValue = refreshed
          this.vault.save(refreshed)
        }

        return refreshed
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
    this.engine.stop()
  }

  async installSession(session: MessagingAccountSession): Promise<MessagingSyncStatus> {
    this.vault.save(session)
    this.sessionValue = this.vault.load()

    return this.engine.replaceSession(this.sessionValue)
  }

  async clearSession(): Promise<MessagingSyncStatus> {
    this.vault.clear()
    this.sessionValue = null

    return this.engine.replaceSession(null)
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
}
