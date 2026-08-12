import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, test } from 'vitest'

import { applyMessagingMigrations, MESSAGING_MIGRATIONS } from './migrations'
import { AtumMessagingStore } from './store'
import type { CanonicalMessage, MessagingConversation } from './types'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'atum-messaging-'))
  tempDirectories.push(directory)

  return join(directory, 'messaging.sqlite3')
}

function conversation(id: string, lastMessageAt = '2026-08-12T03:00:00.000Z') {
  return {
    id,
    title: `Conversation ${id}`,
    kind: 'direct',
    participantIds: ['user-a', 'user-b'],
    updatedAt: lastMessageAt,
    lastMessageAt,
    payload: { id }
  } satisfies Omit<MessagingConversation, 'unreadCount'>
}

function message(id: string, conversationId: string, createdAt: string, content = `Message ${id}`): CanonicalMessage {
  return {
    id,
    conversationId,
    sender: { type: 'user', id: 'user-b' },
    content,
    kind: 'text',
    attachments: [],
    replyToMessageId: null,
    forwardedFrom: null,
    reactions: [],
    version: 1,
    createdAt,
    editedAt: null,
    recalledAt: null,
    delivery: 'sent'
  }
}

test('migrates deterministically from v1 and rejects modified migration history', () => {
  const path = databasePath()
  const oldDatabase = new DatabaseSync(path)
  applyMessagingMigrations(oldDatabase, 1)
  assert.equal((oldDatabase.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1)
  oldDatabase.close()

  const store = new AtumMessagingStore({ accountId: 'account-a', databasePath: path })
  store.close()
  const migrated = new DatabaseSync(path)
  assert.equal(
    (migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    MESSAGING_MIGRATIONS.at(-1)!.version
  )
  assert.ok(migrated.prepare("SELECT 1 AS present FROM sqlite_master WHERE name = 'messaging_pending_mutations'").get())
  migrated.prepare('UPDATE messaging_schema_migrations SET checksum = ? WHERE version = 1').run('tampered')
  migrated.close()

  assert.throws(
    () => new AtumMessagingStore({ accountId: 'account-a', databasePath: path }),
    /Unknown or modified messaging migration/
  )
})

test('partitions conversations, drafts, cursors, and change de-duplication by account', () => {
  const path = databasePath()
  const accountA = new AtumMessagingStore({ accountId: 'account-a', databasePath: path })
  const accountB = new AtumMessagingStore({ accountId: 'account-b', databasePath: path })
  accountA.upsertConversation(conversation('shared'))
  accountA.upsertConversation(conversation('account-a-second'))
  accountB.upsertConversation(conversation('shared'))

  assert.equal(accountA.saveDraft('shared', { text: 'A' }, '2026-08-12T03:00:01.000Z').revision, 1)
  assert.equal(accountA.saveDraft('shared', { text: 'A2' }, '2026-08-12T03:00:02.000Z').revision, 2)
  assert.equal(accountB.saveDraft('shared', { text: 'B' }, '2026-08-12T03:00:01.000Z').revision, 1)
  assert.equal(accountA.getDraft('shared')?.text, 'A2')
  assert.equal(accountB.getDraft('shared')?.text, 'B')
  accountA.saveDraft('account-a-second', { text: 'Independent conversation draft' })
  assert.equal(accountA.getDraft('shared')?.text, 'A2')
  assert.equal(accountA.getDraft('account-a-second')?.text, 'Independent conversation draft')

  assert.equal(accountA.commitSyncCursor(null, 'cursor-a'), true)
  assert.equal(accountA.commitSyncCursor(null, 'stale'), false)
  assert.equal(accountB.getSyncCursor().cursor, null)
  assert.equal(accountA.recordSyncChange('change-1'), true)
  assert.equal(accountA.recordSyncChange('change-1'), false)
  assert.equal(accountB.recordSyncChange('change-1'), true)

  accountA.close()
  accountB.close()
})

test('retains optimistic identity and drafts across outage, crash, and relaunch', () => {
  const path = databasePath()
  let store = new AtumMessagingStore({ accountId: 'account-a', databasePath: path })
  store.upsertConversation(conversation('conversation-a'))
  store.saveDraft('conversation-a', { text: 'Xin chào' }, '2026-08-12T03:00:00.000Z')

  const queued = store.queueSend({
    conversationId: 'conversation-a',
    clientMessageId: 'client-1',
    content: 'Xin chào',
    locale: 'vi',
    now: '2026-08-12T03:00:01.000Z'
  })

  assert.equal(queued.state, 'queued')
  assert.equal(
    store.queueSend({
      conversationId: 'conversation-a',
      clientMessageId: 'client-1',
      content: 'Xin chào',
      locale: 'vi',
      now: '2026-08-12T03:00:02.000Z'
    }).id,
    queued.id
  )
  assert.throws(
    () =>
      store.queueSend({
        conversationId: 'conversation-a',
        clientMessageId: 'client-1',
        content: 'Different bytes',
        locale: 'vi'
      }),
    /idempotency_conflict/
  )

  assert.equal(store.markMutationSending('client-1').attemptCount, 1)
  store.close()
  store = new AtumMessagingStore({ accountId: 'account-a', databasePath: path })
  assert.equal(store.listDueMutations('9999-01-01T00:00:00.000Z')[0]?.state, 'queued')
  assert.equal(store.listMessages('conversation-a')[0]?.delivery, 'queued')

  store.markMutationSending('client-1', '2026-08-12T03:01:00.000Z')

  const failed = store.markMutationFailed('client-1', {
    code: 'temporarily_unavailable',
    retryable: true,
    retryAt: '2026-08-12T03:02:00.000Z',
    now: '2026-08-12T03:01:01.000Z'
  })

  assert.equal(failed.state, 'failed_retryable')
  assert.equal(store.listDueMutations('2026-08-12T03:01:59.999Z').length, 0)
  assert.equal(store.listDueMutations('2026-08-12T03:02:00.000Z').length, 1)
  store.markMutationSending('client-1', '2026-08-12T03:02:00.000Z')
  assert.equal(
    store.markMutationFailed('client-1', {
      code: 'version_conflict',
      retryable: false,
      conflicted: true,
      now: '2026-08-12T03:02:01.000Z'
    }).state,
    'conflicted'
  )
  assert.equal(store.listDueMutations('9999-01-01T00:00:00.000Z').length, 0)
  assert.equal(store.getDraft('conversation-a')?.text, 'Xin chào')
  store.close()
})

test('canonicalizes acknowledgements, collapses duplicate echoes, and preserves newer drafts', () => {
  const store = new AtumMessagingStore({ accountId: 'account-a', databasePath: databasePath() })
  store.upsertConversation(conversation('conversation-a'))
  store.saveDraft('conversation-a', { text: 'First' }, '2026-08-12T03:00:00.000Z')
  store.queueSend({
    conversationId: 'conversation-a',
    clientMessageId: 'client-1',
    content: 'First',
    locale: 'vi',
    now: '2026-08-12T03:00:01.000Z'
  })
  store.saveDraft('conversation-a', { text: 'Newer draft' }, '2026-08-12T03:00:02.000Z')

  const canonical = message('server-1', 'conversation-a', '2026-08-12T03:00:03.000Z', 'First')

  store.canonicalizeMessage({ message: canonical, incrementUnread: false })
  assert.equal(store.listMessages('conversation-a').length, 2, 'echo can arrive before ack')
  const reconciled = store.canonicalizeMessage({ message: canonical, clientMessageId: 'client-1' })
  assert.equal(reconciled.id, 'server-1')
  assert.equal(reconciled.clientMessageId, 'client-1')
  assert.equal(reconciled.optimistic, false)
  assert.equal(store.listMessages('conversation-a').length, 1)
  assert.equal(store.getDraft('conversation-a')?.text, 'Newer draft')

  store.saveDraft('conversation-a', { text: 'Clear me after ack' })
  store.queueSend({
    conversationId: 'conversation-a',
    clientMessageId: 'client-2',
    content: 'Clear me after ack',
    locale: 'vi',
    now: '2026-08-12T03:00:04.000Z'
  })
  store.canonicalizeMessage({
    message: message('server-2', 'conversation-a', '2026-08-12T03:00:05.000Z', 'Clear me after ack'),
    clientMessageId: 'client-2'
  })
  assert.equal(store.getDraft('conversation-a'), null)

  store.canonicalizeMessage({
    message: canonical,
    clientMessageId: 'client-1',
    incrementUnread: true
  })
  assert.equal(store.listMessages('conversation-a').length, 2)
  assert.equal(store.listConversations()[0]?.unreadCount, 0, 'duplicate echo does not increment unread')

  store.canonicalizeMessage({
    message: { ...canonical, content: 'Server edit', version: 2 }
  })
  store.canonicalizeMessage({ message: canonical })
  assert.equal(
    store.listMessages('conversation-a').find(item => item.id === canonical.id)?.content,
    'Server edit',
    'an out-of-order older server projection cannot clobber a newer version'
  )
  store.close()
})

test('advances read state monotonically and retains local work on projection reset', () => {
  const store = new AtumMessagingStore({ accountId: 'account-a', databasePath: databasePath() })
  store.upsertConversation(conversation('conversation-a'))
  const first = message('server-1', 'conversation-a', '2026-08-12T03:00:01.000Z')
  const second = message('server-2', 'conversation-a', '2026-08-12T03:00:02.000Z')
  store.canonicalizeMessage({ message: first, incrementUnread: true })
  store.canonicalizeMessage({ message: second, incrementUnread: true })
  assert.equal(store.listConversations()[0]?.unreadCount, 2)
  assert.equal(store.markRead('conversation-a', 'server-1'), true)
  assert.equal(store.listConversations()[0]?.unreadCount, 1)
  assert.equal(store.markRead('conversation-a', 'server-1'), false)
  assert.equal(store.markRead('conversation-a', 'server-2'), true)
  assert.equal(store.listConversations()[0]?.unreadCount, 0)
  store.canonicalizeMessage({
    message: message('server-old', 'conversation-a', '2026-08-12T02:59:00.000Z'),
    incrementUnread: true
  })
  assert.equal(
    store.listConversations()[0]?.unreadCount,
    0,
    'older backfill does not become unread after a later read marker'
  )

  store.saveDraft('conversation-a', { text: 'Offline draft' })
  store.queueSend({
    conversationId: 'conversation-a',
    clientMessageId: 'client-reset',
    content: 'Offline draft',
    locale: 'vi'
  })
  store.commitSyncCursor(null, 'cursor-before-reset')
  store.resetProjection()
  assert.equal(store.getSyncCursor().cursor, null)
  assert.equal(store.getDraft('conversation-a')?.text, 'Offline draft')
  assert.equal(store.listDueMutations('9999-01-01T00:00:00.000Z').length, 1)
  const remaining = store.listMessages('conversation-a')
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0]?.clientMessageId, 'client-reset')
  assert.equal(remaining[0]?.optimistic, true)
  store.close()
})

