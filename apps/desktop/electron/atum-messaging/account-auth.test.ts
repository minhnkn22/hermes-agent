import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, test, vi } from 'vitest'

import {
  AtumAccountAuthController,
  resolveAtumAccountConfig,
  SupabaseAtumAccountClient
} from './account-auth'
import type { SafeStorageLike } from './credential-vault'
import { AtumMessagingRuntime } from './runtime'

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type AuthorizeMode = 'success' | 'state_mismatch' | 'callback_error' | 'never'

interface FakeAuthState {
  authorizeMode: AuthorizeMode
  userId: string
  hostedUserId?: string
  passwordAccepted: boolean
  passwordNeverRespond?: boolean
  passwordOversized?: boolean
  malformedToken: boolean
  refreshCount: number
  tokenCount: number
  validTokens: Set<string>
  requests: Array<{ method: string; path: string; body: string; authorization: string | undefined }>
}

const servers: http.Server[] = []
const directories: string[] = []
const runtimes: AtumMessagingRuntime[] = []

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {runtime.stop()}
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))

  for (const directory of directories.splice(0)) {rmSync(directory, { recursive: true, force: true })}
})

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`sealed:${value}`, 'utf8'),
  decryptString: value => {
    const decoded = value.toString('utf8')
    assert.ok(decoded.startsWith('sealed:'))

    return decoded.slice('sealed:'.length)
  }
}

function userData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'atum-account-auth-'))
  directories.push(directory)

  return directory
}

async function body(request: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let value = ''
    request.setEncoding('utf8')
    request.on('data', chunk => (value += chunk))
    request.on('end', () => resolve(value))
  })
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function fakeServer(state: FakeAuthState): Promise<string> {
  const pending = new Map<string, string>()

  const server = http.createServer(async (request, response) => {
    const requestBody = await body(request)
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    state.requests.push({
      method: request.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: requestBody,
      authorization: request.headers.authorization
    })

    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(value))
    }

    if (url.pathname === '/auth/v1/authorize') {
      const redirect = new URL(url.searchParams.get('redirect_to')!)

      if (state.authorizeMode === 'never') {
        response.writeHead(200)
        response.end('pending')

        return
      }

      if (state.authorizeMode === 'state_mismatch') {redirect.pathname = `${redirect.pathname}-forged`}

      if (state.authorizeMode === 'callback_error') {redirect.searchParams.set('error', 'access_denied')}
      else {
        const code = `code-${state.tokenCount + 1}`
        pending.set(code, url.searchParams.get('code_challenge') ?? '')
        redirect.searchParams.set('code', code)
      }

      response.writeHead(302, { location: redirect.toString() })
      response.end()

      return
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      if (state.malformedToken) {
        json(200, { access_token: 'missing-everything-else' })

        return
      }

      const input = JSON.parse(requestBody)
      const expected = pending.get(input.auth_code)
      const actual = base64Url(createHash('sha256').update(input.code_verifier, 'ascii').digest())

      if (!expected || expected !== actual) {
        json(400, { error: 'invalid_grant' })

        return
      }

      state.tokenCount += 1
      const accessToken = `access-${state.userId}-${state.tokenCount}`
      state.validTokens.add(accessToken)
      json(200, {
        access_token: accessToken,
        refresh_token: `refresh-${state.userId}`,
        expires_in: 3600,
        user: { id: state.userId, user_metadata: { full_name: state.userId === USER_A ? 'Minh' : 'Lan' } }
      })

      return
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      state.refreshCount += 1
      const input = JSON.parse(requestBody)

      if (input.refresh_token !== `refresh-${state.userId}`) {
        json(401, { error: 'invalid_refresh_token' })

        return
      }

      const accessToken = `refreshed-${state.userId}-${state.refreshCount}`
      state.validTokens.add(accessToken)
      json(200, {
        access_token: accessToken,
        refresh_token: `refresh-${state.userId}`,
        expires_in: 3600,
        user: { id: state.userId, user_metadata: { full_name: 'Minh' } }
      })

      return
    }

    if (url.pathname === '/api/desktop/v1/auth/password') {
      const input = JSON.parse(requestBody)

      if (state.passwordNeverRespond) {return}

      if (state.passwordOversized) {
        json(200, { session: { padding: 'x'.repeat(70_000) } })

        return
      }

      if (!state.passwordAccepted) {
        json(400, {
          error: 'invalid_credentials',
          echoed_identifier: input.identifier,
          echoed_password: input.password
        })

        return
      }

      state.tokenCount += 1
      const accessToken = `password-${state.userId}-${state.tokenCount}`
      state.validTokens.add(accessToken)
      json(200, {
        session: {
          access_token: accessToken,
          refresh_token: `refresh-${state.userId}`,
          expires_in: 3600,
          user: {
            id: state.userId,
            display_name: state.userId === USER_A ? 'Minh' : 'Lan',
            handle: state.userId === USER_A ? 'minh' : 'lan'
          }
        }
      })

      return
    }

    if (url.pathname.startsWith('/api/desktop/v1/')) {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''

      if (!state.validTokens.has(token)) {
        json(401, {
          error: {
            code: 'token_expired',
            message_key: 'messaging.error.token_expired',
            retryable: true,
            request_id: 'req-auth'
          }
        })

        return
      }

      if (url.pathname.endsWith('/session')) {
        const hostedUserId = state.hostedUserId ?? state.userId
        json(200, {
          user: { id: hostedUserId, display_name: hostedUserId === USER_A ? 'Minh' : 'Lan', handle: null },
          realtime: { transport: 'supabase_private_broadcast', topic: `user:${hostedUserId}:messaging:v1` },
          server_time: '2026-08-12T09:00:00.000Z',
          sync_cursor: null
        })

        return
      }

      if (url.pathname.endsWith('/sync')) {
        json(200, {
          changes: [],
          next_cursor: `cursor-${state.userId}`,
          has_more: false,
          server_time: '2026-08-12T09:00:00.000Z'
        })

        return
      }

      if (url.pathname.endsWith('/conversations')) {
        json(200, { conversations: [], next_cursor: null, has_more: false })

        return
      }
    }

    json(404, { error: 'not_found' })
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return `http://127.0.0.1:${address.port}`
}

