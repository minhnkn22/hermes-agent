import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, test } from 'vitest'

import { normalizeBaseUrl, type SafeStorageLike } from './credential-vault'
import { AtumMessagingRuntime } from './runtime'
import { AtumMessagingStore } from './store'
import type { CanonicalMessage, MessagingAccountSession } from './types'

const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONVERSATION_A = '33333333-3333-4333-8333-333333333333'
const CONVERSATION_B = '77777777-7777-4777-8777-777777777777'
const MESSAGE_A = '22222222-2222-4222-8222-222222222222'
const CLIENT_A = '11111111-1111-4111-8111-111111111111'

const temporaryDirectories: string[] = []
const runtimes: AtumMessagingRuntime[] = []
const servers: http.Server[] = []

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stop()
  }

  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tempUserData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'atum-sync-'))
  temporaryDirectories.push(directory)

  return directory
}

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`sealed:${value}`, 'utf8'),
  decryptString: value => {
    const decoded = value.toString('utf8')
    assert.ok(decoded.startsWith('sealed:'))

    return decoded.slice('sealed:'.length)
  }
}

function message(
  id = MESSAGE_A,
  conversationId = CONVERSATION_A,
  content = 'Chào bạn — Atum đang hoạt động trên máy Mac.'
) {
  return {
    id,
    conversation_id: conversationId,
    sender: { type: 'user', id: ACCOUNT_B },
    content,
    kind: 'text',
    attachments: [],
    reply_to_message_id: null,
    forwarded_from: null,
    reactions: [],
    version: 1,
    created_at: '2026-08-12T03:00:00.000Z',
    edited_at: null,
    recalled_at: null,
    delivery: 'sent'
  }
}

function conversation(id = CONVERSATION_A, peer = ACCOUNT_B) {
  return {
    id,
    specialist: null,
    participants: [
      { type: 'user', id: ACCOUNT_A, display_name: 'Minh' },
      { type: 'user', id: peer, display_name: 'Bạn' }
    ],
    read_state: { last_read_message_id: null, read_at: null },
    state: { pinned: false, muted: false, archived: false },
    created_at: '2026-08-12T02:00:00.000Z',
    updated_at: '2026-08-12T03:00:00.000Z'
  }
}

interface FakeState {
  accountForToken: Record<string, string>
  conversations: Record<string, ReturnType<typeof conversation>[]>
  messages: Record<string, ReturnType<typeof message>[]>
  syncChanges: any[]
  syncFailure?: boolean
  rosterFailure?: boolean
  sendFailure?: boolean
  sendRetryAfterMs?: number
  sendAuthFailure?: boolean
  readFailure?: boolean
  hangSessionTokens?: Set<string>
  oversizedSessionBytes?: number
  syncAlwaysHasMore?: boolean
  requestLog: Array<{
    method: string
    path: string
    authorization: string | undefined
    idempotencyKey: string | undefined
    body: string
  }>
  syncCursors: Array<string | null>
}

