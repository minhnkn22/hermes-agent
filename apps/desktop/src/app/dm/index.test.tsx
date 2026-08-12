import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

vi.mock('@/store/atum-messaging', () => ({
  $atumAccountStatus: atom({
    state: 'expired',
    configured: true,
    account: { id: 'account-a' },
    errorCode: 'account_session_expired',
    providers: { google: false, password: true }
  }),
  $atumActiveMessages: atom([]),
  $atumConnectivity: atom('auth_expired'),
  $atumDrafts: atom({}),
  $atumRoster: atom([]),
  $atumStatus: atom({
    accountId: 'account-a',
    connectivity: 'auth_expired',
    synchronized: false,
    cursor: 'cursor-a',
    lastSuccessfulSyncAt: null,
    nextRetryAt: null,
    errorCode: 'account_session_expired'
  }),
  initializeAtumMessaging: vi.fn(),
  persistAtumDraft: vi.fn().mockResolvedValue(true),
  refreshAtumStatus: vi.fn(),
  retryAtumMessage: vi.fn(),
  sendAtumMessage: vi.fn(),
  setAtumActiveConversation: vi.fn(),
  setAtumDraft: vi.fn(),
  signInToAtum: vi.fn()
}))

import { $atumAccountStatus, signInToAtum } from '@/store/atum-messaging'

import { AtumDmView, canComposeAtum } from './index'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderView() {
  return render(
    <I18nProvider configClient={null} initialLocale="vi">
      <MemoryRouter initialEntries={['/dm/conversation-1']}>
        <input aria-label="Account identifier" id="atum-identifier" />
        <Routes>
          <Route element={<AtumDmView />} path="/dm/:conversationId" />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

describe('AtumDmView auth recovery', () => {
  it('treats a refreshing same-account session as compose-capable', () => {
    expect(canComposeAtum('refreshing', 'online')).toBe(true)
    expect(canComposeAtum('refreshing', 'offline_cached')).toBe(true)
    expect(canComposeAtum('refreshing', 'reconnecting')).toBe(true)
    expect(canComposeAtum('refreshing', 'auth_expired')).toBe(false)
  })

  it('focuses password reauthentication when Google is unavailable', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập lại' }))
    expect(globalThis.document.activeElement).toBe(screen.getByRole('textbox', { name: 'Account identifier' }))
    expect(signInToAtum).not.toHaveBeenCalled()
  })

  it('starts Google reauthentication when that provider is available', () => {
    $atumAccountStatus.set({
      state: 'expired',
      configured: true,
      account: { id: 'account-a' },
      errorCode: 'account_session_expired',
      providers: { google: true, password: true }
    })
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập lại' }))
    expect(signInToAtum).toHaveBeenCalledOnce()
  })
})
