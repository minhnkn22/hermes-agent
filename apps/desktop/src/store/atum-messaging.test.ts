import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AtumAccountClient } from '@/lib/atum-account-client'
import type { AtumMessagingClient, AtumMessagingMessage } from '@/lib/atum-messaging-client'

import {
  $atumAccountStatus,
  $atumDrafts,
  $atumMessages,
  $atumRoster,
  $atumStatus,
  cancelAtumSignIn,
  loadAtumMessages,
  persistAtumDraft,
  pollAtumSync,
  refreshAtumAccountStatus,
  refreshAtumRoster,
  resetAtumMessagingState,
  retryAtumMessage,
  sendAtumMessage,
  setAtumDraft,
  shouldPollAtumSync,
  signInToAtum,
  signInToAtumWithPassword,
  signOutOfAtum
} from './atum-messaging'

const status = {
  accountId: 'account-a',
  connectivity: 'online' as const,
  synchronized: true,
  cursor: 'cursor',
  lastSuccessfulSyncAt: '2026-08-12T00:00:00.000Z',
  nextRetryAt: null,
  errorCode: null
}

function message(overrides: Partial<AtumMessagingMessage> = {}): AtumMessagingMessage {
  return {
    localId: 'local-1',
    id: 'server-1',
    clientMessageId: 'client-1',
    conversationId: 'conversation-1',
    sender: { type: 'account', id: 'account-a' },
    content: 'hello',
    kind: 'text',
    attachments: [],
    replyToMessageId: null,
    forwardedFrom: null,
    reactions: [],
    version: 1,
    createdAt: '2026-08-12T00:00:00.000Z',
    editedAt: null,
    recalledAt: null,
    delivery: 'sent',
    optimistic: false,
    ...overrides
  }
}

function installClients(
  overrides: Partial<AtumMessagingClient> = {},
  accountOverrides: Partial<AtumAccountClient> = {}
) {
  const messaging: AtumMessagingClient = {
    status: vi.fn().mockResolvedValue(status),
    roster: vi.fn().mockResolvedValue([]),
    messages: vi.fn().mockResolvedValue([]),
    draft: vi.fn().mockResolvedValue(null),
    saveDraft: vi
      .fn()
      .mockResolvedValue({ text: '', replyToMessageId: null, attachmentIds: [], revision: 1, updatedAt: '' }),
    send: vi.fn().mockResolvedValue({}),
    retry: vi.fn().mockResolvedValue({}),
    markRead: vi.fn().mockResolvedValue(true),
    sync: vi.fn().mockResolvedValue(status),
    ...overrides
  }

  const account: AtumAccountClient = {
    status: vi.fn().mockResolvedValue({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    }),
    signIn: vi.fn(),
    signInWithPassword: vi.fn(),
    cancel: vi.fn(),
    signOut: vi.fn().mockResolvedValue({
      state: 'signed_out',
      configured: true,
      account: null,
      errorCode: null,
      providers: { google: true, password: true }
    }),
    ...accountOverrides
  }

  Object.assign(window, { hermesDesktop: { messaging, account } })

  return { account, messaging }
}

beforeEach(() => {
  resetAtumMessagingState()
  vi.restoreAllMocks()
})

