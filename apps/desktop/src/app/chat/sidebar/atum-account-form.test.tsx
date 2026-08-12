import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AtumAccountForm } from './atum-account-form'

const copy = {
  identifier: 'Tên người dùng, email hoặc số điện thoại',
  password: 'Mật khẩu',
  signIn: 'Đăng nhập',
  signingIn: 'Đang đăng nhập...'
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

describe('AtumAccountForm', () => {
  it('submits credentials once and clears the password when the request settles', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AtumAccountForm copy={copy} error={null} onSubmit={onSubmit} pending={false} />)

    fireEvent.change(screen.getByRole('textbox', { name: copy.identifier }), { target: { value: ' @minh ' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'one-shot-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ identifier: '@minh', password: 'one-shot-secret' }))
    await waitFor(() => expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe(''))
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('disables every credential control while the native request is pending', () => {
    render(<AtumAccountForm copy={copy} error={null} onSubmit={vi.fn()} pending />)

    expect((screen.getByRole('textbox', { name: copy.identifier }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Đang đăng nhập...' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders a stable accessible error without echoing credentials', () => {
    render(
      <AtumAccountForm
        copy={copy}
        error="Đăng nhập thất bại. Kiểm tra email và mật khẩu."
        onSubmit={vi.fn()}
        pending={false}
      />
    )

    expect(screen.getByRole('alert').textContent).toBe('Đăng nhập thất bại. Kiểm tra email và mật khẩu.')
    expect(screen.queryByText('one-shot-secret')).toBeNull()
  })
})
