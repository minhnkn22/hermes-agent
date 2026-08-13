import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $atumShellEnabled } from '@/store/atum-shell'

vi.mock('./config-settings', () => ({ ConfigSettings: () => <div>Advanced settings content</div> }))

import { SettingsView } from './index'

afterEach(() => {
  cleanup()
  $atumShellEnabled.set(true)
})

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsView onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('SettingsView — Atum information architecture', () => {
  it('opens on consumer settings and keeps Hermes controls behind Advanced', () => {
    $atumShellEnabled.set(true)
    renderSettings()

    expect(screen.getAllByRole('button', { name: 'General' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Advanced' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Personalize how Atum looks and reads on this computer.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Advanced' })[0]!)

    expect(screen.getAllByRole('button', { name: 'Model' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Providers' }).length).toBeGreaterThan(0)
  })

  it('leaves the legacy Hermes settings navigation unchanged when Atum shell is off', () => {
    $atumShellEnabled.set(false)
    renderSettings()

    expect(screen.getAllByRole('button', { name: 'Model' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull()
  })
})