describe('Atum messaging renderer store', () => {
  it('shows an optimistic send immediately and reconciles with canonical messages', async () => {
    let resolveSend!: () => void

    const send = new Promise<void>(resolve => {
      resolveSend = resolve
    })

    const canonical = message()

    const { messaging } = installClients({
      send: vi.fn().mockReturnValue(send),
      messages: vi.fn().mockResolvedValue([canonical])
    })

    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })

    const pending = sendAtumMessage('conversation-1', ' hello ', 'vi')
    expect($atumMessages.get()['conversation-1']).toMatchObject([
      { content: 'hello', delivery: 'sending', optimistic: true }
    ])
    expect($atumDrafts.get()['conversation-1']).toBe('')

    resolveSend()
    await pending
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello', locale: 'vi' }))
    expect($atumMessages.get()['conversation-1']).toEqual([canonical])
  })

  it('marks a failed optimistic send retryable and retries the same client id', async () => {
    const { messaging } = installClients({ send: vi.fn().mockRejectedValue(new Error('offline')) })
    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })

    await sendAtumMessage('conversation-1', 'hello', 'vi')
    const failed = $atumMessages.get()['conversation-1'][0]
    expect(failed.delivery).toBe('failed_retryable')

    await retryAtumMessage(failed.clientMessageId!)
    expect(messaging.retry).toHaveBeenCalledWith(failed.clientMessageId)
  })

  it('drops an in-flight prior-account roster and clears drafts/messages on sign out', async () => {
    let resolveRoster!: (value: never[]) => void

    const roster = new Promise<never[]>(resolve => {
      resolveRoster = resolve
    })

    installClients({ roster: vi.fn().mockReturnValue(roster) })
    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })
    setAtumDraft('conversation-1', 'private A draft')
    $atumMessages.set({ 'conversation-1': [message()] })

    const pending = refreshAtumRoster()
    await signOutOfAtum()
    resolveRoster([])
    await pending

    expect($atumRoster.get()).toEqual([])
    expect($atumMessages.get()).toEqual({})
    expect($atumDrafts.get()).toEqual({})
    expect($atumAccountStatus.get().state).toBe('signed_out')
  })

  it('clears account-scoped state when native status changes identity', async () => {
    installClients(
      {},
      {
        status: vi.fn().mockResolvedValue({
          state: 'signed_in',
          configured: true,
          account: { id: 'account-b' },
          errorCode: null,
          providers: { google: true, password: true }
        })
      }
    )
    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })
    setAtumDraft('conversation-1', 'account A only')

    await refreshAtumAccountStatus()
    expect($atumAccountStatus.get().account?.id).toBe('account-b')
    expect($atumDrafts.get()).toEqual({})
  })

  it('preserves the same account cache and drafts when native auth expires', async () => {
    installClients(
      {},
      {
        status: vi.fn().mockResolvedValue({
          state: 'expired',
          configured: true,
          account: { id: 'account-a' },
          errorCode: 'account_session_expired',
          providers: { google: true, password: true }
        })
      }
    )
    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })
    $atumStatus.set(status)
    $atumRoster.set([
      {
        id: 'conversation-1',
        title: 'Moon',
        kind: 'direct',
        participantIds: ['moon'],
        updatedAt: '2026-08-12T00:00:00.000Z',
        lastMessageAt: null,
        unreadCount: 0,
        payload: {}
      }
    ])
    $atumMessages.set({ 'conversation-1': [message()] })
    setAtumDraft('conversation-1', 'same-account draft')

    await refreshAtumAccountStatus()

    expect($atumAccountStatus.get().state).toBe('expired')
    expect($atumRoster.get()).toHaveLength(1)
    expect($atumMessages.get()['conversation-1']).toHaveLength(1)
    expect($atumDrafts.get()['conversation-1']).toBe('same-account draft')
  })

  it('publishes password sign-in pending/error state without storing credentials', async () => {
    let rejectSignIn!: (error: Error) => void

    const signIn = new Promise<never>((_, reject) => {
      rejectSignIn = reject
    })

    const { account } = installClients({}, { signInWithPassword: vi.fn().mockReturnValue(signIn) })
    const credentials = { identifier: '@minh', password: 'one-shot-secret' }

    const pending = signInToAtumWithPassword(credentials)
    expect($atumAccountStatus.get().state).toBe('signing_in')
    expect(account.signInWithPassword).toHaveBeenCalledWith(credentials)
    expect(JSON.stringify([$atumAccountStatus.get(), $atumDrafts.get(), $atumMessages.get()])).not.toContain(
      credentials.password
    )

    rejectSignIn(new Error('invalid_credentials'))
    await pending
    expect($atumAccountStatus.get()).toMatchObject({ state: 'error', errorCode: 'invalid_credentials' })
  })

  it('keeps prior valid cache and drafts after a failed reauthentication', async () => {
    installClients({}, { signInWithPassword: vi.fn().mockRejectedValue(new Error('invalid_credentials')) })
    $atumAccountStatus.set({
      state: 'expired',
      configured: true,
      account: { id: 'account-a' },
      errorCode: 'account_session_expired',
      providers: { google: true, password: true }
    })
    $atumStatus.set(status)
    $atumMessages.set({ 'conversation-1': [message()] })
    setAtumDraft('conversation-1', 'do not erase me')

    await signInToAtumWithPassword({ identifier: '@minh', password: 'one-shot-secret' })

    expect($atumAccountStatus.get()).toMatchObject({
      state: 'error',
      account: { id: 'account-a' },
      errorCode: 'invalid_credentials'
    })
    expect($atumMessages.get()['conversation-1']).toHaveLength(1)
    expect($atumDrafts.get()['conversation-1']).toBe('do not erase me')
  })

  it('keeps prior valid cache when an in-flight account switch is cancelled', async () => {
    installClients(
      {},
      {
        cancel: vi.fn().mockResolvedValue({
          state: 'signed_out',
          configured: true,
          account: null,
          errorCode: null,
          providers: { google: true, password: true }
        })
      }
    )
    $atumAccountStatus.set({
      state: 'signing_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })
    $atumStatus.set(status)
    $atumMessages.set({ 'conversation-1': [message()] })
    setAtumDraft('conversation-1', 'preserved through cancel')

    await cancelAtumSignIn()

    expect($atumAccountStatus.get().state).toBe('signed_out')
    expect($atumMessages.get()['conversation-1']).toHaveLength(1)
    expect($atumDrafts.get()['conversation-1']).toBe('preserved through cancel')
  })

  it('recovers from a rejected Google IPC call instead of remaining stuck pending', async () => {
    installClients({}, { signIn: vi.fn().mockRejectedValue(new Error('provider_not_configured')) })

    await signInToAtum()

    expect($atumAccountStatus.get()).toMatchObject({ state: 'error', errorCode: 'provider_not_configured' })
  })

  it.each(['zh', 'zh-hant', 'ja'] as const)('projects %s sends to the hosted en locale contract', async locale => {
    const { messaging } = installClients({ messages: vi.fn().mockResolvedValue([]) })
    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })
    $atumStatus.set(status)

    await sendAtumMessage('conversation-1', `hello from ${locale}`, locale)

    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }))
  })

  it('retains a local draft and reports persistence failure without rejecting', async () => {
    installClients({ saveDraft: vi.fn().mockRejectedValue(new Error('disk_unavailable')) })
    $atumStatus.set(status)
    setAtumDraft('conversation-1', 'offline draft')

    await expect(persistAtumDraft('conversation-1')).resolves.toBe(false)
    expect($atumDrafts.get()['conversation-1']).toBe('offline draft')
    expect($atumStatus.get()).toMatchObject({ connectivity: 'error', errorCode: 'disk_unavailable' })
  })

  it('keeps loaded messages when mark-read persistence fails', async () => {
    installClients({
      messages: vi.fn().mockResolvedValue([message()]),
      markRead: vi.fn().mockRejectedValue(new Error('offline'))
    })
    $atumStatus.set(status)

    await expect(loadAtumMessages('conversation-1')).resolves.toEqual([message()])
    expect($atumMessages.get()['conversation-1']).toHaveLength(1)
    expect($atumStatus.get()).toMatchObject({ connectivity: 'error', errorCode: 'offline' })
  })

  it('refreshes native auth during polling and surfaces expiry without erasing cache or syncing', async () => {
    const { messaging, account } = installClients(
      {},
      {
        status: vi.fn().mockResolvedValue({
          state: 'expired',
          configured: true,
          account: { id: 'account-a' },
          errorCode: 'account_session_expired',
          providers: { google: true, password: true }
        })
      }
    )

    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })
    $atumStatus.set(status)
    $atumMessages.set({ 'conversation-1': [message()] })

    await pollAtumSync()

    expect(account.status).toHaveBeenCalledOnce()
    expect(messaging.sync).not.toHaveBeenCalled()
    expect($atumAccountStatus.get().state).toBe('expired')
    expect($atumStatus.get()?.connectivity).toBe('auth_expired')
    expect($atumMessages.get()['conversation-1']).toHaveLength(1)
  })

  it('does not hot-loop terminal poison or retry before nextRetryAt', async () => {
    const terminal = { ...status, connectivity: 'error' as const, nextRetryAt: null, errorCode: 'invalid_response' }
    const future = { ...status, connectivity: 'offline_cached' as const, nextRetryAt: '2026-08-12T00:01:00.000Z' }
    const { messaging } = installClients({ status: vi.fn().mockResolvedValue(terminal) })
    $atumAccountStatus.set({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-a' },
      errorCode: null,
      providers: { google: true, password: true }
    })

    await pollAtumSync()
    expect(messaging.sync).not.toHaveBeenCalled()
    expect(shouldPollAtumSync(terminal, Date.parse('2026-08-12T00:00:00.000Z'))).toBe(false)
    expect(shouldPollAtumSync(future, Date.parse('2026-08-12T00:00:00.000Z'))).toBe(false)
    expect(shouldPollAtumSync({ ...future, nextRetryAt: 'not-a-date' }, Date.now())).toBe(false)
  })
})
