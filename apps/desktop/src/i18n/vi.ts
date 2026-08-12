import { defineLocale } from './define-locale'

export const vi = defineLocale({
  common: {
    apply: 'Áp dụng',
    back: 'Quay lại',
    save: 'Lưu',
    saving: 'Đang lưu…',
    cancel: 'Hủy',
    change: 'Thay đổi',
    choose: 'Chọn',
    clear: 'Xóa',
    close: 'Đóng',
    collapse: 'Thu gọn',
    confirm: 'Xác nhận',
    connect: 'Kết nối',
    connecting: 'Đang kết nối',
    continue: 'Tiếp tục',
    copied: 'Đã sao chép',
    copy: 'Sao chép',
    copyFailed: 'Không thể sao chép',
    delete: 'Xóa',
    docs: 'Tài liệu',
    done: 'Xong',
    error: 'Lỗi',
    expand: 'Mở rộng',
    failed: 'Thất bại',
    loading: 'Đang tải…',
    refresh: 'Làm mới',
    remove: 'Gỡ bỏ',
    replace: 'Thay thế',
    retry: 'Thử lại',
    run: 'Chạy',
    send: 'Gửi',
    set: 'Đặt',
    skip: 'Bỏ qua',
    update: 'Cập nhật',
    on: 'Bật',
    off: 'Tắt'
  },

  intro: {
    heading: 'Bắt đầu với Atum',
    body: 'Hỏi bất cứ điều gì, hoặc giao cho Atum một việc trên máy của bạn.'
  },

  boot: {
    ready: 'Atum đã sẵn sàng',
    steps: {
      connectingGateway: 'Đang kết nối cổng dữ liệu',
      loadingSettings: 'Đang tải cài đặt',
      loadingSessions: 'Đang tải phiên gần đây',
      startingDesktopConnection: 'Đang kết nối ứng dụng',
      startingHermesDesktop: 'Đang khởi động Atum…'
    },
    failure: {
      title: 'Atum không khởi động được',
      description:
        'Tiến trình nền không khởi động được. Thử một trong các bước khôi phục bên dưới. Không thao tác nào ở đây xóa cuộc trò chuyện hay cài đặt của bạn.',
      retry: 'Thử lại',
      openLogs: 'Mở nhật ký'
    }
  },

  notifications: {
    native: {
      inputBody: 'Atum đang chờ câu trả lời của bạn.',
      turnDoneTitle: 'Atum đã hoàn tất',
      turnDoneBody: 'Câu trả lời đã sẵn sàng.'
    }
  },

  sidebar: {
    nav: {
      'new-session': 'Trò chuyện mới',
      skills: 'Kỹ năng',
      messaging: 'Tin nhắn',
      artifacts: 'Tệp kết quả'
    },
    searchAria: 'Tìm phiên',
    searchPlaceholder: 'Tìm phiên…',
    noMatch: query => `Không có kết quả cho “${query}”`,
    results: 'Kết quả',
    pinned: 'Đã ghim',
    sessions: 'Phiên',
    cronJobs: 'Tác vụ định kỳ',
    showProjects: 'Xem dự án',
    showSessions: 'Xem phiên',
    allPinned: 'Tất cả phiên đều đã được ghim',
    noWorkspace: 'Không có không gian làm việc',
    noProject: 'Không có dự án',
    projectEmpty: 'Dự án này chưa có phiên nào',
    noSessions: 'Chưa có phiên nào',
    projects: {
      sectionLabel: 'Dự án',
      newButton: 'Dự án mới',
      back: 'Tất cả dự án'
    },
    loading: 'Đang tải…',
    loadMore: 'Tải thêm'
  },

  composer: {
    message: 'Tin nhắn',
    placeholderStarting: 'Đang khởi động Atum…',
    placeholderReconnecting: 'Đang kết nối lại với Atum…',
    placeholderFollowUp: 'Nhắn tiếp cho Atum…',
    newSessionPlaceholders: ['Nhắn cho Atum…'],
    followUpPlaceholders: ['Nhắn tiếp cho Atum…'],
    stop: 'Dừng',
    send: 'Gửi',
    thinking: 'Đang suy nghĩ'
  },

  onboarding: {
    headerTitle: 'Atum',
    headerDesc:
      'Điều khiển mọi tác vụ trên máy tính, sử dụng app yêu thích, nhắn tin cho bạn bè - tất cả cùng một nơi.',
    preparingInstall: 'Atum đang hoàn tất cài đặt. Lần đầu thường mất chưa đến một phút.',
    starting: 'Đang khởi động Atum…',
    chooseLater: 'Tôi sẽ chọn nhà cung cấp sau',
    startChatting: 'Bắt đầu'
  }
})
