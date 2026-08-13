import { atom, computed } from 'nanostores'

import type { Locale } from '@/i18n'
import { atumAccountClient, type AtumAccountStatus } from '@/lib/atum-account-client'
import {
  atumMessagingClient,
  type AtumMessagingConversation,
  type AtumMessagingMessage,
  type AtumMessagingSyncStatus
} from '@/lib/atum-messaging-client'

export const $atumAccountStatus = atom<AtumAccountStatus>({
  state: 'unconfigured',
  configured: false,
  account: null,
  errorCode: null,
  providers: { google: false, password: false }
})
export const $atumStatus = atom<AtumMessagingSyncStatus | null>(null)
export const $atumRoster = atom<AtumMessagingConversation[]>([])
export const $atumActiveConversationId = atom<string | null>(null)
export const $atumMessages = atom<Record<string, AtumMessagingMessage[]>>({})
export const $atumDrafts = atom<Record<string, string>>({})

export const $atumConnectivity = computed($atumStatus, status => status?.connectivity ?? 'loading')
export const $atumIsAuthenticated = computed(
  [$atumAccountStatus, $atumStatus],
  (account, status) => (account.state === 'signed_in' || account.state === 'refreshing') && Boolean(status?.accountId)
)
export const $atumSortedRoster = computed($atumRoster, roster =>
  [...roster].sort((left, right) =>
    (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt)
  )
)
export const $atumActiveMessages = computed([$atumActiveConversationId, $atumMessages], (conversationId, messages) =>
  conversationId ? [...(messages[conversationId] ?? [])].sort(compareMessages) : []
)

let accountEpoch = 0
let pollingTimer: ReturnType<typeof setTimeout> | null = null
let initialized = false

function compareMessages(left: AtumMessagingMessage, right: AtumMessagingMessage): number {
  return left.createdAt.localeCompare(right.createdAt) || left.localId.localeCompare(right.localId)
}

function errorStatus(code: string): AtumMessagingSyncStatus {
  const previous = $atumStatus.get()

  return {
    accountId: previous?.accountId ?? null,
    connectivity: 'error',
    synchronized: false,
    cursor: previous?.cursor ?? null,
    lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
    nextRetryAt: null,
    errorCode: code
  }
}

function clearAccountScopedState(): void {
  accountEpoch += 1
  $atumStatus.set(null)
  $atumRoster.set([])
  $atumMessages.set({})
  $atumDrafts.set({})
  $atumActiveConversationId.set(null)
}

function currentAccountScopeId(): string | null {
  return $atumStatus.get()?.accountId ?? $atumAccountStatus.get().account?.id ?? null
}

function applyAccountStatus(next: AtumAccountStatus, options: { preserveSignedOut?: boolean } = {}): void {
  const previousScopeId = currentAccountScopeId()
  const nextId = next.account?.id ?? null
  const explicitlySignedOut = next.state === 'signed_out' || next.state === 'unconfigured'
  const switchedIdentity = Boolean(previousScopeId && nextId && previousScopeId !== nextId)

  // Expiry, refresh, and transient auth failures are not account-boundary
  // transitions. Keep that account's encrypted SQLite projection and drafts so
  // reauthentication is a recoverable pause rather than destructive logout.
  if (switchedIdentity || (previousScopeId && explicitlySignedOut && !options.preserveSignedOut)) {
    clearAccountScopedState()
  }

  $atumAccountStatus.set(next)
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'atum_messaging_error'
}

export async function refreshAtumAccountStatus(): Promise<AtumAccountStatus> {
  try {
    const next = await atumAccountClient().status()
    applyAccountStatus(next)

    return next
  } catch (error) {
    const previous = $atumAccountStatus.get()

    const next: AtumAccountStatus = {
      state: 'error',
      configured: previous.configured,
      account: previous.account,
      errorCode: errorCode(error),
      providers: previous.providers
    }

    applyAccountStatus(next)

    return next
  }
}

export async function refreshAtumStatus(): Promise<AtumMessagingSyncStatus | null> {
  const epoch = accountEpoch

  try {
    const status = await atumMessagingClient().status()

    if (epoch === accountEpoch) {
      $atumStatus.set(status)
    }

    return epoch === accountEpoch ? status : null
  } catch (error) {
    if (epoch === accountEpoch) {
      $atumStatus.set(errorStatus(errorCode(error)))
    }

    return null
  }
}

export async function refreshAtumRoster(): Promise<AtumMessagingConversation[]> {
  const epoch = accountEpoch

  try {
    const roster = await atumMessagingClient().roster(100)

    if (epoch === accountEpoch) {
      $atumRoster.set(roster)
    }

    return epoch === accountEpoch ? roster : []
  } catch (error) {
    if (epoch === accountEpoch) {
      $atumStatus.set(errorStatus(errorCode(error)))
    }

    return []
  }
}

