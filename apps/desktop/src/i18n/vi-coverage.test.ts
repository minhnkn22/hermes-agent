import { describe, expect, it } from 'vitest'

import { en } from './en'
import { ja } from './ja'
import { vi } from './vi'
import { zh } from './zh'
import { zhHant } from './zh-hant'

describe('Vietnamese-first P0 copy', () => {
  it('locks the founder-facing Atum copy verbatim', () => {
    expect(vi.onboarding).toMatchObject({
      headerDesc:
        'Điều khiển mọi tác vụ trên máy tính, sử dụng app yêu thích, nhắn tin cho bạn bè - tất cả cùng một nơi.',
      headerSub: 'AI Superapp cho người Việt',
      headerTitle: 'Atum'
    })
    expect(vi.intro).toEqual({
      body: 'Hỏi bất cứ điều gì, hoặc giao cho Atum một việc trên máy của bạn.',
      heading: 'Bắt đầu với Atum'
    })
  })

  it('covers the chat, recovery, navigation, and tool approval path', () => {
    expect(vi.composer.newSessionPlaceholders).toEqual(['Nhắn cho Atum…'])
    expect(vi.composer).toMatchObject({
      placeholderFollowUp: 'Nhắn tiếp cho Atum…',
      send: 'Gửi',
      stop: 'Dừng',
      thinking: 'Đang suy nghĩ'
    })
    expect(vi.sidebar.nav).toEqual({
      artifacts: 'Tệp kết quả',
      messaging: 'Tin nhắn',
      'new-session': 'Trò chuyện mới',
      skills: 'Kỹ năng'
    })
    expect(vi.sidebar.emptyRoster).toBe('Chưa có cuộc trò chuyện nào')
    expect(vi.errors.offline).toBe('Mất kết nối. Atum sẽ tự kết nối lại.')
    expect(vi.errors.turnFailed).toBe('Không gửi được. Nhấn Thử lại.')
    expect(vi.assistant.tool).toMatchObject({
      approvalTitle: 'Atum muốn chạy lệnh này',
      approveAlways: 'Luôn cho phép',
      approveOnce: 'Cho phép một lần',
      approveSession: 'Cho phép trong phiên này',
      deny: 'Từ chối',
      statusDone: 'Xong',
      statusRecovered: 'Đã khôi phục',
      statusRunning: 'Đang chạy'
    })
  })

  it('ships the Atum product shell copy Vietnamese-first', () => {
    expect(vi.atum.nav).toEqual({
      aria: 'Điều hướng chính',
      chat: 'Trò chuyện',
      devices: 'Máy tính',
      devicesSoon: 'Máy tính — sắp có',
      settings: 'Cài đặt',
      account: 'Tài khoản'
    })
    expect(vi.atum.roster).toMatchObject({
      title: 'Trò chuyện',
      search: 'Tìm cuộc trò chuyện',
      assistant: 'Atum',
      emptySearch: 'Không tìm thấy cuộc trò chuyện nào'
    })
    expect(vi.atum.workspace.title).toBe('Không gian thao tác')
    expect(vi.atum.auth.title).toBe('Chào mừng đến Atum')
    expect(vi.atum.offline.banner).toBe('Đang ngoại tuyến — hiển thị nội dung đã lưu')
  })

  it('never leaks a Hermes noun into the Atum shell vocabulary', () => {
    const copy = JSON.stringify(vi.atum).toLowerCase()

    for (const noun of ['hermes', 'session', 'phiên làm việc', 'worktree', 'profile', 'project', 'cron']) {
      expect(copy).not.toContain(noun)
    }
  })
})

describe('Atum namespace coverage across every locale', () => {
  const LOCALES = { en, ja, vi, zh, 'zh-hant': zhHant }

  // `defineLocale` merges over `en`, so a missing override silently falls back
  // to English. Assert real translations exist rather than that the KEY exists.
  it.each(Object.entries(LOCALES))('%s carries the whole atum namespace', (name, catalog) => {
    expect(Object.keys(catalog.atum).sort()).toEqual(['account', 'auth', 'chat', 'nav', 'offline', 'roster', 'workspace'])
    expect(typeof catalog.atum.roster.unread(3)).toBe('string')
    expect(typeof catalog.atum.roster.results(3)).toBe('string')
    expect(catalog.atum.workspace.title.length).toBeGreaterThan(0)

    if (name !== 'en') {
      // A locale that merely inherited English here would be a regression.
      expect(catalog.atum.nav.aria).not.toBe(en.atum.nav.aria)
      expect(catalog.atum.auth.title).not.toBe(en.atum.auth.title)
    }
  })
})
