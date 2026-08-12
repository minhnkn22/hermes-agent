import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

import type { AtumAccountAuthController } from './account-auth'
import { ATUM_ACCOUNT_IPC_CHANNELS, registerAtumAccountIpc } from './account-ipc'

test('account IPC exposes only sanitized commands and status', async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>()

  const ipc = {
    handle(channel: string, listener: (...args: any[]) => unknown) {handlers.set(channel, listener)},
    removeHandler(channel: string) {handlers.delete(channel)}
  }

  const sanitized = {
    state: 'signed_in' as const,
    configured: true,
    account: { id: 'account-a', displayName: 'Minh', handle: null },
    errorCode: null
  }

  const controller = {
    status: vi.fn(() => sanitized),
    signIn: vi.fn(async () => sanitized),
    cancel: vi.fn(() => sanitized),
    signOut: vi.fn(async () => ({ ...sanitized, state: 'signed_out', account: null }))
  } as unknown as AtumAccountAuthController

  const unregister = registerAtumAccountIpc(ipc, controller)

  assert.deepEqual([...handlers.keys()].sort(), [...ATUM_ACCOUNT_IPC_CHANNELS].sort())
  assert.equal([...handlers.keys()].some(channel => /token|refresh|verifier|secret|fetch|supabase/i.test(channel)), false)
  const rendered = JSON.stringify(await handlers.get('atum:account:status')!({}))
  assert.equal(/access|refresh|verifier|anon.?key|supabase/i.test(rendered), false)

  unregister()
  assert.equal(handlers.size, 0)
})
