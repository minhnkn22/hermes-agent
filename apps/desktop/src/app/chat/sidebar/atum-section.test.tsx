import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { $atumAccountStatus } from '@/store/atum-messaging'

vi.mock('@/store/atum-messaging', async () => {
  const { atom } = await import('nanostores')

  return {
    $atumAccountStatus: atom({
      state: 'signed_in',
      configured: true,
      account: { id: 'a', displayName: 'Minh' },
      errorCode: null,
      providers: { google: true, password: true }
    }),
    $atumConnectivity: atom('online'),
    $atumSortedRoster: atom([
      {
        id: 'conversation-1',
        title: 'Moon',
        kind: 'direct',
        participantIds: ['moon'],
        updatedAt: '2026-08-12T00:00:00.000Z',
        lastMessageAt: '2026-08-12T00:00:00.000Z',
        unreadCount: 2,
        payload: { preview: 'Chào Minh' }
      }
    ]),
    cancelAtumSignIn: vi.fn(),
    initializeAtumMessaging: vi.fn(),
    refreshAtumRoster: vi.fn(),
    signInToAtum: vi.fn(),
    signInToAtumWithPassword: vi.fn(),
    signOutOfAtum: vi.fn()
  }
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      dm: {
        sectionTitle: 'Tin nhắn',
        offline: 'Ngoại tuyến',
        reconnecting: 'Đang kết nối lại...',
        authExpired: 'Hết phiên đăng nhập',
        errorGeneric: 'Lỗi kết nối',
        unavailable: 'Chưa cấu hình',
        notSignedIn: 'Chưa đăng nhập',
        cancelSignIn: 'Hủy',
        authExpiredAction: 'Đăng nhập lại',
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
        signedInAs: (name: string) => `Đã đăng nhập: ${name}`,
        signOut: 'Đăng xuất',
        unreadCount: (count: number) => `${count} tin chưa đọc`,
        noConversations: 'Chưa có cuộc trò chuyện'
      }
    }
  })
}))

import { AtumSection } from './atum-section'

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

afterEach(cleanup)

beforeEach(() => {
  $atumAccountStatus.set({
    state: 'signed_in',
    configured: true,
    account: { id: 'a', displayName: 'Minh' },
    errorCode: null,
    providers: { google: true, password: true }
  })
})

describe('AtumSection', () => {
  it('renders roster/unread state and highlights the routed conversation', () => {
    render(
      <MemoryRouter initialEntries={['/dm/conversation-1']}>
        <SidebarProvider>
          <AtumSection />
        </SidebarProvider>
      </MemoryRouter>
    )
    expect(screen.getByText('Tin nhắn')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Moon, 2 tin chưa đọc' }).getAttribute('aria-current')).toBe('page')
  })

  it('navigates within the existing router instead of opening a second mode', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarProvider>
          <Routes>
            <Route
              element={
                <>
                  <AtumSection />
                  <LocationProbe />
                </>
              }
              path="*"
            />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Moon, 2 tin chưa đọc' }))
    expect(screen.getByTestId('location').textContent).toBe('/dm/conversation-1')
  })

  it('shows Google first, then the identifier/password fallback when both providers are configured', () => {
    $atumAccountStatus.set({
      state: 'signed_out',
      configured: true,
      account: null,
      errorCode: null,
      providers: { google: true, password: true }
    })
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AtumSection />
        </SidebarProvider>
      </MemoryRouter>
    )

    const google = screen.getByRole('button', { name: 'Tiếp tục với Google' })
    const identifier = screen.getByRole('textbox', { name: /Tên đăng nhập/ })
    expect(google.compareDocumentPosition(identifier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('hoặc')).toBeTruthy()
  })

  it('hides Google truthfully when native provider status says it is unavailable', () => {
    $atumAccountStatus.set({
      state: 'signed_out',
      configured: true,
      account: null,
      errorCode: null,
      providers: { google: false, password: true }
    })
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AtumSection />
        </SidebarProvider>
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'Tiếp tục với Google' })).toBeNull()
    expect(screen.getByRole('textbox', { name: /Tên đăng nhập/ })).toBeTruthy()
  })

  it('offers cancel and a truthful progress label during Google sign-in', () => {
    $atumAccountStatus.set({
      state: 'signing_in',
      configured: true,
      account: null,
      errorCode: null,
      providers: { google: true, password: true }
    })
    render(
      <MemoryRouter>
        <SidebarProvider>
          <AtumSection />
        </SidebarProvider>
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeTruthy()
  })

  it('maps credential, network, and provider failures to distinct copy', () => {
    const { rerender } = render(
      <MemoryRouter>
        <SidebarProvider>
          <AtumSection />
        </SidebarProvider>
      </MemoryRouter>
    )

    for (const [errorCode, expected] of [
      ['password_sign_in_rejected:400', 'Sai tên đăng nhập hoặc mật khẩu.'],
      ['password_sign_in_timeout', 'Không kết nối được. Kiểm tra mạng rồi thử lại.'],
      ['provider_not_configured', 'Đăng nhập tạm thời không khả dụng. Thử lại sau ít phút.']
    ]) {
      $atumAccountStatus.set({
        state: 'error',
        configured: true,
        account: null,
        errorCode,
        providers: { google: false, password: true }
      })
      rerender(
        <MemoryRouter>
          <SidebarProvider>
            <AtumSection />
          </SidebarProvider>
        </MemoryRouter>
      )
      expect(screen.getByRole('alert').textContent).toBe(expected)
    }
  })
})