export async function loadAtumMessages(conversationId: string): Promise<AtumMessagingMessage[]> {
  const epoch = accountEpoch

  try {
    const [messages, draft] = await Promise.all([
      atumMessagingClient().messages(conversationId, 100),
      atumMessagingClient().draft(conversationId)
    ])

    if (epoch !== accountEpoch) {
      return []
    }

    $atumMessages.set({ ...$atumMessages.get(), [conversationId]: messages })

    if (draft) {
      $atumDrafts.set({ ...$atumDrafts.get(), [conversationId]: draft.text })
    }

    const lastCanonical = [...messages].reverse().find(message => message.id)

    if (lastCanonical?.id) {
      try {
        await atumMessagingClient().markRead(conversationId, lastCanonical.id)
      } catch (error) {
        if (epoch === accountEpoch) {
          $atumStatus.set(errorStatus(errorCode(error)))
        }
      }
    }

    return messages
  } catch (error) {
    if (epoch === accountEpoch) {
      $atumStatus.set(errorStatus(errorCode(error)))
    }

    return []
  }
}

export function setAtumActiveConversation(conversationId: string | null): void {
  $atumActiveConversationId.set(conversationId)

  if (conversationId) {
    void loadAtumMessages(conversationId)
  }
}

export function setAtumDraft(conversationId: string, text: string): void {
  $atumDrafts.set({ ...$atumDrafts.get(), [conversationId]: text })
}

export async function persistAtumDraft(conversationId: string): Promise<boolean> {
  const epoch = accountEpoch

  try {
    await atumMessagingClient().saveDraft(conversationId, { text: $atumDrafts.get()[conversationId] ?? '' })

    return epoch === accountEpoch
  } catch (error) {
    if (epoch === accountEpoch) {
      $atumStatus.set(errorStatus(errorCode(error)))
    }

    return false
  }
}

export function hostedAtumLocale(locale: Locale | string): 'vi' | 'en' {
  return locale === 'vi' ? 'vi' : 'en'
}

export async function sendAtumMessage(conversationId: string, rawText: string, locale: Locale | string): Promise<void> {
  const content = rawText.trim()

  if (!content) {
    return
  }

  const epoch = accountEpoch
  const clientMessageId = crypto.randomUUID()
  const accountId = $atumStatus.get()?.accountId ?? $atumAccountStatus.get().account?.id ?? 'self'

  const optimistic: AtumMessagingMessage = {
    localId: `optimistic:${clientMessageId}`,
    id: null,
    clientMessageId,
    conversationId,
    sender: { type: 'account', id: accountId },
    content,
    kind: 'text',
    attachments: [],
    replyToMessageId: null,
    forwardedFrom: null,
    reactions: [],
    version: 1,
    createdAt: new Date().toISOString(),
    editedAt: null,
    recalledAt: null,
    delivery: 'sending',
    optimistic: true
  }

  $atumMessages.set({
    ...$atumMessages.get(),
    [conversationId]: [...($atumMessages.get()[conversationId] ?? []), optimistic]
  })
  setAtumDraft(conversationId, '')
  void persistAtumDraft(conversationId)

  try {
    await atumMessagingClient().send({
      conversationId,
      clientMessageId,
      content,
      locale: hostedAtumLocale(locale)
    })

    if (epoch === accountEpoch) {
      await loadAtumMessages(conversationId)
    }
  } catch {
    if (epoch !== accountEpoch) {
      return
    }

    const current = $atumMessages.get()[conversationId] ?? []
    $atumMessages.set({
      ...$atumMessages.get(),
      [conversationId]: current.map(message =>
        message.clientMessageId === clientMessageId
          ? { ...message, delivery: 'failed_retryable', optimistic: true }
          : message
      )
    })
  }
}

export async function retryAtumMessage(clientMessageId: string): Promise<void> {
  const match = Object.values($atumMessages.get())
    .flat()
    .find(message => message.clientMessageId === clientMessageId)

  if (!match) {
    return
  }

  const epoch = accountEpoch
  $atumMessages.set({
    ...$atumMessages.get(),
    [match.conversationId]: ($atumMessages.get()[match.conversationId] ?? []).map(message =>
      message.clientMessageId === clientMessageId ? { ...message, delivery: 'sending' } : message
    )
  })

  try {
    await atumMessagingClient().retry(clientMessageId)

    if (epoch === accountEpoch) {
      await loadAtumMessages(match.conversationId)
    }
  } catch {
    if (epoch !== accountEpoch) {
      return
    }

    $atumMessages.set({
      ...$atumMessages.get(),
      [match.conversationId]: ($atumMessages.get()[match.conversationId] ?? []).map(message =>
        message.clientMessageId === clientMessageId ? { ...message, delivery: 'failed_retryable' } : message
      )
    })
  }
}