function initialState(overrides: Partial<FakeAuthState> = {}): FakeAuthState {
  return {
    authorizeMode: 'success',
    userId: USER_A,
    passwordAccepted: true,
    malformedToken: false,
    refreshCount: 0,
    tokenCount: 0,
    validTokens: new Set(),
    requests: [],
    ...overrides
  }
}

async function harness(
  state: FakeAuthState,
  options: {
    timeoutMs?: number
    passwordTimeoutMs?: number
    providers?: { google: boolean; password: boolean }
  } = {}
) {
  const origin = await fakeServer(state)
  const directory = userData()
  let client!: SupabaseAtumAccountClient
  let controller!: AtumAccountAuthController

  const runtime = new AtumMessagingRuntime({
    userDataPath: directory,
    safeStorage,
    refreshSession: session => controller?.refresh(session) ?? client.refresh(session)
  })

  runtimes.push(runtime)
  client = new SupabaseAtumAccountClient(
    resolveAtumAccountConfig({
      hostedBaseUrl: origin,
      supabaseUrl: origin,
      supabaseAnonKey: 'public-anon-key',
      providers: options.providers ?? { google: true, password: true }
    })!,
    {
      timeoutMs: options.timeoutMs,
      passwordTimeoutMs: options.passwordTimeoutMs,
      openExternal: async url => {
        const response = await fetch(url, { redirect: 'manual' })
        const redirect = response.headers.get('location')

        if (redirect) {await fetch(redirect)}
      }
    }
  )
  controller = new AtumAccountAuthController({ runtime, client })

  return { client, controller, directory, origin, runtime }
}

test('system-browser loopback PKCE carries real bytes and installs only a hosted-verified account', async () => {
  const state = initialState()
  const { controller, runtime } = await harness(state)
  const status = await controller.signIn()

  assert.equal(status.state, 'signed_in')
  assert.deepEqual(status.account, { id: USER_A, displayName: 'Minh', handle: null })
  assert.equal((await runtime.status()).connectivity, 'online')
  assert.equal(state.requests.some(request => request.path.includes('code_verifier')), false)
  const tokenRequest = state.requests.find(request => request.path.includes('grant_type=pkce'))!
  assert.equal(typeof JSON.parse(tokenRequest.body).code_verifier, 'string')
})

