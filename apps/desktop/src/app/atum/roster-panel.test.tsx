import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom, computed } from 'nanostores'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AtumAccountStatus } from '@/lib/atum-account-client'
import type { AtumMessagingConversation } from '@/lib/atum-messaging-client'

const $atumAccountStatus = atom<AtumAccountStatus>({
  state: 'signed_in',
  configured: true,
  account: { id: 'a', displayName: 'Minh' },
  errorCode: null,
  providers: { google: true, password: true }
})
const $atumConnectivity = atom('online')
const $atumSortedRoster = atom<AtumMessagingConversation[]>([])
const refreshAtumRoster = vi.fn()
const refreshAtumStatus = vi.fn()

vi.mock('@/store/atum-messaging', async () => ({
  $atumAccountStatus,
  $atumConnectivity,
  $atumSortedRoster,
  $atumIsAuthenticated: computed($atumAccountStatus, status => status.state === 'signed_in'),
  refreshAtumRoster,
  refreshAtumStatus
}))

const { resetAtumShellState } = await import('@/store/atum-shell')
const { AtumRosterPanel } = await import('./roster-panel')

const conversation = (overrides: Partial<AtumMessagingConversation> = {}): AtumMessagingConversation => ({
  id: 'c1',
  title: 'moon',
  kind: 'specialist',
  participantIds: ['moon'],
  updatedAt: '2026-08-12T00:00:00.000Z',
  lastMessageAt: '2026-08-12T00:00:00.000Z',
  unreadCount: 0,
  payload: {},
  ...overrides
})

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function renderPanel(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AtumRosterPanel />
      <LocationProbe />
    </MemoryRouter>
  )
}

afterEach(cleanup)

beforeEach(() => {
  resetAtumShellState()
  refreshAtumRoster.mockClear()
  refreshAtumStatus.mockClear()
  $atumConnectivity.set('online')
  $atumSortedRoster.set([])
  $atumAccountStatus.set({
    state: 'signed_in',
    configured: true,
    account: { id: 'a', displayName: 'Minh' },
    errorCode: null,
    providers: { google: true, password: true }
  })
})

describe('AtumRosterPanel — directory shape', () => {
  it('renders Atum, app, and person groups in product order', () => {
    $atumSortedRoster.set([
      conversation({ id: 'c1', title: 'moon' }),
      conversation({ id: 'c2', title: 'andy', participantIds: ['andy'] }),
      conversation({ id: 'c3', title: 'Lan', kind: 'direct', participantIds: ['lan'] })
    ])
    const { container } = renderPanel()

    expect(container.querySelectorAll('[data-roster-row]')).toHaveLength(4)
    expect(screen.getAllByText('Atum')).toHaveLength(2)
    expect(screen.getByText('Apps')).toBeTruthy()
    expect(screen.getByText('People')).toBeTruthy()
    // Hosted lowercase ids render as proper display names.
    expect(screen.getByText('Moon')).toBeTruthy()
    expect(screen.getByText('Andy')).toBeTruthy()
    expect(screen.getByText('Lan')).toBeTruthy()
  })

  it('keeps search visible and useful: plain query narrows, unaccented query matches diacritics', () => {
    $atumSortedRoster.set([
      conversation({ id: 'c1', title: 'moon' }),
      conversation({ id: 'c2', title: 'Trò chuyện nhóm', participantIds: ['andy'] })
    ])
    const { container } = renderPanel()

    const search = screen.getByRole('textbox', { name: 'Search chats' })

    fireEvent.change(search, { target: { value: 'moon' } })
    expect(container.querySelectorAll('[data-roster-row]')).toHaveLength(1)

    fireEvent.change(search, { target: { value: 'tro chuyen' } })
    expect(container.querySelectorAll('[data-roster-row]')).toHaveLength(1)
    expect(screen.getByText('Trò chuyện nhóm')).toBeTruthy()
  })

  it('shows the unread pill instead of the timestamp, and presence only when reported', () => {
    $atumSortedRoster.set([
      conversation({ id: 'c1', title: 'moon', unreadCount: 2, payload: { presence: 'online' } }),
      conversation({ id: 'c2', title: 'andy', participantIds: ['andy'] })
    ])
    const { container } = renderPanel()

    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Moon, 2 unread' })).toBeTruthy()
    // Exactly one presence dot — the row whose payload reports it.
    const rows = container.querySelectorAll('[data-roster-row]')
    expect(rows[1]!.querySelectorAll('[aria-hidden="true"].size-\\[9px\\]')).toHaveLength(1)
    expect(rows[2]!.querySelector('.size-\\[9px\\]')).toBeNull()
  })
})

describe('AtumRosterPanel — honest specialists states', () => {
  it('signed out: one assistant row plus an explainer whose action navigates to the auth route', () => {
    $atumAccountStatus.set({
      state: 'unconfigured',
      configured: false,
      account: null,
      errorCode: null,
      providers: { google: false, password: false }
    })
    const { container } = renderPanel()

    expect(container.querySelectorAll('[data-roster-row]')).toHaveLength(1)
    const group = container.querySelector('[data-roster-state="hosted"]')!
    expect(group).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByTestId('location').textContent).toBe('/sign-in')
  })

  it('loading: skeletons stand in for the first sync, never an empty void', () => {
    $atumConnectivity.set('loading')
    const { container } = renderPanel()

    // Only the assistant row; the specialists group shows placeholder blocks.
    expect(container.querySelectorAll('[data-roster-row]')).toHaveLength(1)
    expect(container.querySelector('[data-roster-state="hosted"] [aria-hidden="true"]')).toBeTruthy()
  })

  it('error: one line plus a retry that re-fetches status and roster', () => {
    $atumConnectivity.set('error')
    renderPanel()

    expect(screen.getByText("Couldn't load your chats")).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refreshAtumStatus).toHaveBeenCalledTimes(1)
    expect(refreshAtumRoster).toHaveBeenCalledTimes(1)
  })

  it('signed in with zero hosted chats: a single quiet line, not empty headings', () => {
    renderPanel()

    expect(screen.getByText('No other conversations yet')).toBeTruthy()
    expect(screen.getAllByText('Atum')).toHaveLength(2)
    expect(screen.queryByText('Apps')).toBeNull()
    expect(screen.queryByText('People')).toBeNull()
  })
})
