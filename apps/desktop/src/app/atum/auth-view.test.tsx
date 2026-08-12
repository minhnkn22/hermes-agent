import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AtumAccountStatus } from '@/lib/atum-account-client'

vi.mock('@/store/atum-messaging', async () => {
  const { atom } = await import('nanostores')

  return {
    $atumAccountStatus: atom<AtumAccountStatus>({
      state: 'signed_out',
      configured: true,
      account: null,
      errorCode: null,
      providers: { google: true, password: true }
    }),
    cancelAtumSignIn: vi.fn(),
    signInToAtum: vi.fn(),
    signInToAtumWithPassword: vi.fn()
  }
})

const { $atumAccountStatus, cancelAtumSignIn, signInToAtum } = await import('@/store/atum-messaging')
const { AtumAuthView } = await import('./auth-view')

const signedOut: AtumAccountStatus = {
  state: 'signed_out',
  configured: true,
  account: null,
  errorCode: null,
  providers: { google: true, password: true }
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  $atumAccountStatus.set(signedOut)
})

describe('AtumAuthView', () => {
  it('is a full-window gate: no rail, no roster, no chat behind it', () => {
    const { container } = render(<AtumAuthView />)

    expect(container.querySelector('nav[aria-label]')).toBeNull()
    expect(container.querySelector('[data-atum-roster]')).toBeNull()
    expect(container.querySelector('.atum-plate-chat')).toBeNull()
  })

  it('focuses the identifier on mount so typing works immediately', () => {
    render(<AtumAuthView />)

    expect(globalThis.document.activeElement).toBe(screen.getByRole('textbox', { name: /Username/ }))
  })

  it('focuses the heading only when there is no editable credential field', () => {
    $atumAccountStatus.set({ ...signedOut, providers: { google: true, password: false } })
    render(<AtumAuthView />)

    expect(globalThis.document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('offers Google first, then the identifier/password fallback', () => {
    render(<AtumAuthView />)

    const google = screen.getByRole('button', { name: 'Continue with Google' })
    const identifier = screen.getByRole('textbox', { name: /Username/ })

    expect(google.compareDocumentPosition(identifier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('or')).toBeTruthy()
  })

  it('hides Google truthfully when provider status says it is unavailable', () => {
    $atumAccountStatus.set({ ...signedOut, providers: { google: false, password: true } })
    render(<AtumAuthView />)

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
    expect(screen.getByRole('textbox', { name: /Username/ })).toBeTruthy()
  })

  it('says so plainly when no provider is available at all', () => {
    $atumAccountStatus.set({ ...signedOut, providers: { google: false, password: false } })
    render(<AtumAuthView />)

    expect(screen.getByText("Sign-in isn't available in this build.")).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('runs the real Google sign-in action', () => {
    render(<AtumAuthView />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(signInToAtum).toHaveBeenCalledOnce()
  })

  it('shows a truthful progress label and a cancel affordance while signing in', () => {
    $atumAccountStatus.set({ ...signedOut, state: 'signing_in' })
    render(<AtumAuthView />)

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Signing in…' }).hasAttribute('disabled')).toBe(true)
  })

  it('cancels an in-flight sign-in on Escape and does nothing else', () => {
    $atumAccountStatus.set({ ...signedOut, state: 'signing_in' })
    const { container } = render(<AtumAuthView />)

    fireEvent.keyDown(container.firstChild!, { key: 'Escape' })
    expect(cancelAtumSignIn).toHaveBeenCalledOnce()
  })

  it('does not treat Escape as a dismissal when idle — the gate is not dismissable', () => {
    const { container } = render(<AtumAuthView />)

    fireEvent.keyDown(container.firstChild!, { key: 'Escape' })
    expect(cancelAtumSignIn).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })

  it.each([
    ['password_sign_in_rejected:400', 'Incorrect username or password.'],
    ['password_sign_in_timeout', "Can't connect. Check your network and try again."],
    ['provider_not_configured', 'Sign-in is temporarily unavailable. Try again in a few minutes.']
  ])('maps %s to its own copy and focuses the alert', (errorCode, expected) => {
    $atumAccountStatus.set({ ...signedOut, state: 'error', errorCode })
    render(<AtumAuthView />)

    const alert = screen.getByRole('alert')

    expect(alert.textContent).toBe(expected)
    expect(globalThis.document.activeElement).toBe(alert)
  })

  it('switches to the expired story without losing the user work', () => {
    $atumAccountStatus.set({ ...signedOut, state: 'expired' })
    render(<AtumAuthView />)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in again to continue')
    expect(screen.getByText('Your session expired. Your chats are still here.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy()
  })
})