test('sanitized provider capabilities gate unavailable flows without opening a request', async () => {
  const state = initialState()
  const { controller } = await harness(state, { providers: { google: false, password: true } })

  assert.deepEqual(controller.status().providers, { google: false, password: true })
  const unavailable = await controller.signIn()
  assert.equal(unavailable.state, 'signed_out')
  assert.equal(unavailable.errorCode, 'google_provider_unavailable')
  assert.deepEqual(unavailable.providers, { google: false, password: true })
  assert.equal(state.requests.length, 0)
})

test('loopback hosted identifier/password auth installs only a hosted-verified encrypted session', async () => {
  const state = initialState()
  const { controller, directory, runtime } = await harness(state)
  const input = { identifier: 'owner@example.test', password: 'dogfood-password-123' }
  const status = await controller.signInWithPassword(input)

  assert.deepEqual(status, {
    state: 'signed_in',
    configured: true,
    account: { id: USER_A, displayName: 'Minh', handle: null },
    errorCode: null,
    providers: { google: true, password: true }
  })
  assert.equal((await runtime.status()).connectivity, 'online')
  const passwordRequest = state.requests.find(request => request.path === '/api/desktop/v1/auth/password')!
  assert.deepEqual(JSON.parse(passwordRequest.body), input)
  assert.doesNotMatch(JSON.stringify(status), /owner@example|dogfood-password/i)
  assert.doesNotMatch(
    readFileSync(join(directory, 'atum-messaging', 'session.json'), 'utf8'),
    /owner@example|dogfood-password/i
  )
})

test('password auth rejection is sanitized even when upstream echoes credentials', async () => {
  const state = initialState({ passwordAccepted: false })
  const { controller, directory, runtime } = await harness(state)
  const identifier = '@owner'
  const password = 'wrong-password-123'

  const consoleSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  ]

  const status = await controller.signInWithPassword({ identifier, password })

  assert.equal(status.state, 'error')
  assert.equal(status.errorCode, 'password_sign_in_rejected:400')
  assert.doesNotMatch(JSON.stringify(status), new RegExp(`${identifier}|${password}`))
  assert.equal(runtime.accountProfile(), null)
  assert.throws(() => readFileSync(join(directory, 'atum-messaging', 'session.json'), 'utf8'))
  assert.equal(consoleSpies.some(spy => JSON.stringify(spy.mock.calls).includes(identifier)), false)
  assert.equal(consoleSpies.some(spy => JSON.stringify(spy.mock.calls).includes(password)), false)

  for (const spy of consoleSpies) {spy.mockRestore()}
})

test('identifier/password session is not installed when auth and session identities disagree', async () => {
  const { controller, runtime } = await harness(initialState({ hostedUserId: USER_B }))

  const status = await controller.signInWithPassword({
    identifier: '+84912345678',
    password: 'dogfood-password-123'
  })

  assert.equal(status.state, 'error')
  assert.equal(status.errorCode, 'hosted_account_mismatch')
  assert.equal(runtime.accountProfile(), null)
})

test('hosted identifier/password auth has bounded timeout and response body', async () => {
  const timed = await harness(initialState({ passwordNeverRespond: true }), { passwordTimeoutMs: 20 })

  const timedStatus = await timed.controller.signInWithPassword({
    identifier: 'owner',
    password: 'dogfood-password-123'
  })

  assert.equal(timedStatus.errorCode, 'password_sign_in_timeout')

  const cancelled = await harness(initialState({ passwordNeverRespond: true }), { passwordTimeoutMs: 5_000 })

  const pending = cancelled.controller.signInWithPassword({
    identifier: 'owner',
    password: 'dogfood-password-123'
  })

  await new Promise(resolve => setTimeout(resolve, 5))
  cancelled.controller.cancel()
  assert.equal((await pending).state, 'signed_out')

  const oversized = await harness(initialState({ passwordOversized: true }))

  const oversizedStatus = await oversized.controller.signInWithPassword({
    identifier: 'owner',
    password: 'dogfood-password-123'
  })

  assert.equal(oversizedStatus.errorCode, 'auth_response_too_large')
  assert.equal(oversized.runtime.accountProfile(), null)
})

test.each([
  ['state_mismatch', 'callback_state_or_nonce_mismatch'],
  ['callback_error', 'authorization_callback_error:access_denied']
] as const)('rejects %s without installing a partial session', async (authorizeMode, expectedError) => {
  const { controller, runtime } = await harness(initialState({ authorizeMode }))
  const status = await controller.signIn()
  assert.equal(status.state, 'error')
  assert.equal(status.errorCode, expectedError)
  assert.equal(runtime.accountProfile(), null)
})

