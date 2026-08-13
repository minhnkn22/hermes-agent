import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

import { ATUM_MESSAGING_IPC_CHANNELS, registerAtumMessagingIpc } from './ipc'
import type { MessagingClientBoundary } from './types'

function harness() {
  const handlers = new Map<string, (...args: any[]) => unknown>()

  const ipc = {
    handle(channel: string, listener: (...args: any[]) => unknown) {
      handlers.set(channel, listener)
    },
    removeHandler(channel: string) {
      handlers.delete(channel)
    }
  }

  const client = {
    status: vi.fn(),
    roster: vi.fn(),
    messages: vi.fn(),
    draft: vi.fn(),
    saveDraft: vi.fn(),
    send: vi.fn(),
    retry: vi.fn(),
    markRead: vi.fn(),
    sync: vi.fn()
  } as unknown as MessagingClientBoundary

  return { handlers, ipc, client }
}

test('registers only the allowlisted model operations and removes them cleanly', () => {
  const { handlers, ipc, client } = harness()
  const unregister = registerAtumMessagingIpc(ipc, client)

  assert.deepEqual([...handlers.keys()].sort(), [...ATUM_MESSAGING_IPC_CHANNELS].sort())
  assert.equal([...handlers.keys()].some(channel => /token|database|fetch|supabase|secret/i.test(channel)), false)
  unregister()
  assert.equal(handlers.size, 0)
})

test('send IPC reconstructs the allowlisted request and rejects renderer-authored authority fields', async () => {
  const { handlers, ipc, client } = harness()
  registerAtumMessagingIpc(ipc, client)
  const send = handlers.get('atum:messaging:send')!

  const input = {
    conversationId: 'conversation-a',
    clientMessageId: 'client-a',
    content: 'Xin chào',
    locale: 'vi',
    attachmentIds: [],
    sender_id: 'forged',
    created_at: 'forged',
    status: 'forged'
  }

  await send({}, input)
  assert.deepEqual(vi.mocked(client.send).mock.calls[0]?.[0], {
    conversationId: 'conversation-a',
    clientMessageId: 'client-a',
    content: 'Xin chào',
    locale: 'vi',
    replyToMessageId: null,
    attachmentIds: []
  })
  assert.throws(() => send({}, { ...input, locale: 'xx' }), /locale/)
})
