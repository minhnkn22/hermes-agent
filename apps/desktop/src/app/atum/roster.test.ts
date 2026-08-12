import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AtumMessagingConversation } from '@/lib/atum-messaging-client'

import { buildAtumRoster, filterRoster, foldSearchText } from './roster'

const conversation = (overrides: Partial<AtumMessagingConversation> = {}): AtumMessagingConversation => ({
  id: 'c1',
  title: 'Moon',
  kind: 'direct',
  participantIds: ['moon'],
  updatedAt: '2026-08-12T00:00:00.000Z',
  lastMessageAt: '2026-08-12T00:00:00.000Z',
  unreadCount: 0,
  payload: {},
  ...overrides
})

const base = {
  assistantHint: 'Trợ lý của bạn trên máy này',
  assistantTitle: 'Atum'
}

describe('buildAtumRoster', () => {
  it('always leads with the local assistant, even with no hosted conversations', () => {
    const roster = buildAtumRoster({ ...base, activeSessionId: null, conversations: [], dmsAvailable: true })

    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({ id: 'assistant', kind: 'assistant', route: '/' })
  })

  it('routes the assistant at the live session when one exists', () => {
    const roster = buildAtumRoster({ ...base, activeSessionId: 'sess-1', conversations: [], dmsAvailable: true })

    expect(roster[0]!.route).toBe('/sess-1')
  })

  it('omits hosted DMs entirely when the account cannot serve them', () => {
    const roster = buildAtumRoster({
      ...base,
      activeSessionId: null,
      conversations: [conversation()],
      dmsAvailable: false
    })

    expect(roster.map(entry => entry.kind)).toEqual(['assistant'])
  })

  it('maps hosted DMs after the assistant, preserving unread counts and order', () => {
    const roster = buildAtumRoster({
      ...base,
      activeSessionId: null,
      conversations: [
        conversation({ id: 'c1', title: 'Moon', unreadCount: 2, payload: { preview: 'Chào Minh' } }),
        conversation({ id: 'c2', title: 'Sao' })
      ],
      dmsAvailable: true
    })

    expect(roster.map(entry => entry.id)).toEqual(['assistant', 'c1', 'c2'])
    expect(roster[1]).toMatchObject({ preview: 'Chào Minh', route: '/dm/c1', unreadCount: 2 })
  })

  it('falls back to a participant id rather than inventing a title', () => {
    const roster = buildAtumRoster({
      ...base,
      activeSessionId: null,
      conversations: [conversation({ title: null, participantIds: ['moon'] })],
      dmsAvailable: true
    })

    expect(roster[1]!.title).toBe('moon')
  })
})

describe('roster search', () => {
  it('folds Vietnamese diacritics so an unaccented query still matches', () => {
    expect(foldSearchText('Trò chuyện')).toBe('tro chuyen')
    expect(foldSearchText('Đăng nhập')).toBe('dang nhap')
  })

  const entries = buildAtumRoster({
    ...base,
    activeSessionId: null,
    conversations: [conversation({ id: 'c1', title: 'Trò chuyện nhóm' }), conversation({ id: 'c2', title: 'Moon' })],
    dmsAvailable: true
  })

  it('matches on folded title and preview', () => {
    expect(filterRoster(entries, 'tro chuyen').map(entry => entry.id)).toEqual(['c1'])
    expect(filterRoster(entries, 'MOON').map(entry => entry.id)).toEqual(['c2'])
  })

  it('returns everything for an empty or whitespace query', () => {
    expect(filterRoster(entries, '')).toHaveLength(entries.length)
    expect(filterRoster(entries, '   ')).toHaveLength(entries.length)
  })

  it('returns nothing rather than falling back to the full list on no match', () => {
    expect(filterRoster(entries, 'zzzz')).toEqual([])
  })
})

describe('product-model containment', () => {
  // The visible Atum product is one assistant plus hosted DMs. If a future
  // change reaches for the Hermes session/profile/project stores from the
  // roster adapter, the Hermes organisation is back in the product — this test
  // is the tripwire for that, not a style rule.
  const source = readFileSync(resolve(__dirname, 'roster.ts'), 'utf8')

  it.each(['store/session', 'store/profile', 'store/projects', 'store/cron', 'store/layout'])(
    'does not import %s',
    module => {
      expect(source).not.toContain(module)
    }
  )

  it.each(['$sessions', '$profiles', '$projects', '$cronSessions', 'worktree', 'pinned'])(
    'never mentions the Hermes noun %s',
    noun => {
      // Comments explaining what is deliberately absent are allowed; code is not.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n')

      expect(code).not.toContain(noun)
    }
  )
})
