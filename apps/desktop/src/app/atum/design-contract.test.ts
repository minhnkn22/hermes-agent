import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// Static-analysis guards for the Atum product shell. These are lint-shaped
// rules expressed as tests so they run with the suite — each one exists because
// breaking it would silently undo a product decision, not because it is a
// style preference.

const ATUM_DIR = resolve(__dirname)

const sources = readdirSync(ATUM_DIR)
  .filter(entry => (entry.endsWith('.tsx') || entry.endsWith('.ts')) && !entry.includes('.test.'))
  .map(entry => [entry, readFileSync(join(ATUM_DIR, entry), 'utf8')] as const)

function stripCommentsAndStrings(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
}

describe('Atum shell — tokens, not literals', () => {
  it.each(sources)('%s uses CSS variables for every colour', (_name, source) => {
    const code = stripCommentsAndStrings(source)

    // Raw hex and ad-hoc rgba() are how a design system rots. Everything here
    // must be a var(--atum-*) / var(--ui-*) or a semantic Tailwind token.
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
    expect(code).not.toMatch(/\brgba?\(/u)
  })
})

describe('Atum shell — every icon-only control carries a tooltip', () => {
  it.each(sources.filter(([name]) => name.endsWith('.tsx')))('%s wraps icon buttons in <Tip>', (_name, source) => {
    const iconButtons = source.match(/size="icon[^"]*"/gu)?.length ?? 0

    if (iconButtons === 0) {
      return
    }

    // One <Tip> per icon-only button, at minimum.
    expect((source.match(/<Tip\b/gu) ?? []).length).toBeGreaterThanOrEqual(iconButtons)
    expect(source).not.toMatch(/\btitle=/u)
  })
})

describe('Atum shell — no Hermes nouns reach the product surface', () => {
  const FORBIDDEN = ['$sessions', '$profiles', '$projects', '$cronSessions', '$pinnedSessionIds', 'LayoutTreeRoot']

  it.each(sources)('%s stays out of the Hermes organisation stores', (_name, source) => {
    const code = stripCommentsAndStrings(source)

    for (const noun of FORBIDDEN) {
      expect(code, `${noun} must not appear in the Atum shell`).not.toContain(noun)
    }
  })
})

describe('Atum shell — the devices control promises nothing', () => {
  it('never renders a pairing affordance or a device name in P0', () => {
    const rail = readFileSync(join(ATUM_DIR, 'rail.tsx'), 'utf8')

    expect(rail).toContain('aria-disabled="true"')
    // The devices button must have no onClick at all — a disabled-looking
    // control that still does something is worse than one that does nothing.
    const devicesBlock = rail.slice(rail.indexOf('devicesSoon'), rail.indexOf('nav.settings'))
    expect(devicesBlock).not.toContain('onClick')

    for (const source of sources) {
      expect(stripCommentsAndStrings(source[1]).toLowerCase()).not.toMatch(/pairing|pairingcode|ghép đôi/u)
    }
  })
})

describe('Atum shell — Hermes chrome stays behind the fallback flag', () => {
  it('does not mount legacy titlebar controls over the Atum product shell', () => {
    const wiring = readFileSync(resolve(ATUM_DIR, '..', 'contrib', 'wiring.tsx'), 'utf8')

    expect(wiring).toMatch(/!atumShellEnabled\s*&&\s*\(\s*<TitlebarControls/u)
  })
})
