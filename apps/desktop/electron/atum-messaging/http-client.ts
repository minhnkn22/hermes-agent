import { randomUUID } from 'node:crypto'

import type { MessagingAccountSession, PendingMutation } from './types'
import {
  type DesktopSessionBody,
  parseConversationPage,
  parseDesktopError,
  parseDesktopSession,
  parseMessagePage,
  parseSendResponse,
  parseSyncPage,
  type SyncPage
} from './wire'

export interface MessagingTokenSource {
  current(): MessagingAccountSession | null
  refresh(rejected: MessagingAccountSession): Promise<MessagingAccountSession | null>
}

export interface MessagingFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
}

export class MessagingHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null,
    readonly retryAfterMs: number | null,
    readonly details: Record<string, unknown> | null
  ) {
    super(code)
  }
}

function endpoint(baseUrl: string, route: string): string {
  return `${baseUrl}/api/desktop/v1${route}`
}

export class AtumMessagingHttpClient {
  constructor(
    private readonly tokens: MessagingTokenSource,
    private readonly fetchImpl: MessagingFetch = fetch
  ) {}

  session(): Promise<DesktopSessionBody> {
    return this.request('/session', {}, parseDesktopSession)
  }

  conversations() {
    return this.request('/conversations?limit=100', {}, parseConversationPage)
  }

  messages(conversationId: string) {
    return this.request(
      `/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`,
      {},
      parseMessagePage
    )
  }

  send(mutation: PendingMutation) {
    return this.request(
      `/conversations/${encodeURIComponent(mutation.conversationId)}/messages`,
      {
        method: 'POST',
        headers: { 'idempotency-key': mutation.clientMessageId },
        body: JSON.stringify(mutation.request)
      },
      parseSendResponse
    )
  }

  markRead(conversationId: string, throughMessageId: string, clientOperationId: string): Promise<void> {
    return this.request(
      `/conversations/${encodeURIComponent(conversationId)}/read`,
      {
        method: 'PUT',
        headers: { 'idempotency-key': clientOperationId },
        body: JSON.stringify({ through_message_id: throughMessageId, client_operation_id: clientOperationId })
      },
      () => undefined
    )
  }

  sync(cursor: string | null): Promise<SyncPage> {
    const query = new URLSearchParams({ limit: '500' })

    if (cursor) {
      query.set('cursor', cursor)
    }

    return this.request(`/sync?${query}`, {}, parseSyncPage)
  }

  private async request<T>(route: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
    const original = this.tokens.current()

    if (!original) {
      throw new MessagingHttpError('auth_unavailable', 401, false, null, null, null)
    }

    try {
      return await this.requestWithSession(original, route, init, parse)
    } catch (error) {
      if (!(error instanceof MessagingHttpError) || error.status !== 401) {
        throw error
      }

      const refreshed = await this.tokens.refresh(original)

      if (!refreshed) {
        throw error
      }

      return this.requestWithSession(refreshed, route, init, parse)
    }
  }

  private async requestWithSession<T>(
    session: MessagingAccountSession,
    route: string,
    init: RequestInit,
    parse: (value: unknown) => T
  ): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    headers.set('authorization', `Bearer ${session.tokens.accessToken}`)
    headers.set('x-request-id', `desktop_${randomUUID()}`)

    if (init.body !== undefined) {
      headers.set('content-type', 'application/json; charset=utf-8')
    }

    let response: Response

    try {
      response = await this.fetchImpl(endpoint(session.baseUrl, route), {
        ...init,
        headers,
        cache: 'no-store'
      })
    } catch (error) {
      throw new MessagingHttpError(
        'temporarily_unavailable',
        0,
        true,
        null,
        null,
        error instanceof Error ? { message: error.message } : null
      )
    }

    const bytes = await response.text()
    let body: unknown

    try {
      body = bytes ? JSON.parse(bytes) : null
    } catch {
      throw new MessagingHttpError('invalid_response', response.status, false, null, null, null)
    }

    if (!response.ok) {
      const envelope = parseDesktopError(body)

      if (!envelope) {
        throw new MessagingHttpError('invalid_response', response.status, false, null, null, null)
      }

      throw new MessagingHttpError(
        envelope.error.code,
        response.status,
        envelope.error.retryable,
        envelope.error.request_id,
        typeof envelope.error.retry_after_ms === 'number' ? envelope.error.retry_after_ms : null,
        envelope.error.details ?? null
      )
    }

    try {
      return parse(body)
    } catch (error) {
      throw new MessagingHttpError(
        error instanceof Error ? error.message : 'invalid_response',
        response.status,
        false,
        response.headers.get('x-request-id'),
        null,
        null
      )
    }
  }
}
