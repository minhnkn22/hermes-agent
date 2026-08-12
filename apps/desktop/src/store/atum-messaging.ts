import { atom, computed } from 'nanostores'

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
  (account, status) => account.state === 'signed_in' && Boolean(status?.accountId)
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

function errorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'atum_messaging_error'
}

export async function refreshAtumAccountStatus(): Promise<AtumAccountStatus> {
  const previousId = $atumAccountStatus.get().account?.id ?? null

  try {
    const next = await atumAccountClient().status()
    const nextId = next.account?.id ?? null

    if (previousId !== nextId || next.state === 'signed_out' || next.state === 'expired') {
      clearAccountScopedState()
    }

    $atumAccountStatus.set(next)

    return next
  } catch (error) {
    const next: AtumAccountStatus = {
      state: 'error',
      configured: true,
      account: null,
      errorCode: errorCode(error),
      providers: $atumAccountStatus.get().providers
    }

    clearAccountScopedState()
    $atumAccountStatus.set(next)

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
      void atumMessagingClient().markRead(conversationId, lastCanonical.id)
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

export async function persistAtumDraft(conversationId: string): Promise<void> {
  await atumMessagingClient().saveDraft(conversationId, { text: $atumDrafts.get()[conversationId] ?? '' })
}

export async function sendAtumMessage(conversationId: string, rawText: string, locale: string): Promise<void> {
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
  void atumMessagingClient().saveDraft(conversationId, { text: '' })

  try {
    await atumMessagingClient().send({ conversationId, clientMessageId, content, locale })

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
  const account = $atumAccountStatus.get()

  if (account.state !== 'signed_in') {
    return
  }

  const epoch = accountEpoch

  try {
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
    clearAccountScopedState()
    $atumAccountStatus.set(status)

    if (status.state === 'signed_in') {
      await Promise.all([refreshAtumStatus(), refreshAtumRoster()])
    }
  } catch (error) {
    clearAccountScopedState()
    $atumAccountStatus.set({
      state: 'error',
      configured: true,
      account: null,
      errorCode: errorCode(error),
      providers: $atumAccountStatus.get().providers
    })
  }
}

export async function signInToAtumWithPassword(credentials: { identifier: string; password: string }): Promise<void> {
  $atumAccountStatus.set({ ...$atumAccountStatus.get(), state: 'signing_in', errorCode: null })

  try {
    const status = await atumAccountClient().signInWithPassword(credentials)
    clearAccountScopedState()
    $atumAccountStatus.set(status)

    if (status.state === 'signed_in') {
      await Promise.all([refreshAtumStatus(), refreshAtumRoster()])
    }
  } catch (error) {
    clearAccountScopedState()
    $atumAccountStatus.set({
      state: 'error',
      configured: true,
      account: null,
      errorCode: errorCode(error),
      providers: $atumAccountStatus.get().providers
    })
  }
}

export async function cancelAtumSignIn(): Promise<void> {
  $atumAccountStatus.set(await atumAccountClient().cancel())
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
