import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $zoomPercent } from '@/store/zoom'

const setPercent = vi.fn()

beforeEach(() => {
  setPercent.mockClear()
  $zoomPercent.set(100)
  window.hermesDesktop = { ...window.hermesDesktop, zoom: { get: vi.fn(), onChanged: vi.fn(), setPercent } }
})

afterEach(cleanup)

const { AtumConsumerSettings } = await import('./atum-consumer-settings')

describe('AtumConsumerSettings', () => {
  it('shows only the everyday language, appearance and text-size controls', () => {
    render(<AtumConsumerSettings />)

    expect(screen.getByText('Language')).toBeTruthy()
    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.getByText('Text size')).toBeTruthy()
    expect(screen.queryByText('Gateway')).toBeNull()
    expect(screen.queryByText('API keys')).toBeNull()
  })

  it('updates the persistent native zoom bridge from the text-size slider', () => {
    render(<AtumConsumerSettings />)

    fireEvent.change(screen.getByRole('slider', { name: 'Text size' }), { target: { value: '110' } })

    expect(setPercent).toHaveBeenCalledWith(110)
    expect(screen.getByText('110%')).toBeTruthy()
  })

  it('shows the bounded consumer size when Advanced previously set a larger zoom', () => {
    $zoomPercent.set(150)

    render(<AtumConsumerSettings />)

    expect((screen.getByRole('slider', { name: 'Text size' }) as HTMLInputElement).value).toBe('110')
    expect(screen.getByText('110%')).toBeTruthy()
    expect(screen.queryByText('150%')).toBeNull()
  })
})
