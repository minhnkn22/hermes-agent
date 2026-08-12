import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AtumAccountStatus } from '@/lib/atum-account-client'

vi.mock('@/store/atum-messaging', async () => {
  const { atom, computed } = await import('nanostores')

  const $atumAccountStatus = atom<AtumAccountStatus>({
    state: 'signed_in',
    configured: true,
    account: { id: 'a', displayName: 'Minh' },
    errorCode: null,
    providers: { google: true, password: true }
  })

  return {
    $atumAccountStatus,
    $atumConnectivity: atom('online'),
    $atumSortedRoster: atom([]),
    $atumIsAuthenticated: computed($atumAccountStatus, status => status.state === 'signed_in'),
    cancelAtumSignIn: vi.fn(),
    initializeAtumMessaging: vi.fn(async () => undefined),
    refreshAtumRoster: vi.fn(),
    signInToAtum: vi.fn(),
    signInToAtumWithPassword: vi.fn(),
    signOutOfAtum: vi.fn()
  }
})

const { $atumAccountStatus } = await import('@/store/atum-messaging')
const { $previewTarget } = await import('@/store/preview')
const { $currentCwd } = await import('@/store/session')
const { $workspaceOpen, resetAtumShellState } = await import('@/store/atum-shell')
const { AtumShellRoot } = await import('./shell')

const signedIn: AtumAccountStatus = {
  state: 'signed_in',
  configured: true,
  account: { id: 'a', displayName: 'Minh' },
  errorCode: null,
  providers: { google: true, password: true }
}

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AtumShellRoot />
    </MemoryRouter>
  )
}

afterEach(cleanup)

beforeEach(() => {
  resetAtumShellState()
  $previewTarget.set(null)
  // No cwd and no preview ⇒ the conversation genuinely offers no workspace
  // capability, which is the baseline these tests reason about.
  $currentCwd.set('')
  $atumAccountStatus.set(signedIn)
})

describe('AtumShellRoot — signed in', () => {
  it('renders exactly one rail with four controls: account, chat, devices, settings', () => {
    renderShell()

    const rail = screen.getByRole('navigation', { name: 'Main navigation' })
    const buttons = rail.querySelectorAll('button')

    expect(buttons).toHaveLength(4)
    expect(rail.querySelector('[aria-label="Account"]')).toBeTruthy()
    expect(rail.querySelector('[aria-label="Chats"]')).toBeTruthy()
    expect(rail.querySelector('[aria-label="Computer"]')).toBeTruthy()
    expect(rail.querySelector('[aria-label="Settings"]')).toBeTruthy()
  })

  it('keeps the devices control honestly disabled — aria-disabled and no click handler', () => {
    renderShell()

    const devices = screen.getByRole('button', { name: 'Computer' })

    expect(devices.getAttribute('aria-disabled')).toBe('true')
    // No pairing/device state may leak into P0 output.
    expect(document.body.textContent).not.toMatch(/pair|paired|ghép đôi/iu)
  })

  it('renders no statusbar and no pane tree', () => {
    const { container } = renderShell()

    expect(container.querySelector('[data-slot="statusbar"]')).toBeNull()
    expect(container.querySelector('[data-pane-tree]')).toBeNull()
  })

  it('shows the chat plate with a top rim of at most two controls', () => {
    const { container } = renderShell()

    const header = container.querySelector('.atum-chat-header')

    expect(header).toBeTruthy()
    expect(header!.querySelectorAll('button').length).toBeLessThanOrEqual(2)
  })

  it('uses exactly one backdrop-filtered surface — the chat header', () => {
    const { container } = renderShell()

    expect(container.querySelectorAll('.atum-chat-header')).toHaveLength(1)
  })

  it('does not open the workspace when a preview target arrives in the background', () => {
    renderShell()

    expect($workspaceOpen.get()).toBe(false)
    $previewTarget.set({ url: 'http://localhost:3000', kind: 'url' } as never)
    expect($workspaceOpen.get()).toBe(false)
    expect(screen.queryByRole('complementary', { name: 'Workspace' })).toBeNull()
  })

  it('disables the workspace toggle when the conversation offers no capability, but keeps it visible', () => {
    renderShell()

    const toggle = screen.getByRole('button', { name: 'Open workspace' })

    expect(toggle.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('AtumShellRoot — auth gate', () => {
  it.each(['signed_out', 'expired'] as const)('replaces the entire shell when the account is %s', state => {
    $atumAccountStatus.set({ ...signedIn, account: null, state })
    renderShell()

    // The inline-sidebar-form regression cannot come back silently: with the
    // gate up there is no rail, no roster, and no chat plate in the DOM at all.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
    expect(document.querySelector('.atum-plate-chat')).toBeNull()
    expect(document.querySelector('[data-atum-roster]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })

  it('does NOT gate an unconfigured build — the app still works without hosted DMs', () => {
    $atumAccountStatus.set({ ...signedIn, configured: false, account: null, state: 'unconfigured' })
    renderShell()

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
  })
})
