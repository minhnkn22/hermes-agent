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

export interface MessagingHttpClientOptions {
  requestTimeoutMs?: number
  maxResponseBytes?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const MAX_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_RETRY_AFTER_MS = 5 * 60_000

class ResponseTooLargeError extends Error {
  constructor() {
    super('response_too_large')
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(minimum, Math.min(Math.trunc(value), maximum))
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
  private readonly requestTimeoutMs: number
  private readonly maxResponseBytes: number
  private readonly activeRequests = new Set<AbortController>()
  private generation = 0

  constructor(
    private readonly tokens: MessagingTokenSource,
    private readonly fetchImpl: MessagingFetch = fetch,
    options: MessagingHttpClientOptions = {}
  ) {
    this.requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      10,
      MAX_REQUEST_TIMEOUT_MS
    )
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      MAX_RESPONSE_BYTES
    )
  }

  abortAll(): void {
    this.generation += 1

    for (const controller of this.activeRequests) {
      controller.abort()
    }

    this.activeRequests.clear()
  }

  session(): Promise<DesktopSessionBody> {
    return this.request('/session', {}, parseDesktopSession)
  }

  conversations() {
    return this.request('/conversations?limit=100', {}, parseConversationPage)
  }

  messages(conversationId: string) {
    return this.request(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`, {}, parseMessagePage)
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
    const generation = this.generation
    const original = this.tokens.current()

    if (!original) {
      throw new MessagingHttpError('auth_unavailable', 401, false, null, null, null)
    }

    try {
      return await this.requestWithSession(original, route, init, parse, generation)
    } catch (error) {
      if (!(error instanceof MessagingHttpError) || error.status !== 401) {
        throw error
      }

      const refreshed = await this.tokens.refresh(original)

      if (!refreshed || generation !== this.generation) {
        throw error
      }

      return this.requestWithSession(refreshed, route, init, parse, generation)
    }
  }

  private async requestWithSession<T>(
    session: MessagingAccountSession,
    route: string,
    init: RequestInit,
    parse: (value: unknown) => T,
    generation: number
  ): Promise<T> {
    if (generation !== this.generation) {
      throw new MessagingHttpError('temporarily_unavailable', 0, true, null, null, null)
    }

    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    headers.set('authorization', `Bearer ${session.tokens.accessToken}`)
    headers.set('x-request-id', `desktop_${randomUUID()}`)

    if (init.body !== undefined) {
      headers.set('content-type', 'application/json; charset=utf-8')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    this.activeRequests.add(controller)
    let response: Response
    let bytes: string

    try {
      response = await this.fetchImpl(endpoint(session.baseUrl, route), {
        ...init,
        headers,
        cache: 'no-store',
        signal: controller.signal
      })
      bytes = await this.readBoundedResponse(response, controller)
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        throw new MessagingHttpError('invalid_response', response?.status ?? 200, false, null, null, null)
      }

      throw new MessagingHttpError(
        'temporarily_unavailable',
        0,
        true,
        null,
        null,
        error instanceof Error ? { message: error.message } : null
      )
    } finally {
      clearTimeout(timeout)
      this.activeRequests.delete(controller)
    }

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
        typeof envelope.error.retry_after_ms === 'number'
          ? Math.max(0, Math.min(envelope.error.retry_after_ms, MAX_RETRY_AFTER_MS))
          : null,
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

  private async readBoundedResponse(response: Response, controller: AbortController): Promise<string> {
    const contentLength = Number(response.headers.get('content-length'))

    if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
      controller.abort()
      throw new ResponseTooLargeError()
    }

    if (!response.body) {
      return ''
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    let result = ''

    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        return result + decoder.decode()
      }

      size += value.byteLength

      if (size > this.maxResponseBytes) {
        controller.abort()
        await reader.cancel().catch(() => undefined)
        throw new ResponseTooLargeError()
      }

      result += decoder.decode(value, { stream: true })
    }
  }
}
