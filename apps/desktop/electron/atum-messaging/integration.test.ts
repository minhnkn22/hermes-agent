import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, test } from 'vitest'

import type { SafeStorageLike } from './credential-vault'
import { AtumMessagingRuntime } from './runtime'
import { AtumMessagingStore } from './store'
import type { MessagingAccountSession } from './types'

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
  for (const runtime of runtimes.splice(0)) {runtime.stop()}
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))

  for (const directory of temporaryDirectories.splice(0)) {rmSync(directory, { recursive: true, force: true })}
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
  requestLog: Array<{ method: string; path: string; authorization: string | undefined; body: string }>
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
    state.requestLog.push({ method: request.method ?? 'GET', path: `${url.pathname}${url.search}`, authorization, body })
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
      send(200, {
        user: { id: account, display_name: account === ACCOUNT_A ? 'Minh' : 'Lan', handle: null },
        realtime: { transport: 'supabase_private_broadcast', topic: `user:${account}:messaging:v1` },
        server_time: '2026-08-12T03:00:00.000Z',
        sync_cursor: 'session-cursor-must-not-skip-initial-backfill'
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
        next_cursor: account === ACCOUNT_A ? 'cursor-a' : 'cursor-b',
        has_more: false,
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
      if (state.sendFailure) {
        send(503, {
          error: {
            code: 'temporarily_unavailable',
            message_key: 'messaging.error.temporarily_unavailable',
            retryable: true,
            request_id: 'req_send',
            retry_after_ms: 1
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
  assert.deepEqual((await runtime.roster()).map(row => row.id), [CONVERSATION_A])

  await runtime.installSession(session(baseUrl, ACCOUNT_B, 'token-b'))
  assert.equal((await runtime.status()).accountId, ACCOUNT_B)
  assert.deepEqual((await runtime.roster()).map(row => row.id), [CONVERSATION_B])
  assert.equal((await runtime.messages(CONVERSATION_A)).length, 0)
})
