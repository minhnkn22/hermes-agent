import { describe, expect, it } from 'vitest'

import { availableWorkspaceTabs, resolveWorkspaceTab } from './workspace-tabs'

describe('availableWorkspaceTabs', () => {
  it('keeps the real Hermes files pane reachable from the local Assistant before a cwd exists', () => {
    expect(availableWorkspaceTabs({ hasPreview: false, isDm: false })).toEqual(['files'])
  })

  it('derives each tab from live capability', () => {
    expect(availableWorkspaceTabs({ hasPreview: true, isDm: true })).toEqual(['view', 'files', 'details'])
    expect(availableWorkspaceTabs({ hasPreview: false, isDm: false })).toEqual(['files'])
    expect(availableWorkspaceTabs({ hasPreview: false, isDm: true })).toEqual(['files', 'details'])
  })
})

describe('resolveWorkspaceTab', () => {
  it('keeps the user choice while it is still available', () => {
    expect(resolveWorkspaceTab('files', ['view', 'files'])).toBe('files')
  })

  it('falls to the first available tab when the choice lapses', () => {
    expect(resolveWorkspaceTab('details', ['view', 'files'])).toBe('view')
  })

  it('keeps files as the defensive default', () => {
    expect(resolveWorkspaceTab('view', [])).toBe('files')
  })
})
