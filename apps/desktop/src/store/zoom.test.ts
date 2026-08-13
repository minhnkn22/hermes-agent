import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $zoomPercent,
  normalizeTextSizeSliderPercent,
  setZoomPercent,
  TEXT_SIZE_MAX_PERCENT,
  TEXT_SIZE_MIN_PERCENT
} from './zoom'

const setPercent = vi.fn()

beforeEach(() => {
  setPercent.mockClear()
  $zoomPercent.set(100)
  window.hermesDesktop = { ...window.hermesDesktop, zoom: { get: vi.fn(), onChanged: vi.fn(), setPercent } }
})

describe('text size zoom', () => {
  it('clamps invalid and out-of-range percentages to the consumer control range', () => {
    expect(normalizeTextSizeSliderPercent(Number.NaN)).toBe(100)
    expect(normalizeTextSizeSliderPercent(20)).toBe(TEXT_SIZE_MIN_PERCENT)
    expect(normalizeTextSizeSliderPercent(300)).toBe(TEXT_SIZE_MAX_PERCENT)
  })

  it('updates renderer state immediately and forwards the normalized value', () => {
    setZoomPercent(112.6)

    expect($zoomPercent.get()).toBe(112.6)
    expect(setPercent).toHaveBeenCalledWith(112.6)
  })
})