async function fakeServer(state: FakeState): Promise<string> {
  const server = http.createServer(async (request, response) => {
    const body = await new Promise<string>(resolve => {
      let value = ''
      request.setEncoding('utf8')
      request.on('data', chunk => (value += chunk))
      request.on('end', () => resolve(value))
    })

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const authorization = request.headers.authorization
    state.requestLog.push({
      method: request.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      authorization,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      body
    })
    const token = authorization?.replace(/^Bearer /, '') ?? ''
    const account = state.accountForToken[token]

    const send = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(value))
    }

    if (!account) {
      send(401, {
        error: {
          code: 'token_expired',
          message_key: 'messaging.error.token_expired',
          retryable: true,
          request_id: 'req_auth'
        }
      })

      return
    }

    if (url.pathname.endsWith('/session')) {
      if (state.hangSessionTokens?.delete(token)) {
        return
      }

      send(200, {
        user: { id: account, display_name: account === ACCOUNT_A ? 'Minh' : 'Lan', handle: null },
        realtime: { transport: 'supabase_private_broadcast', topic: `user:${account}:messaging:v1` },
        server_time: '2026-08-12T03:00:00.000Z',
        sync_cursor: 'session-cursor-must-not-skip-initial-backfill',
        padding: state.oversizedSessionBytes ? 'x'.repeat(state.oversizedSessionBytes) : undefined
      })

      return
    }

    if (url.pathname.endsWith('/sync')) {
      state.syncCursors.push(url.searchParams.get('cursor'))

      if (state.syncFailure) {
        send(503, {
          error: {
            code: 'temporarily_unavailable',
            message_key: 'messaging.error.temporarily_unavailable',
            retryable: true,
            request_id: 'req_sync'
          }
        })

        return
      }

      send(200, {
        changes: account === ACCOUNT_A ? state.syncChanges : [],
        next_cursor: state.syncAlwaysHasMore
          ? `cursor-page-${state.syncCursors.length}`
          : account === ACCOUNT_A
            ? 'cursor-a'
            : 'cursor-b',
        has_more: state.syncAlwaysHasMore ?? false,
        server_time: '2026-08-12T03:00:02.000Z'
      })

      return
    }

    if (url.pathname.endsWith('/conversations')) {
      if (state.rosterFailure) {
        send(503, {
          error: {
            code: 'temporarily_unavailable',
            message_key: 'messaging.error.temporarily_unavailable',
            retryable: true,
            request_id: 'req_roster'
          }
        })

        return
      }

      send(200, { conversations: state.conversations[account] ?? [], next_cursor: null, has_more: false })

      return
    }

    const messagesMatch = /\/conversations\/([^/]+)\/messages$/.exec(url.pathname)

    if (messagesMatch && request.method === 'POST') {
      if (state.sendAuthFailure) {
        send(401, {
          error: {
            code: 'token_expired',
            message_key: 'messaging.error.token_expired',
            retryable: true,
            request_id: 'req_send_auth'
          }
        })

        return
      }

      if (state.sendFailure) {
        send(503, {
          error: {
            code: 'temporarily_unavailable',
            message_key: 'messaging.error.temporarily_unavailable',
            retryable: true,
            request_id: 'req_send',
            retry_after_ms: state.sendRetryAfterMs ?? 1
          }
        })

        return
      }

      const input = JSON.parse(body)
      const canonical = message(`server-${input.client_message_id}`, messagesMatch[1], input.content)
      state.messages[messagesMatch[1]] = [canonical]
      send(201, { message: canonical, replayed: false })

      return
    }

    if (messagesMatch) {
      send(200, { messages: state.messages[messagesMatch[1]] ?? [], next_cursor: null, has_more: false })

      return
    }

    if (url.pathname.endsWith('/read')) {
      if (state.readFailure) {
        send(503, {
          error: {
            code: 'temporarily_unavailable',
            message_key: 'messaging.error.temporarily_unavailable',
            retryable: true,
            request_id: 'req_read'
          }
        })

        return
      }

      send(200, { read_state: {}, replayed: false })

      return
    }

    send(404, {
      error: { code: 'not_found', message_key: 'messaging.error.not_found', retryable: false, request_id: 'req_404' }
    })
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return `http://127.0.0.1:${address.port}`
}

function state(): FakeState {
  return {
    accountForToken: { 'token-a': ACCOUNT_A, 'token-b': ACCOUNT_B },
    conversations: {
      [ACCOUNT_A]: [conversation()],
      [ACCOUNT_B]: [conversation(CONVERSATION_B, ACCOUNT_A)]
    },
    messages: { [CONVERSATION_A]: [message()], [CONVERSATION_B]: [] },
    syncChanges: [
      {
        change_id: '9001',
        entity: 'message',
        operation: 'upsert',
        entity_id: MESSAGE_A,
        conversation_id: CONVERSATION_A,
        value: { version: 1 },
        occurred_at: '2026-08-12T03:00:00.000Z'
      }
    ],
    requestLog: [],
    syncCursors: []
  }
}

function session(baseUrl: string, accountId = ACCOUNT_A, accessToken = 'token-a'): MessagingAccountSession {
  return {
    baseUrl,
    user: { id: accountId, displayName: null, handle: null },
    tokens: { accessToken, refreshToken: 'refresh', expiresAt: null }
  }
}

test('session base URLs discard userinfo before persistence or requests', () => {
  assert.equal(
    normalizeBaseUrl('https://username:password@example.com/atum/?ignored=yes#fragment'),
    'https://example.com/atum'
  )
})

