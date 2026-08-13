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
  const FORBIDDEN = [
    '$sessions',
    '$profiles',
    '$projects',
    '$cronSessions',
    '$pinnedSessionIds',
    'LayoutTreeRoot',
    // The rim is macOS/Hermes GEOMETRY with Atum contents — the Hermes
    // titlebar surface itself must never be wired back in.
    'WiredPane part="titlebar"'
  ]

  it.each(sources)('%s stays out of the Hermes organisation stores', (_name, source) => {
    const code = stripCommentsAndStrings(source)

    for (const noun of FORBIDDEN) {
      expect(code, `${noun} must not appear in the Atum shell`).not.toContain(noun)
    }
  })
})

describe('Atum shell — the rim carries Atum contents only', () => {
  const rim = readFileSync(join(ATUM_DIR, 'rim.tsx'), 'utf8')
  const styles = readFileSync(resolve(ATUM_DIR, '../../styles.css'), 'utf8')

  it('hosts no Hermes organisation control', () => {
    const code = stripCommentsAndStrings(rim)

    for (const noun of ['session', 'profile', 'project', 'worktree', 'approval', 'gateway', 'context-usage']) {
      expect(code.toLowerCase(), `${noun} must not appear in the rim`).not.toContain(noun)
    }
  })

  it('is a drag region with the sanctioned workspace control', () => {
    expect(rim).toContain('data-atum-rim')
    expect(rim).toContain('[-webkit-app-region:drag]')
    expect(rim).toContain('toggleWorkspace')
    expect(rim).not.toContain('AtumAccountMenu')
  })

  it('is the single 34px conversation band', () => {
    expect(styles).toContain('--atum-rim-h: 34px')
    expect(styles).not.toContain('.atum-chat-header {')
  })
})

describe('Atum conversation surfaces — presentation, never wire data', () => {
  const details = readFileSync(join(ATUM_DIR, 'workspace-panel.tsx'), 'utf8')
  const dm = readFileSync(resolve(ATUM_DIR, '../dm/index.tsx'), 'utf8')

  const dmSources = readdirSync(resolve(ATUM_DIR, '../dm'))
    .filter(entry => entry.endsWith('.tsx') && !entry.includes('.test.'))
    .map(entry => readFileSync(resolve(ATUM_DIR, '../dm', entry), 'utf8'))
    .join('\n')

  it('routes workspace identity through the shared presentation adapter', () => {
    expect(details).toContain('presentAtumConversation(conversation, locale)')
    expect(details).not.toContain("participantIds.join(', ')")
    expect(details).not.toMatch(/conversation\.(?:id|updatedAt|lastMessageAt)\s*\}/u)
  })

  it('does not stack a second DM identity header', () => {
    expect(dm).not.toContain('DmHeader')
    expect(dm).not.toMatch(/<header\b/u)
  })

  it('keeps ambient connectivity out of the transcript plate', () => {
    const chatPanel = readFileSync(join(ATUM_DIR, 'chat-panel.tsx'), 'utf8')

    expect(chatPanel).not.toContain('$atumConnectivity')
    expect(chatPanel).not.toMatch(/role="status"/u)
  })

  it('uses Atum material tokens throughout app and P2P chat', () => {
    expect(dmSources).not.toContain('--ui-')
  })
})

describe('Atum shell — the chat plane is opaque and the composer is Atum-shaped', () => {
  const styles = readFileSync(resolve(ATUM_DIR, '../../styles.css'), 'utf8')
  const chatView = readFileSync(resolve(ATUM_DIR, '../chat/index.tsx'), 'utf8')

  it('never mounts the legacy Hermes image backdrop in the product transcript', () => {
    expect(chatView).not.toContain('@/components/Backdrop')
    expect(chatView).not.toContain('<Backdrop')
  })

  it('paints an opaque Atum chat ground under every chat descendant', () => {
    // Scoped override — the legacy shell keeps its own surface color.
    expect(styles).toMatch(/\.atum-shell\s*\{[^}]*--ui-chat-surface-background:\s*var\(--atum-chat-solid\)/u)
    // Near-fully opaque chat tokens in both ramps: nothing recognizable can
    // leak through the transcript.
    expect(styles).toContain('--atum-chat: rgb(253 252 250 / 96%)')
    expect(styles).toContain('--atum-chat-solid: rgb(252 251 248)')
    expect(styles).toContain('--atum-chat: rgb(38 35 30 / 96%)')
  })

  it('scopes the rounded floating composer to the Atum shell', () => {
    expect(styles).toContain(".atum-shell [data-slot='composer-root']")
    expect(styles).toContain('border-radius: var(--atum-r-composer)')
    expect(styles).toContain('--atum-r-composer: 18px')
    expect(styles).toContain(".atum-shell [data-slot='composer-surface']:focus-within")
    // The Hermes input recess is killed inside Atum only.
    expect(styles).toMatch(/\.atum-shell\s*\{[^}]*--dt-input-inset:\s*none/u)
    // Composer minimum height and the Atum-ground fade.
    expect(styles).toContain('min-height: 44px')
    expect(styles).toContain(".atum-shell [data-slot='composer-root'] > .pointer-events-none")
  })

  it('puts the specular sheen on the TOP edge, in both ramps', () => {
    expect(styles).toContain('--atum-sheen: inset 0 1px 0 color-mix(in srgb, white 62%, transparent)')
    expect(styles).toContain('--atum-sheen: inset 0 1px 0 color-mix(in srgb, white 12%, transparent)')
    expect(styles).not.toContain('--atum-sheen: inset 0.0625rem 0 0')
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
