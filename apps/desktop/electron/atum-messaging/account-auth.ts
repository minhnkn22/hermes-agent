import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import type { AtumMessagingRuntime } from './runtime'
import type { MessagingAccountSession, MessagingUser } from './types'
import { parseDesktopSession } from './wire'

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const CALLBACK_PREFIX = '/atum-auth/callback'

export interface AtumAccountConfigInput {
  hostedBaseUrl?: string | null
  supabaseUrl?: string | null
  supabaseAnonKey?: string | null
}

export interface AtumAccountConfig {
  hostedBaseUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export type AtumAccountAuthState =
  | 'unconfigured'
  | 'signed_out'
  | 'signing_in'
  | 'signed_in'
  | 'refreshing'
  | 'expired'
  | 'error'

export interface AtumAccountProfile {
  id: string
  displayName: string | null
  handle: string | null
}

export interface AtumAccountAuthStatus {
  state: AtumAccountAuthState
  configured: boolean
  account: AtumAccountProfile | null
  errorCode: string | null
}

export interface AtumAccountAuthClientOptions {
  fetchImpl?: typeof fetch
  createServer?: typeof http.createServer
  openExternal: (url: string) => Promise<void>
  timeoutMs?: number
}

interface SupabaseTokenBody {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  user: {
    id: string
    user_metadata?: Record<string, unknown> | null
  }
}

interface LoginAttempt {
  signal: AbortSignal
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomSecret(bytes: number): string {
  return base64Url(randomBytes(bytes))
}

function normalizeHttpUrl(value: string, label: string): string {
  const parsed = new URL(value)
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'

  if ((parsed.protocol !== 'https:' && !loopback) || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error(`${label}_must_use_https`)
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label}_must_not_contain_credentials`)
  }

  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')

  return parsed.toString().replace(/\/$/, '')
}

export function resolveAtumAccountConfig(input: AtumAccountConfigInput): AtumAccountConfig | null {
  const hostedBaseUrl = input.hostedBaseUrl?.trim()
  const supabaseUrl = input.supabaseUrl?.trim()
  const supabaseAnonKey = input.supabaseAnonKey?.trim()

  if (!hostedBaseUrl && !supabaseUrl && !supabaseAnonKey) {
    return null
  }

  if (!hostedBaseUrl || !supabaseUrl || !supabaseAnonKey) {
    throw new Error('atum_account_config_incomplete')
  }

  if (/\s/.test(supabaseAnonKey) || supabaseAnonKey.length < 8 || supabaseAnonKey.length > 8192) {
    throw new Error('atum_account_config_invalid_anon_key')
  }

  return {
    hostedBaseUrl: normalizeHttpUrl(hostedBaseUrl, 'hosted_base_url'),
    supabaseUrl: normalizeHttpUrl(supabaseUrl, 'supabase_url'),
    supabaseAnonKey
  }
}

function parseUser(body: SupabaseTokenBody): MessagingUser {
  const metadata = body.user.user_metadata ?? {}

  return {
    id: body.user.id,
    displayName:
      typeof metadata.full_name === 'string'
        ? metadata.full_name
        : typeof metadata.name === 'string'
          ? metadata.name
          : null,
    handle: typeof metadata.user_name === 'string' ? metadata.user_name : null
  }
}

function parseTokenBody(value: unknown, nowMs: number): { user: MessagingUser; tokens: MessagingAccountSession['tokens'] } {
  const body = value && typeof value === 'object' ? (value as Partial<SupabaseTokenBody>) : {}
  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  const user = body.user && typeof body.user === 'object' ? body.user : null

  if (!accessToken || !refreshToken || !user || typeof user.id !== 'string' || !user.id) {
    throw new Error('invalid_token_response')
  }

  const explicitExpiry = Number(body.expires_at)
  const duration = Number(body.expires_in)

  const expiresAt = Number.isFinite(explicitExpiry) && explicitExpiry > 0
    ? explicitExpiry
    : Number.isFinite(duration) && duration > 0
      ? Math.floor(nowMs / 1000) + duration
      : null

  return {
    user: parseUser(body as SupabaseTokenBody),
    tokens: { accessToken, refreshToken, expiresAt }
  }
}

async function readJson(response: Response): Promise<unknown> {
  const bytes = await response.text()

  try {
    return bytes ? JSON.parse(bytes) : null
  } catch {
    throw new Error('invalid_json_response')
  }
}

function authHeaders(config: AtumAccountConfig): Headers {
  return new Headers({
    accept: 'application/json',
    apikey: config.supabaseAnonKey,
    'content-type': 'application/json; charset=utf-8'
  })
}

export class SupabaseAtumAccountClient {
  private readonly fetchImpl: typeof fetch
  private readonly createServer: typeof http.createServer
  private readonly timeoutMs: number

  constructor(
    readonly config: AtumAccountConfig,
    private readonly options: AtumAccountAuthClientOptions
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.createServer = options.createServer ?? http.createServer
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  }

  async signIn(attempt: LoginAttempt): Promise<MessagingAccountSession> {
    const verifier = randomSecret(32)

    if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
      throw new Error('invalid_pkce_verifier')
    }

    const challenge = base64Url(createHash('sha256').update(verifier, 'ascii').digest())
    const state = randomSecret(24)
    const nonce = randomSecret(24)
    const code = await this.waitForCode({ attempt, challenge, nonce, state })

    const response = await this.fetchImpl(`${this.config.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: authHeaders(this.config),
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      signal: attempt.signal
    })