async function waitForRequest(fake: FakeState, predicate: (request: FakeState['requestLog'][number]) => boolean) {
  const deadline = Date.now() + 2_000

  while (!fake.requestLog.some(predicate)) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for fake-server request')
    }

    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('real HTTP bytes perform initial backfill without trusting the session cursor and collapse ack/realtime echoes', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  const runtime = new AtumMessagingRuntime({ userDataPath: tempUserData(), safeStorage })
  runtimes.push(runtime)
  await runtime.installSession(session(baseUrl))

  assert.deepEqual(fake.syncCursors, [null])
  assert.equal((await runtime.roster()).length, 1)
  assert.equal((await runtime.messages(CONVERSATION_A)).length, 1)

  await runtime.send({
    conversationId: CONVERSATION_A,
    clientMessageId: CLIENT_A,
    content: 'Một lần duy nhất',
    locale: 'vi'
  })
  fake.syncChanges = [
    {
      change_id: '9002',
      entity: 'message',
      operation: 'upsert',
      entity_id: `server-${CLIENT_A}`,
      conversation_id: CONVERSATION_A,
      value: { version: 1 },
      occurred_at: '2026-08-12T03:00:03.000Z'
    }
  ]
  await runtime.realtimeHint()

  const rows = await runtime.messages(CONVERSATION_A)
  assert.equal(rows.filter(row => row.clientMessageId === CLIENT_A || row.id === `server-${CLIENT_A}`).length, 1)
  assert.equal(rows.find(row => row.id === `server-${CLIENT_A}`)?.optimistic, false)
})

test('an ordinary incremental poll with no changes does not refetch full message history', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  const runtime = new AtumMessagingRuntime({ userDataPath: tempUserData(), safeStorage })
  runtimes.push(runtime)
  await runtime.installSession(session(baseUrl))

  const historyRequestsAfterBackfill = fake.requestLog.filter(
    request => request.method === 'GET' && /\/conversations\/[^/]+\/messages(?:\?|$)/.test(request.path)
  ).length

  fake.syncChanges = []
  await runtime.sync()

  assert.equal(historyRequestsAfterBackfill, 1)
  assert.equal(
    fake.requestLog.filter(
      request => request.method === 'GET' && /\/conversations\/[^/]+\/messages(?:\?|$)/.test(request.path)
    ).length,
    historyRequestsAfterBackfill
  )
})

test('mark-read advances local unread state even when the hosted write is offline', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  const userDataPath = tempUserData()
  const initial = new AtumMessagingRuntime({ userDataPath, safeStorage })
  runtimes.push(initial)
  await initial.installSession(session(baseUrl))
  initial.stop()

  const store = new AtumMessagingStore({
    accountId: ACCOUNT_A,
    databasePath: join(userDataPath, 'atum-messaging', 'messaging.sqlite3')
  })

  const unreadId = '55555555-5555-4555-8555-555555555555'

  const unread: CanonicalMessage = {
    id: unreadId,
    conversationId: CONVERSATION_A,
    sender: { type: 'user', id: ACCOUNT_B },
    content: 'Tin chưa đọc',
    kind: 'text',
    attachments: [],
    replyToMessageId: null,
    forwardedFrom: null,
    reactions: [],
    version: 1,
    createdAt: '2026-08-12T03:00:03.000Z',
    editedAt: null,
    recalledAt: null,
    delivery: 'sent'
  }

  store.canonicalizeMessage({
    message: unread,
    incrementUnread: true
  })
  assert.equal(store.listConversations()[0]?.unreadCount, 1)
  store.close()

  fake.syncChanges = []
  const runtime = new AtumMessagingRuntime({ userDataPath, safeStorage })
  runtimes.push(runtime)
  await runtime.start()
  fake.readFailure = true

  assert.equal(await runtime.markRead(CONVERSATION_A, unreadId), true)
  assert.equal((await runtime.roster())[0]?.unreadCount, 0)
  assert.equal((await runtime.status()).connectivity, 'offline_cached')
})

