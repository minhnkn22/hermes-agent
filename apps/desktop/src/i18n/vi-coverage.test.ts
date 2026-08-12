import { describe, expect, it } from 'vitest'

import { vi } from './vi'

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
})