test('switches indexed 10,000-message conversations at <=100ms p95 on this host', () => {
  const store = new AtumMessagingStore({ accountId: 'benchmark', databasePath: databasePath() })
  store.upsertConversation(conversation('conversation-a'))
  store.upsertConversation(conversation('conversation-b'))

  for (let index = 0; index < 10_000; index += 1) {
    const conversationId = index % 2 === 0 ? 'conversation-a' : 'conversation-b'
    const createdAt = new Date(Date.UTC(2026, 7, 12, 3, 0, 0, index)).toISOString()
    store.canonicalizeMessage({
      message: message(`server-${String(index).padStart(5, '0')}`, conversationId, createdAt)
    })
  }

  const samples: number[] = []

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const conversationId = iteration % 2 === 0 ? 'conversation-a' : 'conversation-b'
    const startedAt = performance.now()
    const result = store.listMessages(conversationId, 100)
    samples.push(performance.now() - startedAt)
    assert.equal(result.length, 100)
  }

  samples.sort((left, right) => left - right)
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!
  console.info(`ATUM_MESSAGING_SWITCH_P95_MS=${p95.toFixed(3)} samples=${samples.length} messages=10000`)
  assert.ok(p95 <= 100, `expected p95 <= 100ms, measured ${p95.toFixed(3)}ms`)
  store.close()
}, 120_000)