test('401 refresh is owned by main and replays the rejected request exactly once', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  let refreshes = 0

  const runtime = new AtumMessagingRuntime({
    userDataPath: tempUserData(),
    safeStorage,
    refreshSession: async rejected => {
      refreshes += 1

      return { ...rejected, tokens: { ...rejected.tokens, accessToken: 'token-a' } }
    }
  })

  runtimes.push(runtime)
  await runtime.installSession(session(baseUrl, ACCOUNT_A, 'expired-token'))

  assert.equal(refreshes, 1)
  assert.equal((await runtime.status()).connectivity, 'online')
  assert.deepEqual(
    fake.requestLog.slice(0, 2).map(request => request.authorization),
    ['Bearer expired-token', 'Bearer token-a']
  )
})

test('cursor advances only after a page is durably projected and errors never become empty success', async () => {
  const fake = state()
  fake.rosterFailure = true
  const baseUrl = await fakeServer(fake)
  const userData = tempUserData()
  const runtime = new AtumMessagingRuntime({ userDataPath: userData, safeStorage })
  runtimes.push(runtime)
  const failed = await runtime.installSession(session(baseUrl))

  assert.equal(failed.cursor, null)
  assert.equal(failed.connectivity, 'error')

  fake.rosterFailure = false
  await runtime.sync()
  assert.deepEqual(fake.syncCursors, [null, null])
  assert.equal((await runtime.status()).cursor, 'cursor-a')
  assert.equal((await runtime.roster()).length, 1)

  fake.rosterFailure = true
  fake.syncChanges = [{ ...fake.syncChanges[0], change_id: '9002' }]
  await runtime.sync()
  assert.equal((await runtime.status()).connectivity, 'offline_cached')
  assert.equal((await runtime.roster()).length, 1, 'cached roster survives an explicit server error')
})

test('offline send retries with identical bytes and restart recovers a sending outbox row', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  const userData = tempUserData()
  const runtime = new AtumMessagingRuntime({ userDataPath: userData, safeStorage })
  runtimes.push(runtime)
  await runtime.installSession(session(baseUrl))

  fake.sendFailure = true
  await runtime.send({ conversationId: CONVERSATION_A, clientMessageId: CLIENT_A, content: 'Giữ nguyên', locale: 'vi' })
  assert.equal(
    (await runtime.messages(CONVERSATION_A)).find(row => row.clientMessageId === CLIENT_A)?.delivery,
    'failed_retryable'
  )
  const firstBody = fake.requestLog.find(request => request.method === 'POST')?.body
  fake.sendFailure = false
  await runtime.retry(CLIENT_A)
  const sendBodies = fake.requestLog.filter(request => request.method === 'POST').map(request => request.body)
  assert.deepEqual(sendBodies, [firstBody, firstBody])
  assert.deepEqual(
    fake.requestLog.filter(request => request.method === 'POST').map(request => request.idempotencyKey),
    [CLIENT_A, CLIENT_A]
  )

  runtime.stop()

  const store = new AtumMessagingStore({
    accountId: ACCOUNT_A,
    databasePath: join(userData, 'atum-messaging', 'messaging.sqlite3')
  })

  store.queueSend({
    conversationId: CONVERSATION_A,
    clientMessageId: '99999999-9999-4999-8999-999999999999',
    content: 'Khôi phục sau restart',
    locale: 'vi'
  })
  store.markMutationSending('99999999-9999-4999-8999-999999999999')
  store.close()

  const restarted = new AtumMessagingRuntime({ userDataPath: userData, safeStorage })
  runtimes.push(restarted)
  await restarted.start()
  assert.equal(
    (await restarted.messages(CONVERSATION_A)).some(row => row.content === 'Khôi phục sau restart' && !row.optimistic),
    true
  )
})

test('account switch closes the previous projection boundary and opens the verified account partition', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  const runtime = new AtumMessagingRuntime({ userDataPath: tempUserData(), safeStorage })
  runtimes.push(runtime)
  await runtime.installSession(session(baseUrl))
  assert.deepEqual(
    (await runtime.roster()).map(row => row.id),
    [CONVERSATION_A]
  )

  await runtime.installSession(session(baseUrl, ACCOUNT_B, 'token-b'))
  assert.equal((await runtime.status()).accountId, ACCOUNT_B)
  assert.deepEqual(
    (await runtime.roster()).map(row => row.id),
    [CONVERSATION_B]
  )
  assert.equal((await runtime.messages(CONVERSATION_A)).length, 0)
})

