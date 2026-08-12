import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AtumAccountClient } from '@/lib/atum-account-client'
import type { AtumMessagingClient, AtumMessagingMessage } from '@/lib/atum-messaging-client'

import {
  $atumAccountStatus,
  $atumDrafts,
  $atumMessages,
  $atumRoster,
  refreshAtumAccountStatus,
  refreshAtumRoster,
  resetAtumMessagingState,
  retryAtumMessage,
  sendAtumMessage,
  setAtumDraft,
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
})
