import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    refreshAtumStatus: vi.fn(),
    signInToAtum: vi.fn(),
    signInToAtumWithPassword: vi.fn(),
    signOutOfAtum: vi.fn()
  }
})

const { $atumAccountStatus, $atumSortedRoster } = await import('@/store/atum-messaging')
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

const writableRoster = $atumSortedRoster as unknown as {
  set(next: Array<Record<string, unknown>>): void
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
  // No cwd and no preview: the Assistant still exposes Atum's file browser,
  // whose own empty state explains that no folder is open yet.
  $currentCwd.set('')
  $atumAccountStatus.set(signedIn)
  writableRoster.set([])
})

describe('AtumShellRoot — signed in', () => {
  it('renders the rim first: full-width band with the workspace control', () => {
    const { container } = renderShell()

    const rim = container.querySelector('[data-atum-rim]')

    expect(rim).toBeTruthy()
    // The rim is the shell's first child, above the plate row.
    expect(rim!.parentElement!.firstElementChild).toBe(rim)
    expect(rim!.querySelectorAll('button')).toHaveLength(1)
    expect(rim!.querySelector('[aria-label="Open workspace"]')).toBeTruthy()
    // The rim names the foreground conversation, not a Hermes noun.
    expect(rim!.textContent).toContain('Atum')
  })

  it('never carries Hermes chrome in the rim — no session/profile/project/pin/split/model/approval surfaces', () => {
    const { container } = renderShell()

    const rim = container.querySelector('[data-atum-rim]')!

    expect(rim.querySelector('[data-slot="titlebar"]')).toBeNull()
    expect(rim.querySelector('[data-pane-tree]')).toBeNull()

    const tagged = Array.from(rim.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid') ?? '')

    for (const id of tagged) {
      expect(id.toLowerCase()).not.toMatch(
        /session|profile|project|worktree|model|approval|context-usage|gateway|pin|split/u
      )
    }

    // Exactly the conversation title plus the sanctioned control — nothing else
    // interactive may sneak back in.
    expect(rim.querySelectorAll('button, [role="button"]')).toHaveLength(1)
  })

  it('renders exactly one rail with account, chat, devices, and settings', () => {
    renderShell()

    const rails = globalThis.document.querySelectorAll('nav')
    const rail = screen.getByRole('navigation', { name: 'Main navigation' })
    const buttons = rail.querySelectorAll('button')

    expect(rails).toHaveLength(1)
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
    expect(globalThis.document.body.textContent).not.toMatch(/pair|paired|ghép đôi/iu)
  })

  it('renders no statusbar and no pane tree', () => {
    const { container } = renderShell()

    expect(container.querySelector('[data-slot="statusbar"]')).toBeNull()
    expect(container.querySelector('[data-pane-tree]')).toBeNull()
  })

  it('uses the single thin rim as the only conversation header', () => {
    const { container } = renderShell()

    expect(container.querySelectorAll('[data-atum-rim]')).toHaveLength(1)
    expect(container.querySelector('.atum-chat-header')).toBeNull()
  })

  it('keeps the Assistant workspace toggle functional before a cwd exists', () => {
    const { container } = renderShell()

    const rim = container.querySelector('[data-atum-rim]')!
    const toggle = rim.querySelector('[aria-label="Open workspace"]')!

    expect(toggle.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(toggle)
    expect($workspaceOpen.get()).toBe(true)
  })

  it('uses the shared presentation adapter for a DM title instead of exposing an opaque id', () => {
    writableRoster.set([
      {
        id: 'conversation-1',
        title: null,
        kind: 'direct',
        participantIds: ['9ae6e579-671e-4d35-bdb8-390002bd6217'],
        updatedAt: '2026-08-13T00:00:00.000Z',
        lastMessageAt: null,
        unreadCount: 0,
        payload: {}
      }
    ])

    const { container } = renderShell('/dm/conversation-1')
    const rim = container.querySelector('[data-atum-rim]')!

    expect(rim.textContent).toContain('Conversation')
    expect(rim.textContent).not.toContain('9ae6e579')
  })

  it('does not stack a second conversation header inside the chat plate', () => {
    const { container } = renderShell()

    expect(container.querySelectorAll('.atum-chat-header')).toHaveLength(0)
  })

  it('does not open the workspace when a preview target arrives in the background', () => {
    renderShell()

    expect($workspaceOpen.get()).toBe(false)
    $previewTarget.set({ url: 'http://localhost:3000', kind: 'url' } as never)
    expect($workspaceOpen.get()).toBe(false)
    expect(screen.queryByRole('complementary', { name: 'Workspace' })).toBeNull()
  })
})

describe('AtumShellRoot — auth gate', () => {
  it.each(['signed_out', 'signing_in', 'expired', 'error'] as const)(
    'replaces the entire shell when the account is %s',
    state => {
      $atumAccountStatus.set({ ...signedIn, account: null, state })
      renderShell()

      // The inline-sidebar-form regression cannot come back silently: with the
      // gate up there is no rail, no roster, and no chat plate in the DOM at all.
      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
      expect(globalThis.document.querySelector('.atum-plate-chat')).toBeNull()
      expect(globalThis.document.querySelector('[data-atum-roster]')).toBeNull()
      expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    }
  )

  it('keeps the product shell mounted while a signed-in session refreshes', () => {
    $atumAccountStatus.set({ ...signedIn, state: 'refreshing' })
    renderShell()

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
  })

  it('uses the generic account glyph when no account identity exists', () => {
    $atumAccountStatus.set({ ...signedIn, configured: false, account: null, state: 'unconfigured' })
    const { container } = renderShell()

    const accountButton = screen.getByRole('button', { name: 'Account' })

    expect(accountButton.textContent).not.toContain('A')
    expect(container.querySelector('.codicon-account')).toBeTruthy()
  })

  it('does NOT gate an unconfigured build — the app still works without hosted DMs', () => {
    $atumAccountStatus.set({ ...signedIn, configured: false, account: null, state: 'unconfigured' })
    renderShell()

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
  })
})