    const body = await readJson(response)

    if (!response.ok) {
      throw new Error(`token_exchange_failed:${response.status}`)
    }

    const parsed = parseTokenBody(body, Date.now())

    return { baseUrl: this.config.hostedBaseUrl, ...parsed }
  }

  async refresh(session: MessagingAccountSession): Promise<MessagingAccountSession | null> {
    if (!session.tokens.refreshToken) {
      return null
    }

    const response = await this.fetchImpl(`${this.config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: authHeaders(this.config),
      body: JSON.stringify({ refresh_token: session.tokens.refreshToken })
    })

    const body = await readJson(response)

    if (!response.ok) {
      return null
    }

    const parsed = parseTokenBody(body, Date.now())

    if (parsed.user.id !== session.user.id) {
      throw new Error('refresh_account_mismatch')
    }

    return { baseUrl: this.config.hostedBaseUrl, ...parsed }
  }

  async verifyHostedSession(session: MessagingAccountSession, signal?: AbortSignal): Promise<MessagingAccountSession> {
    const response = await this.fetchImpl(`${this.config.hostedBaseUrl}/api/desktop/v1/session`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${session.tokens.accessToken}`
      },
      cache: 'no-store',
      signal
    })

    const body = await readJson(response)

    if (!response.ok) {
      throw new Error(`hosted_session_rejected:${response.status}`)
    }

    const verified = parseDesktopSession(body)

    if (verified.user.id !== session.user.id) {
      throw new Error('hosted_account_mismatch')
    }

    return { ...session, user: verified.user }
  }

  private waitForCode(input: {
    attempt: LoginAttempt
    challenge: string
    nonce: string
    state: string
  }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const expectedPath = `${CALLBACK_PREFIX}/${input.state}/${input.nonce}`

      const server = this.createServer((request, response) => {
        response.writeHead(204, { 'cache-control': 'no-store' })
        response.end()

        if (settled) {return}

        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const carriesResult = url.searchParams.has('code') || url.searchParams.has('error')

        if (!carriesResult) {return}

        if (url.pathname !== expectedPath) {
          finish(new Error('callback_state_or_nonce_mismatch'))

          return
        }

        const authError = url.searchParams.get('error')

        if (authError) {
          finish(new Error(`authorization_callback_error:${authError}`))

          return
        }

        const code = url.searchParams.get('code')

        if (!code) {
          finish(new Error('authorization_callback_missing_code'))

          return
        }

        finish(null, code)
      })

      const cleanup = () => {
        if (timer) {clearTimeout(timer)}
        input.attempt.signal.removeEventListener('abort', onAbort)

        try {server.close()} catch { /* already closed */ }
      }

      const finish = (error: Error | null, code?: string) => {
        if (settled) {return}
        settled = true
        cleanup()

        if (error) {reject(error)}
        else {resolve(code!)}
      }

      const onAbort = () => finish(new Error('authorization_cancelled'))

      input.attempt.signal.addEventListener('abort', onAbort, { once: true })
      server.on('error', error => finish(error instanceof Error ? error : new Error(String(error))))
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo | null

        if (!address || typeof address === 'string') {
          finish(new Error('loopback_bind_failed'))

          return
        }

        const redirectTo = `http://127.0.0.1:${address.port}${expectedPath}`
        const authorize = new URL(`${this.config.supabaseUrl}/auth/v1/authorize`)
        authorize.searchParams.set('provider', 'google')
        authorize.searchParams.set('redirect_to', redirectTo)
        authorize.searchParams.set('code_challenge', input.challenge)
        authorize.searchParams.set('code_challenge_method', 's256')

        timer = setTimeout(() => finish(new Error('authorization_timeout')), this.timeoutMs)
        this.options.openExternal(authorize.toString()).catch(error => {
          finish(error instanceof Error ? error : new Error(String(error)))
        })
      })
    })
  }
}