test('a bounded HTTP timeout aborts a hung server request and explicit retry recovers', async () => {
  const fake = state()
  fake.hangSessionTokens = new Set(['token-a'])
  const baseUrl = await fakeServer(fake)

  const runtime = new AtumMessagingRuntime({
    userDataPath: tempUserData(),
    safeStorage,
    requestTimeoutMs: 250
  })

  runtimes.push(runtime)

  const timedOut = await runtime.installSession(session(baseUrl))
  assert.equal(timedOut.connectivity, 'error')
  assert.equal(timedOut.errorCode, 'temporarily_unavailable')

  const recovered = await runtime.sync()
  assert.equal(recovered.connectivity, 'online')
  assert.deepEqual(
    (await runtime.roster()).map(row => row.id),
    [CONVERSATION_A]
  )
})

test('stop and account switch abort stale in-flight work without reopening or clobbering stores', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)

  const stoppedRuntime = new AtumMessagingRuntime({
    userDataPath: tempUserData(),
    safeStorage,
    requestTimeoutMs: 5_000
  })

  runtimes.push(stoppedRuntime)
  await stoppedRuntime.installSession(session(baseUrl))

  fake.hangSessionTokens = new Set(['token-a'])
  const stopRequestStart = fake.requestLog.length
  const stoppedSync = stoppedRuntime.sync()
  await waitForRequest(
    fake,
    request => fake.requestLog.indexOf(request) >= stopRequestStart && request.path.endsWith('/session')
  )
  stoppedRuntime.stop()
  await stoppedSync
  assert.throws(() => stoppedRuntime.roster(), /auth_unavailable/)

  const switchedRuntime = new AtumMessagingRuntime({
    userDataPath: tempUserData(),
    safeStorage,
    requestTimeoutMs: 5_000
  })

  runtimes.push(switchedRuntime)
  await switchedRuntime.installSession(session(baseUrl))
  fake.hangSessionTokens = new Set(['token-a'])
  const switchRequestStart = fake.requestLog.length
  const staleSync = switchedRuntime.sync()
  await waitForRequest(
    fake,
    request => fake.requestLog.indexOf(request) >= switchRequestStart && request.path.endsWith('/session')
  )

  const switched = await switchedRuntime.installSession(session(baseUrl, ACCOUNT_B, 'token-b'))
  await staleSync
  assert.equal(switched.accountId, ACCOUNT_B)
  assert.equal((await switchedRuntime.status()).connectivity, 'online')
  assert.deepEqual(
    (await switchedRuntime.roster()).map(row => row.id),
    [CONVERSATION_B]
  )
  assert.equal((await switchedRuntime.messages(CONVERSATION_A)).length, 0)
})

test('a refresh completing after account switch cannot overwrite or replay the previous account', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  let markRefreshStarted!: () => void
  let resolveRefresh!: (value: MessagingAccountSession) => void

  const refreshStarted = new Promise<void>(resolve => {
    markRefreshStarted = resolve
  })

  const runtime = new AtumMessagingRuntime({
    userDataPath: tempUserData(),
    safeStorage,
    refreshSession: rejected =>
      new Promise<MessagingAccountSession>(refreshResolve => {
        resolveRefresh = refreshResolve
        markRefreshStarted()
      }).then(refreshed => ({ ...rejected, ...refreshed }))
  })

  runtimes.push(runtime)

  const staleInstall = runtime.installSession(session(baseUrl, ACCOUNT_A, 'expired-token'))
  await refreshStarted
  await runtime.installSession(session(baseUrl, ACCOUNT_B, 'token-b'))
  resolveRefresh(session(baseUrl, ACCOUNT_A, 'token-a'))
  await staleInstall
  assert.equal((await runtime.status()).accountId, ACCOUNT_B)
  assert.deepEqual(
    (await runtime.roster()).map(row => row.id),
    [CONVERSATION_B]
  )
  assert.equal(
    fake.requestLog.filter(request => request.authorization === 'Bearer token-a').length,
    0,
    'stale refresh must not replay its request after the lifecycle was aborted'
  )
})

