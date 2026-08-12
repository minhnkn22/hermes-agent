import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { AtumMessagingClient } from '@/lib/atum-messaging-client'
import { resetAtumMessagingState, setAtumDraft } from '@/store/atum-messaging'

import { DmComposer } from './dm-composer'

beforeEach(() => {
  resetAtumMessagingState()
  Object.assign(window, {
    hermesDesktop: {
      messaging: { saveDraft: vi.fn().mockResolvedValue({}) } as unknown as AtumMessagingClient
    }
  })
})

afterEach(cleanup)

function renderComposer(onSend = vi.fn()) {
  return {
    onSend,
    ...render(
      <I18nProvider configClient={null} initialLocale="vi">
        <DmComposer conversationId="conversation-1" disabled={false} onSend={onSend} />
      </I18nProvider>
    )
  }
}

describe('DmComposer', () => {
  it('sends on Enter without inserting a line break', () => {
    const { onSend } = renderComposer()
    const composer = screen.getByRole('textbox', { name: 'Nhắn tin...' })
    fireEvent.change(composer, { target: { value: 'xin chào' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalledWith('xin chào')
  })

  it('keeps Shift+Enter for a newline and does not send', () => {
    const { onSend } = renderComposer()
    const composer = screen.getByRole('textbox', { name: 'Nhắn tin...' })
    fireEvent.change(composer, { target: { value: 'line one' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('restores the conversation draft and persists it on blur', () => {
    setAtumDraft('conversation-1', 'bản nháp')
    renderComposer()
    const composer = screen.getByRole('textbox', { name: 'Nhắn tin...' })
    expect((composer as HTMLTextAreaElement).value).toBe('bản nháp')
    fireEvent.blur(composer)
    expect(window.hermesDesktop.messaging.saveDraft).toHaveBeenCalledWith('conversation-1', { text: 'bản nháp' })
  })

  it('disables the composer for expired/error states supplied by the view', () => {
    render(
      <I18nProvider configClient={null} initialLocale="vi">
        <DmComposer conversationId="conversation-1" disabled />
      </I18nProvider>
    )
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Gửi' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