export interface AtumAccountAuthControllerOptions {
  runtime: AtumMessagingRuntime
  client: SupabaseAtumAccountClient | null
}

export class AtumAccountAuthController {
  private activeAttempt: AbortController | null = null
  private transientState: AtumAccountAuthState | null = null
  private errorCode: string | null = null

  constructor(private readonly options: AtumAccountAuthControllerOptions) {}

  status(): AtumAccountAuthStatus {
    const account = this.options.runtime.accountProfile()

    return {
      state: this.transientState ?? (account ? 'signed_in' : this.options.client ? 'signed_out' : 'unconfigured'),
      configured: Boolean(this.options.client),
      account,
      errorCode: this.errorCode
    }
  }

  async signIn(): Promise<AtumAccountAuthStatus> {
    if (!this.options.client) {
      this.transientState = 'unconfigured'
      this.errorCode = 'atum_account_unconfigured'

      return this.status()
    }

    if (this.activeAttempt) {return this.status()}

    const attempt = new AbortController()
    this.activeAttempt = attempt
    this.transientState = 'signing_in'
    this.errorCode = null

    try {
      const acquired = await this.options.client.signIn({ signal: attempt.signal })

      if (attempt.signal.aborted || this.activeAttempt !== attempt) {
        throw new Error('authorization_cancelled')
      }

      const verified = await this.options.client.verifyHostedSession(acquired, attempt.signal)

      if (attempt.signal.aborted || this.activeAttempt !== attempt) {
        throw new Error('authorization_cancelled')
      }

      await this.options.runtime.installSession(verified)
      this.transientState = null
    } catch (error) {
      const code = error instanceof Error ? error.message : 'account_sign_in_failed'

      if (code === 'authorization_cancelled') {
        this.transientState = this.options.runtime.accountProfile() ? null : 'signed_out'
        this.errorCode = null
      } else {
        this.transientState = this.options.runtime.accountProfile() ? null : 'error'
        this.errorCode = code
      }
    } finally {
      if (this.activeAttempt === attempt) {this.activeAttempt = null}
    }

    return this.status()
  }

  cancel(): AtumAccountAuthStatus {
    this.activeAttempt?.abort()
    this.transientState = this.options.runtime.accountProfile() ? null : this.options.client ? 'signed_out' : 'unconfigured'
    this.errorCode = null

    return this.status()
  }

  async refresh(session: MessagingAccountSession): Promise<MessagingAccountSession | null> {
    if (!this.options.client) {return null}

    this.transientState = 'refreshing'
    this.errorCode = null

    try {
      const refreshed = await this.options.client.refresh(session)
      this.transientState = refreshed ? null : 'expired'
      this.errorCode = refreshed ? null : 'account_session_expired'

      return refreshed
    } catch (error) {
      this.transientState = 'expired'
      this.errorCode = error instanceof Error ? error.message : 'account_refresh_failed'

      return null
    }
  }

  async signOut(): Promise<AtumAccountAuthStatus> {
    this.activeAttempt?.abort()
    this.activeAttempt = null
    await this.options.runtime.clearSession()
    this.transientState = null
    this.errorCode = null

    return this.status()
  }

  stop(): void {
    this.activeAttempt?.abort()
    this.activeAttempt = null
  }
}

export { CALLBACK_PREFIX, DEFAULT_LOGIN_TIMEOUT_MS, parseTokenBody }
