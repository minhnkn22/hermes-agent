import { beforeEach, describe, expect, it } from 'vitest'

import {
  $workspaceTab,
  $workspaceWidth,
  ATUM_WORKSPACE_DEFAULT_WIDTH,
  ATUM_WORKSPACE_INLINE_RESERVE,
  ATUM_WORKSPACE_MAX_WIDTH,
  ATUM_WORKSPACE_MIN_WIDTH,
  clampWorkspaceWidth,
  resetAtumShellState,
  setWorkspaceTab,
  setWorkspaceWidth
} from './atum-shell'

beforeEach(resetAtumShellState)

describe('clampWorkspaceWidth', () => {
  it('holds the requested width when the viewport can host it', () => {
    expect(clampWorkspaceWidth(420, 1440)).toBe(420)
  })

  it('clamps to the documented bounds', () => {
    expect(clampWorkspaceWidth(100, 1920)).toBe(ATUM_WORKSPACE_MIN_WIDTH)
    expect(clampWorkspaceWidth(9000, 1920)).toBe(ATUM_WORKSPACE_MAX_WIDTH)
  })

  it('clamps to what the viewport actually leaves once the rail, roster and chat minimum are reserved', () => {
    const viewport = ATUM_WORKSPACE_INLINE_RESERVE + 400

    expect(clampWorkspaceWidth(640, viewport)).toBe(400)
  })

  it('returns 0 when no inline workspace fits, so callers present a drawer instead of a sliver', () => {
    expect(clampWorkspaceWidth(400, ATUM_WORKSPACE_INLINE_RESERVE + 100)).toBe(0)
  })

  it('falls back to the default for a non-finite width', () => {
    expect(clampWorkspaceWidth(Number.NaN, 1440)).toBe(ATUM_WORKSPACE_DEFAULT_WIDTH)
  })
})

describe('workspace width persistence', () => {
  it('stores the user intent clamped only by the absolute bounds', () => {
    setWorkspaceWidth(9000)
    expect($workspaceWidth.get()).toBe(ATUM_WORKSPACE_MAX_WIDTH)

    setWorkspaceWidth(10)
    expect($workspaceWidth.get()).toBe(ATUM_WORKSPACE_MIN_WIDTH)
  })

  it('writes through to localStorage so a relaunch restores the same width', () => {
    setWorkspaceWidth(512)
    expect(localStorage.getItem('hermes.desktop.atum.workspaceWidth')).toBe('512')
  })
})

describe('workspace tab', () => {
  it('persists a valid tab', () => {
    setWorkspaceTab('files')
    expect($workspaceTab.get()).toBe('files')
    expect(localStorage.getItem('hermes.desktop.atum.workspaceTab')).toBe('files')
  })
})
