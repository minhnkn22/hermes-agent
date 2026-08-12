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
    formatJson: 'Định dạng JSON',
    free: 'Miễn phí',
    loading: 'Đang tải…',
    notSet: 'Chưa đặt',
    refresh: 'Làm mới',
    remove: 'Gỡ bỏ',
    replace: 'Thay thế',
    retry: 'Thử lại',
    run: 'Chạy',
    send: 'Gửi',
    set: 'Đặt',
    skip: 'Bỏ qua',
    update: 'Cập nhật',
    tryHint: term => `Thử “${term}”`,
    on: 'Bật',
    off: 'Tắt'
  },

  intro: {
    heading: 'Bắt đầu với Atum',
    body: 'Hỏi bất cứ điều gì, hoặc giao cho Atum một việc trên máy của bạn.'
  },

  dm: {
    sectionTitle: 'Tin nhắn',
    brandLine: 'Điều khiển mọi tác vụ trên máy tính, sử dụng app yêu thích, nhắn tin cho bạn bè - tất cả cùng một nơi.',
    compose: 'Nhắn tin...',
    send: 'Gửi',
    retry: 'Thử lại',
    sending: 'Đang gửi...',
    sendFailed: 'Gửi thất bại',
    noMessages: 'Chưa có tin nhắn',
    noConversations: 'Chưa có cuộc trò chuyện',
    offline: 'Ngoại tuyến',
    reconnecting: 'Đang kết nối lại...',
    authExpired: 'Hết phiên đăng nhập',
    authExpiredAction: 'Đăng nhập lại',
    errorGeneric: 'Lỗi kết nối',
    loadingMessages: 'Đang tải tin nhắn...',
    today: 'Hôm nay',
    yesterday: 'Hôm qua',
    unreadCount: count => `${count} tin chưa đọc`,
    signedInAs: name => `Đã đăng nhập: ${name}`,
    notSignedIn: 'Chưa đăng nhập',
    signIn: 'Đăng nhập',
    identifier: 'Tên đăng nhập',
    identifierHint: '@tên, email hoặc số điện thoại',
    identifierPlaceholder: '@minh · minh@email.com · 0912…',
    identifierRequired: 'Nhập tên đăng nhập, email hoặc số điện thoại.',
    password: 'Mật khẩu',
    passwordRequired: 'Nhập mật khẩu.',
    signingIn: 'Đang đăng nhập…',
    googlePending: 'Đang mở trình duyệt…',
    signInFailed: 'Sai tên đăng nhập hoặc mật khẩu.',
    signInOffline: 'Không kết nối được. Kiểm tra mạng rồi thử lại.',
    signInProviderDown: 'Đăng nhập tạm thời không khả dụng. Thử lại sau ít phút.',
    signInRetry: 'Thử lại',
    continueWithGoogle: 'Tiếp tục với Google',
    or: 'hoặc',
    signOut: 'Đăng xuất',
    cancelSignIn: 'Hủy',
    you: 'Bạn',
    messageDelivered: 'Đã gửi',
    messageRead: 'Đã xem',
    unavailable: 'Đăng nhập chưa khả dụng trong bản này.'
  },

  atum: {
    nav: {
      aria: 'Điều hướng chính',
      chat: 'Trò chuyện',
      devices: 'Máy tính',
      devicesSoon: 'Máy tính — sắp có',
      settings: 'Cài đặt',
      account: 'Tài khoản'
    },
    account: {
      menu: 'Menu tài khoản',
      signedOut: 'Chưa đăng nhập',
      language: 'Ngôn ngữ',
      theme: 'Giao diện'
    },
    roster: {
      title: 'Trò chuyện',
      search: 'Tìm cuộc trò chuyện',
      assistant: 'Atum',
      assistantHint: 'Trợ lý của bạn trên máy này',
      unread: count => `${count} tin chưa đọc`,
      results: count => `${count} kết quả`,
      emptySearch: 'Không tìm thấy cuộc trò chuyện nào',
      emptySearchHint: 'Thử từ khóa khác.',
      loadFailed: 'Không tải được danh sách trò chuyện'
    },
    chat: {
      none: 'Chọn một cuộc trò chuyện',
      noneHint: 'Chọn cuộc trò chuyện ở cột bên trái để bắt đầu.',
      openRoster: 'Hiện danh sách trò chuyện',
      closeRoster: 'Ẩn danh sách trò chuyện'
    },
    workspace: {
      title: 'Không gian thao tác',
      open: 'Mở không gian thao tác',
      close: 'Đóng không gian thao tác',
      none: 'Cuộc trò chuyện này chưa có thao tác nào',
      resize: 'Thay đổi độ rộng',
      tabView: 'Xem',
      tabFiles: 'Tệp',
      tabDetails: 'Chi tiết',
      empty: 'Chưa có gì để xem',
      detailsConversation: 'Cuộc trò chuyện',
      detailsParticipants: 'Thành viên',
      detailsUpdated: 'Hoạt động gần nhất'
    },
    auth: {
      title: 'Chào mừng đến Atum',
      expiredTitle: 'Đăng nhập lại để tiếp tục',
      expiredBody: 'Phiên đăng nhập đã hết hạn. Cuộc trò chuyện của bạn vẫn được giữ nguyên.',
      terms: 'Bằng việc tiếp tục, bạn đồng ý với Điều khoản của Atum.'
    },
    offline: {
      banner: 'Đang ngoại tuyến — hiển thị nội dung đã lưu',
      reconnecting: 'Đang kết nối lại…',
      reconnected: 'Đã kết nối lại'
    }
  },

  boot: {
    ready: 'Atum đã sẵn sàng',
    desktopBootFailedWithMessage: message => `Không khởi động được Atum: ${message}`,
    steps: {
      connectingGateway: 'Đang kết nối cổng dữ liệu',
      loadingSettings: 'Đang tải cài đặt',
      loadingSessions: 'Đang tải phiên gần đây',
      startingDesktopConnection: 'Đang kết nối ứng dụng',
      startingHermesDesktop: 'Đang khởi động Atum…'
    },
    errors: {
      backgroundExited: 'Tiến trình nền của Atum đã dừng.',
      backgroundExitedDuringStartup: 'Tiến trình nền của Atum đã dừng khi khởi động.',
      backendStopped: 'Tiến trình nền đã dừng',
      desktopBootFailed: 'Không khởi động được Atum',
      gatewayConnectionLost: 'Mất kết nối với Atum',
      gatewaySignInRequired: 'Cần đăng nhập lại để kết nối',
      ipcBridgeUnavailable: 'Không thể kết nối ứng dụng với tiến trình nền.'
    },
    failure: {
      title: 'Atum không khởi động được',
      description:
        'Tiến trình nền không khởi động được. Thử một trong các bước khôi phục bên dưới. Không thao tác nào ở đây xóa cuộc trò chuyện hay cài đặt của bạn.',
      remoteTitle: 'Cần đăng nhập lại',
      remoteDescription:
        'Phiên kết nối từ xa đã hết hạn. Đăng nhập lại để tiếp tục. Cuộc trò chuyện và cài đặt của bạn vẫn được giữ nguyên.',
      retry: 'Thử lại',
      repairInstall: 'Sửa cài đặt',
      useLocalGateway: 'Dùng Atum trên máy này',
      gatewaySettings: 'Cài đặt kết nối',
      back: 'Quay lại',
      openLogs: 'Mở nhật ký',
      repairHint: 'Atum sẽ chạy lại trình cài đặt. Lần đầu có thể mất vài phút.',
      remoteSignInHint: signInLabel => `Đăng xuất phiên đã lưu rồi mở ${signInLabel}.`,
      signOutAndSignIn: 'Đăng xuất và đăng nhập lại',
      remoteFailureHint: 'Kiểm tra địa chỉ kết nối và đăng nhập, hoặc chuyển sang Atum trên máy này.',
      hideRecentLogs: 'Ẩn nhật ký gần đây',
      showRecentLogs: 'Xem nhật ký gần đây',
      signedInTitle: 'Đã đăng nhập',
      signedInMessage: 'Đang kết nối lại…',
      signInIncompleteTitle: 'Chưa đăng nhập xong',
      signInIncompleteMessage: 'Cửa sổ đăng nhập đã đóng trước khi hoàn tất.',
      signInFailed: 'Đăng nhập thất bại',
      signInToRemoteGateway: 'Đăng nhập kết nối từ xa',
      signInWithProvider: provider => `Đăng nhập bằng ${provider}`,
      identityProvider: 'nhà cung cấp tài khoản của bạn'
    }
  },

  notifications: {
    region: 'Thông báo',
    hide: 'Ẩn',
    show: 'Hiện',
    more: count => `Thêm ${count} thông báo`,
    clearAll: 'Xóa tất cả',
    dismiss: 'Đóng thông báo',
    details: 'Chi tiết',
    copyDetail: 'Sao chép chi tiết',
    copyDetailFailed: 'Không sao chép được chi tiết thông báo',
    backendOutOfDateTitle: 'Tiến trình nền đã cũ',
    backendOutOfDateMessage: 'Hãy cập nhật Atum để ứng dụng và tiến trình nền hoạt động đồng bộ.',
    installMethodUnsupportedTitle: 'Cách cài đặt không được hỗ trợ',
    updateHermes: 'Cập nhật Atum',
    updateReadyTitle: 'Có bản cập nhật',
    updateReadyMessage: count => `Có ${count} thay đổi mới.`,
    seeWhatsNew: 'Xem điểm mới',
    native: {
      approvalTitle: 'Cần bạn cho phép',
      approveAction: 'Cho phép',
      rejectAction: 'Từ chối',
      inputTitle: 'Cần bạn trả lời',
      inputBody: 'Atum đang chờ câu trả lời của bạn.',
      turnDoneTitle: 'Atum đã hoàn tất',
      turnDoneBody: 'Câu trả lời đã sẵn sàng.',
      turnErrorTitle: 'Tác vụ thất bại',
      backgroundDoneTitle: 'Tác vụ nền đã hoàn tất',
      backgroundFailedTitle: 'Tác vụ nền thất bại',
      creditsTitle: 'Hạn mức sử dụng'
    }
  },

  titlebar: {
    hideSidebar: 'Ẩn thanh bên',
    showSidebar: 'Hiện thanh bên',
    search: 'Tìm kiếm',
    searchTitle: 'Tìm cuộc trò chuyện, màn hình và thao tác',
    swapSidebarSides: 'Đổi bên thanh cạnh',
    swapSidebarSidesTitle: 'Đổi vị trí danh sách trò chuyện và trình duyệt tệp',
    hideRightSidebar: 'Ẩn không gian thao tác',
    showRightSidebar: 'Hiện không gian thao tác',
    muteHaptics: 'Tắt phản hồi rung',
    unmuteHaptics: 'Bật phản hồi rung',
    openSettings: 'Mở cài đặt',
    openStarmap: 'Mở bản đồ bộ nhớ',
    openKeybinds: 'Phím tắt',
    layoutEditor: 'Chỉnh bố cục',
    layoutEditorTitle: 'Chỉnh bố cục — ⌘-bấm để đặt lại'
  },

  sidebar: {
    navAria: 'Điều hướng chính',
    emptyRoster: 'Chưa có cuộc trò chuyện nào',
    nav: {
      'new-session': 'Trò chuyện mới',
      skills: 'Kỹ năng',
      messaging: 'Tin nhắn',
      artifacts: 'Tệp kết quả'
    },
    searchAria: 'Tìm phiên',
    searchPlaceholder: 'Tìm phiên…',
    clearSearch: 'Xóa tìm kiếm',
    noMatch: query => `Không có kết quả cho “${query}”`,
    results: 'Kết quả',
    pinned: 'Đã ghim',
    sessions: 'Phiên',
    cronJobs: 'Tác vụ định kỳ',
    groupAriaGrouped: 'Hiện cuộc trò chuyện thành một danh sách',
    groupAriaUngrouped: 'Nhóm cuộc trò chuyện theo không gian làm việc',
    showProjects: 'Xem dự án',
    showSessions: 'Xem phiên',
    groupTitleGrouped: 'Bỏ nhóm cuộc trò chuyện',
    groupTitleUngrouped: 'Nhóm theo không gian làm việc',
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
    row: {
      sessionIdle: 'Đang chờ',
      sessionRunning: 'Đang chạy',
      needsInput: 'Cần bạn trả lời',
      waitingForAnswer: 'Đang chờ câu trả lời của bạn',
      finishedUnread: 'Đã hoàn tất — chưa xem',
      backgroundRunning: 'Tác vụ đang chạy nền'
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
    headerSub: 'AI Superapp cho người Việt',
    headerDesc:
      'Điều khiển mọi tác vụ trên máy tính, sử dụng app yêu thích, nhắn tin cho bạn bè - tất cả cùng một nơi.',
    preparingInstall: 'Atum đang hoàn tất cài đặt. Lần đầu thường mất chưa đến một phút.',
    starting: 'Đang khởi động Atum…',
    chooseLater: 'Tôi sẽ chọn nhà cung cấp sau',
    startChatting: 'Bắt đầu'
  },

  assistant: {
    retry: 'Thử lại',
    copy: 'Sao chép',
    thread: {
      loadingSession: 'Đang tải cuộc trò chuyện',
      showEarlier: 'Xem tin nhắn trước đó',
      loadingResponse: 'Atum đang chuẩn bị câu trả lời',
      resumeWhenBackgroundDone: count => `Sẽ tiếp tục khi ${count} tác vụ nền hoàn tất`,
      thinking: 'Đang suy nghĩ',
      today: time => `Hôm nay, ${time}`,
      yesterday: time => `Hôm qua, ${time}`,
      copy: 'Sao chép',
      refresh: 'Thử lại',
      moreActions: 'Thao tác khác',
      branchNewChat: 'Tách thành cuộc trò chuyện mới',
      dismissError: 'Đóng lỗi',
      readAloudFailed: 'Không đọc được thành tiếng',
      preparingAudio: 'Đang chuẩn bị âm thanh…',
      stopReading: 'Dừng đọc',
      readAloud: 'Đọc thành tiếng',
      editMessage: 'Sửa tin nhắn',
      expandMessage: 'Mở rộng tin nhắn',
      scrollToBottom: 'Đến tin nhắn mới nhất',
      stop: 'Dừng',
      restorePrevious: 'Khôi phục điểm lưu trước',
      restoreCheckpoint: 'Khôi phục điểm lưu',
      restoreFromHere: 'Khôi phục điểm lưu — chạy lại từ tin nhắn này',
      restoreTitle: 'Khôi phục về điểm này?',
      restoreBody: 'Mọi nội dung sau tin nhắn này sẽ bị gỡ khỏi cuộc trò chuyện và yêu cầu sẽ được chạy lại.',
      restoreConfirm: 'Khôi phục và chạy lại',
      restoreNext: 'Khôi phục điểm lưu tiếp theo',
      goForward: 'Tiến tới',
      sendEdited: 'Gửi nội dung đã sửa',
      attachingFile: 'Đang đính kèm…'
    },
    approval: {
      gatewayDisconnected: 'Atum chưa kết nối',
      sendFailed: 'Không gửi được lựa chọn',
      run: 'Cho phép một lần',
      command: 'Lệnh',
      moreOptions: 'Các lựa chọn cho phép khác',
      allowSession: 'Cho phép trong phiên này',
      alwaysAllowMenu: 'Luôn cho phép…',
      jumpToApproval: 'Cần bạn cho phép',
      reject: 'Từ chối',
      alwaysTitle: 'Luôn cho phép lệnh này?',
      alwaysDescription: pattern => `Atum sẽ thêm “${pattern}” vào danh sách lệnh luôn được phép.`,
      alwaysAllow: 'Luôn cho phép'
    },
    tool: {
      statusRunning: 'Đang chạy',
      statusDone: 'Xong',
      statusRecovered: 'Đã khôi phục',
      approvalTitle: 'Atum muốn chạy lệnh này',
      approveOnce: 'Cho phép một lần',
      approveSession: 'Cho phép trong phiên này',
      approveAlways: 'Luôn cho phép',
      deny: 'Từ chối',
      statusError: 'Lỗi'
    }
  },

  statusStack: {
    agents: 'Trợ lý',
    background: () => 'Đang chạy nền',
    subagents: count => `${count} trợ lý phụ`,
    todos: (done, total) => `Tác vụ ${done}/${total}`,
    running: 'Đang chạy',
    stop: 'Dừng',
    dismiss: 'Đóng',
    exit: code => `mã thoát ${code}`
  },

  modelPicker: {
    title: 'Chọn mô hình',
    current: 'đang dùng:',
    unknown: '(không rõ)',
    search: 'Lọc nhà cung cấp và mô hình…',
    noModels: 'Không tìm thấy mô hình.',
    addProvider: 'Thêm nhà cung cấp',
    loadFailed: 'Không tải được danh sách mô hình',
    noAuthenticatedProviders: 'Chưa kết nối nhà cung cấp nào.',
    pro: 'Pro',
    proNeedsSubscription: 'Mô hình Pro cần gói đăng ký trả phí.',
    free: 'Miễn phí',
    freeTier: 'Gói miễn phí',
    priceTitle: 'Giá đầu vào / đầu ra cho mỗi triệu token',
    wasPrice: 'trước đây'
  },

  errors: {
    offline: 'Mất kết nối. Atum sẽ tự kết nối lại.',
    turnFailed: 'Không gửi được. Nhấn Thử lại.',
    genericFailure: 'Đã xảy ra lỗi',
    boundaryTitle: 'Giao diện gặp lỗi',
    boundaryDesc: 'Màn hình gặp lỗi ngoài dự kiến. Cuộc trò chuyện và cài đặt của bạn vẫn an toàn.',
    reloadWindow: 'Tải lại cửa sổ',
    openLogs: 'Mở nhật ký'
  },

  ui: {
    search: {
      clear: 'Xóa tìm kiếm'
    },
    pagination: {
      label: 'phân trang',
      previous: 'Trước',
      previousAria: 'Đến trang trước',
      next: 'Tiếp',
      nextAria: 'Đến trang tiếp theo'
    },
    sidebar: {
      title: 'Thanh bên',
      description: 'Hiển thị thanh bên trên màn hình nhỏ.',
      toggle: 'Bật/tắt thanh bên'
    }
  }
})
