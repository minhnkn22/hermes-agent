import { describe, expect, it } from 'vitest'

import { availableWorkspaceTabs, resolveWorkspaceTab } from './workspace-tabs'

describe('availableWorkspaceTabs', () => {
  it('renders nothing when the conversation has no capability — never a disabled fake', () => {
    expect(availableWorkspaceTabs({ hasCwd: false, hasPreview: false, isDm: false })).toEqual([])
  })

  it('derives each tab from live capability', () => {
    expect(availableWorkspaceTabs({ hasCwd: true, hasPreview: true, isDm: true })).toEqual([
      'view',
      'files',
      'details'
    ])
    expect(availableWorkspaceTabs({ hasCwd: true, hasPreview: false, isDm: false })).toEqual(['files'])
    expect(availableWorkspaceTabs({ hasCwd: false, hasPreview: false, isDm: true })).toEqual(['details'])
  })
})

describe('resolveWorkspaceTab', () => {
  it('keeps the user choice while it is still available', () => {
    expect(resolveWorkspaceTab('files', ['view', 'files'])).toBe('files')
  })

  it('falls to the first available tab when the choice lapses', () => {
    expect(resolveWorkspaceTab('details', ['view', 'files'])).toBe('view')
  })

  it('resolves to null when nothing qualifies', () => {
    expect(resolveWorkspaceTab('view', [])).toBeNull()
  })
})