export async function pollAtumSync(): Promise<void> {
  const account = await refreshAtumAccountStatus()

  if (account.state !== 'signed_in' && account.state !== 'refreshing') {
    if (account.state === 'expired') {
      const previous = $atumStatus.get()

      $atumStatus.set({
        accountId: previous?.accountId ?? account.account?.id ?? null,
        connectivity: 'auth_expired',
        synchronized: false,
        cursor: previous?.cursor ?? null,
        lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
        nextRetryAt: null,
        errorCode: account.errorCode ?? 'account_session_expired'
      })
    }

    return
  }

  const epoch = accountEpoch

  try {
    const current = await atumMessagingClient().status()

    if (epoch !== accountEpoch) {
      return
    }

    $atumStatus.set(current)

    if (!shouldPollAtumSync(current)) {
      return
    }

    const status = await atumMessagingClient().sync()

    if (epoch !== accountEpoch) {
      return
    }

    $atumStatus.set(status)
    await refreshAtumRoster()

    const active = $atumActiveConversationId.get()

    if (active) {
      await loadAtumMessages(active)
    }
  } catch (error) {
    if (epoch === accountEpoch) {
      $atumStatus.set(errorStatus(errorCode(error)))
    }
  }
}

export function shouldPollAtumSync(status: AtumMessagingSyncStatus, now = Date.now()): boolean {
  if (status.connectivity === 'auth_expired' || (status.connectivity === 'error' && !status.nextRetryAt)) {
    return false
  }

  if (!status.nextRetryAt) {
    return true
  }

  const retryAt = Date.parse(status.nextRetryAt)

  return Number.isFinite(retryAt) && retryAt <= now
}

function schedulePoll(): void {
  if (pollingTimer) {
    clearTimeout(pollingTimer)
  }

  const delay = typeof document !== 'undefined' && document.hidden ? 30_000 : 5_000
  pollingTimer = setTimeout(async () => {
    await pollAtumSync()
    schedulePoll()
  }, delay)
}

export function startAtumPolling(): () => void {
  if (!pollingTimer) {
    schedulePoll()
  }

  return () => {
    if (pollingTimer) {
      clearTimeout(pollingTimer)
    }

    pollingTimer = null
  }
}

export async function initializeAtumMessaging(): Promise<void> {
  if (initialized) {
    return
  }

  initialized = true

  const account = await refreshAtumAccountStatus()

  if (account.state === 'signed_in') {
    await Promise.all([refreshAtumStatus(), refreshAtumRoster()])
  }

  startAtumPolling()
}

export async function signInToAtum(): Promise<void> {
  $atumAccountStatus.set({ ...$atumAccountStatus.get(), state: 'signing_in', errorCode: null })

  try {
    const status = await atumAccountClient().signIn()
    applyAccountStatus(status, { preserveSignedOut: true })

    if (status.state === 'signed_in') {
      await Promise.all([refreshAtumStatus(), refreshAtumRoster()])
    }
  } catch (error) {
    const previous = $atumAccountStatus.get()
    applyAccountStatus({
      state: 'error',
      configured: previous.configured,
      account: previous.account,
      errorCode: errorCode(error),
      providers: previous.providers
    })
  }
}

export async function signInToAtumWithPassword(credentials: { identifier: string; password: string }): Promise<void> {
  $atumAccountStatus.set({ ...$atumAccountStatus.get(), state: 'signing_in', errorCode: null })

  try {
    const status = await atumAccountClient().signInWithPassword(credentials)
    applyAccountStatus(status, { preserveSignedOut: true })

    if (status.state === 'signed_in') {
      await Promise.all([refreshAtumStatus(), refreshAtumRoster()])
    }
  } catch (error) {
    const previous = $atumAccountStatus.get()
    applyAccountStatus({
      state: 'error',
      configured: previous.configured,
      account: previous.account,
      errorCode: errorCode(error),
      providers: previous.providers
    })
  }
}

export async function cancelAtumSignIn(): Promise<void> {
  applyAccountStatus(await atumAccountClient().cancel(), { preserveSignedOut: true })
}

export async function signOutOfAtum(): Promise<void> {
  clearAccountScopedState()
  $atumAccountStatus.set(await atumAccountClient().signOut())
}

/** Deterministic test reset; intentionally not part of the preload contract. */
export function resetAtumMessagingState(): void {
  if (pollingTimer) {
    clearTimeout(pollingTimer)
  }

  pollingTimer = null
  initialized = false
  clearAccountScopedState()
  $atumAccountStatus.set({
    state: 'unconfigured',
    configured: false,
    account: null,
    errorCode: null,
    providers: { google: false, password: false }
  })
}