test('send and retry 401 responses become auth_expired without rejecting the renderer command', async () => {
  const fake = state()
  const baseUrl = await fakeServer(fake)
  const runtime = new AtumMessagingRuntime({ userDataPath: tempUserData(), safeStorage })
  runtimes.push(runtime)
  await runtime.installSession(session(baseUrl))

  fake.sendAuthFailure = true
  await runtime.send({
    conversationId: CONVERSATION_A,
    clientMessageId: CLIENT_A,
    content: 'Auth hết hạn khi gửi',
    locale: 'vi'
  })
  assert.equal((await runtime.status()).connectivity, 'auth_expired')
  assert.equal((await runtime.status()).errorCode, 'token_expired')

  fake.sendAuthFailure = false
  await runtime.installSession(session(baseUrl))
  fake.sendFailure = true
  const retryClient = '44444444-4444-4444-8444-444444444444'
  await runtime.send({
    conversationId: CONVERSATION_A,
    clientMessageId: retryClient,
    content: 'Auth hết hạn khi thử lại',
    locale: 'vi'
  })
  fake.sendFailure = false
  fake.sendAuthFailure = true
  await runtime.retry(retryClient)
  assert.equal((await runtime.status()).connectivity, 'auth_expired')
  assert.equal((await runtime.status()).errorCode, 'token_expired')
})

test('server retry_after_ms is finite and clamped before it reaches the durable outbox', async () => {
  const fake = state()
  fake.sendFailure = true
  fake.sendRetryAfterMs = Number.MAX_SAFE_INTEGER
  const baseUrl = await fakeServer(fake)
  const userDataPath = tempUserData()
  const runtime = new AtumMessagingRuntime({ userDataPath, safeStorage })
  runtimes.push(runtime)
  await runtime.installSession(session(baseUrl))
  await runtime.send({
    conversationId: CONVERSATION_A,
    clientMessageId: CLIENT_A,
    content: 'Thử lại có giới hạn',
    locale: 'vi'
  })
  runtime.stop()

  const store = new AtumMessagingStore({
    accountId: ACCOUNT_A,
    databasePath: join(userDataPath, 'atum-messaging', 'messaging.sqlite3')
  })

  assert.equal(
    store.listDueMutations(new Date(Date.now() + 301_000).toISOString()).some(row => row.clientMessageId === CLIENT_A),
    true
  )
  store.close()
})

test('wire and pagination caps turn deterministic poison pages into explicit non-looping errors', async () => {
  const fake = state()
  fake.syncChanges = [{ ...fake.syncChanges[0], change_id: `poison-${'x'.repeat(8_192)}` }]
  const baseUrl = await fakeServer(fake)
  const poisonRuntime = new AtumMessagingRuntime({ userDataPath: tempUserData(), safeStorage })
  runtimes.push(poisonRuntime)
  const poison = await poisonRuntime.installSession(session(baseUrl))
  assert.equal(poison.connectivity, 'error')
  assert.match(poison.errorCode ?? '', /invalid_response:sync\.changes\.0\.change_id/)
  assert.equal(poison.nextRetryAt, null)

  const pagedFake = state()
  pagedFake.syncAlwaysHasMore = true
  const pagedBaseUrl = await fakeServer(pagedFake)

  const pagedRuntime = new AtumMessagingRuntime({
    userDataPath: tempUserData(),
    safeStorage,
    maxSyncPages: 2
  })

  runtimes.push(pagedRuntime)
  const capped = await pagedRuntime.installSession(session(pagedBaseUrl))
  assert.equal(capped.errorCode, 'sync_page_limit')
  assert.equal(capped.nextRetryAt, null)
  assert.equal(pagedFake.syncCursors.length, 2)
})

test('oversized responses are rejected before JSON projection', async () => {
  const fake = state()
  fake.oversizedSessionBytes = 2_000
  const baseUrl = await fakeServer(fake)

  const runtime = new AtumMessagingRuntime({
    userDataPath: tempUserData(),
    safeStorage,
    maxResponseBytes: 1_024
  })

  runtimes.push(runtime)
  const result = await runtime.installSession(session(baseUrl))
  assert.equal(result.connectivity, 'error')
  assert.equal(result.errorCode, 'invalid_response')
  assert.equal(result.nextRetryAt, null)
})