test('timeout and explicit cancel close the loopback attempt', async () => {
  const timed = await harness(initialState({ authorizeMode: 'never' }), { timeoutMs: 20 })
  const timedStatus = await timed.controller.signIn()
  assert.equal(timedStatus.errorCode, 'authorization_timeout')

  const cancelled = await harness(initialState({ authorizeMode: 'never' }), { timeoutMs: 5_000 })
  const pending = cancelled.controller.signIn()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(cancelled.controller.status().state, 'signing_in')
  cancelled.controller.cancel()
  assert.deepEqual(await pending, {
    state: 'signed_out',
    configured: true,
    account: null,
    errorCode: null,
    providers: { google: true, password: true }
  })

  const shutdown = await harness(initialState({ authorizeMode: 'never' }), { timeoutMs: 5_000 })
  const shutdownPending = shutdown.controller.signIn()
  await new Promise(resolve => setTimeout(resolve, 5))
  shutdown.controller.stop()
  assert.equal((await shutdownPending).state, 'signed_out')
})

test('malformed token response is an error and never reaches the encrypted runtime vault', async () => {
  const { controller, runtime } = await harness(initialState({ malformedToken: true }))
  const status = await controller.signIn()
  assert.equal(status.errorCode, 'invalid_token_response')
  assert.equal(runtime.accountProfile(), null)
})

test('a hosted 401 performs exactly one main-process refresh and one replay', async () => {
  const state = initialState()
  const { controller, runtime } = await harness(state)
  await controller.signIn()
  const firstAccess = [...state.validTokens].find(token => token.startsWith('access-'))!
  state.validTokens.delete(firstAccess)

  const status = await runtime.sync()
  assert.equal(status.connectivity, 'online')
  assert.equal(state.refreshCount, 1)
  const refreshRequests = state.requests.filter(request => request.path.includes('grant_type=refresh_token'))
  assert.equal(refreshRequests.length, 1)
})

test('encrypted session restores across restart and logout clears it without renderer credentials', async () => {
  const state = initialState()
  const { client, controller, directory, runtime } = await harness(state)
  await controller.signIn()
  runtime.stop()

  const restarted = new AtumMessagingRuntime({
    userDataPath: directory,
    safeStorage,
    refreshSession: session => client.refresh(session)
  })

  runtimes.push(restarted)
  const restoredController = new AtumAccountAuthController({ runtime: restarted, client })
  assert.equal(restoredController.status().account?.id, USER_A)
  assert.equal(restoredController.status().state, 'signed_in')

  const signedOut = await restoredController.signOut()
  assert.equal(signedOut.state, 'signed_out')
  assert.equal(restarted.accountProfile(), null)
})

test('successful account switch replaces the partition only after the new account verifies', async () => {
  const state = initialState()
  const { controller, runtime } = await harness(state)
  await controller.signIn()
  assert.equal(runtime.accountProfile()?.id, USER_A)

  state.userId = USER_B
  const switched = await controller.signIn()
  assert.equal(switched.state, 'signed_in')
  assert.equal(switched.account?.id, USER_B)
  assert.equal((await runtime.status()).accountId, USER_B)
})

test('failed account switch leaves the last verified account installed', async () => {
  const state = initialState()
  const { controller, runtime } = await harness(state)
  await controller.signIn()
  state.userId = USER_B
  state.malformedToken = true

  const failed = await controller.signIn()
  assert.equal(failed.state, 'signed_in')
  assert.equal(failed.account?.id, USER_A)
  assert.equal(failed.errorCode, 'invalid_token_response')
  assert.equal(runtime.accountProfile()?.id, USER_A)
})

test('configuration is complete, HTTPS outside loopback, and credential-free', () => {
  assert.equal(resolveAtumAccountConfig({}), null)
  assert.throws(
    () => resolveAtumAccountConfig({ hostedBaseUrl: 'https://atum.test', supabaseUrl: 'https://project.supabase.co' }),
    /incomplete/
  )
  assert.throws(
    () => resolveAtumAccountConfig({
      hostedBaseUrl: 'http://atum.test',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'public-key'
    }),
    /https/
  )
  assert.throws(
    () => resolveAtumAccountConfig({
      hostedBaseUrl: 'https://user:password@atum.test',
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'public-key'
    }),
    /credentials/
  )
})
