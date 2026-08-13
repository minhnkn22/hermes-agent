import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AtumAccountStatus } from '@/lib/atum-account-client'

vi.mock('@/store/atum-messaging', async () => {
  const { atom } = await import('nanostores')

  return {
    $atumAccountStatus: atom<AtumAccountStatus>({
      state: 'signed_in',
      configured: true,
      account: { id: 'account-1', displayName: 'Minh Nguyen', handle: 'minh' },
      errorCode: null,
      providers: { google: true, password: true }
    }),
    signOutOfAtum: vi.fn()
  }
})

const { AtumAccountDialog } = await import('./account-menu')

afterEach(cleanup)

describe('AtumAccountDialog', () => {
  it('shows only identity fields the native account contract actually provides', () => {
    render(
      <AtumAccountDialog>
        <button type="button">Account</button>
      </AtumAccountDialog>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))

    expect(screen.getByRole('dialog', { name: 'Your account' })).toBeTruthy()
    expect(screen.getByText('Minh Nguyen')).toBeTruthy()
    expect(screen.getByText('minh')).toBeTruthy()
    expect(screen.getByText('account-1')).toBeTruthy()
    expect(screen.getAllByText('Not available')).toHaveLength(2)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })
})
