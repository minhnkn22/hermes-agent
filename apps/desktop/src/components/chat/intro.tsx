import { type CSSProperties, useState } from 'react'

import { useStore } from '@nanostores/react'

import { requestComposerInsert } from '@/app/chat/composer/focus'
import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/i18n'
import { capitalize, normalize } from '@/lib/text'
import { $atumShellEnabled } from '@/store/atum-shell'

import introCopyJsonl from './intro-copy.jsonl?raw'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: 'What should Hermes look at?',
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

function normalizeKey(value?: string): string {
  return normalize(value)
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} Hermes need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} Hermes tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

function resolveCopy(personality?: string, seed?: number): IntroCopy {
  const personalityKey = normalizeKey(personality)

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)

  return pickCopy(copies, seed)
}

export function Intro({ personality, seed }: IntroProps) {
  const { t } = useI18n()
  const atumShell = useStore($atumShellEnabled)
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const copy = resolveCopy(personality, mountSeed + (seed ?? 0))
  const wordmark = t.intro.heading || 'ATUM'
  const body = t.intro.body || copy.body

  // The Atum product shell gets its own branded empty state: brand mark,
  // headline, body, and starter chips that drop a real prompt into the
  // composer. No Nous/Hermes art, no portrait, no fit-text wordmark.
  if (atumShell) {
    return (
      <div
        className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center sm:px-6 lg:px-8"
        data-atum-empty
        data-slot="aui_intro"
      >
        <div className="flex w-full max-w-[420px] min-w-0 flex-col items-center">
          <BrandMark className="size-11 rounded-[12px] opacity-90" />
          <p className="mt-2.5 mb-1.5 text-[15px] font-semibold tracking-[-0.01em] text-(--atum-ink)">{wordmark}</p>
          <p className="m-0 max-w-[34rem] text-[12.5px] leading-[1.45] text-(--atum-ink-muted)">{body}</p>
          <div className="pointer-events-auto mt-3.5 flex flex-wrap items-center justify-center gap-2">
            {t.atum.empty.chips.map(chip => (
              <button
                className="h-[30px] rounded-full bg-(--atum-hover) px-3 text-[12px] text-(--atum-ink-muted) transition-colors hover:bg-(--atum-pressed) hover:text-(--atum-ink)"
                key={chip}
                onClick={() => requestComposerInsert(chip)}
                type="button"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <div className="flex w-full min-w-0 flex-col items-center">
        <BrandMark className="mb-4 size-12" />
        <p
          className="fit-text mx-auto mb-2 w-[calc(100%-1rem)] font-semibold leading-[1.05] tracking-[0.06em] text-(--ui-text-secondary)"
          style={{ '--fit-min': '2.25rem' } as CSSProperties}
        >
          <span>
            <span>{wordmark}</span>
          </span>
        </p>

        <p className="m-0 text-center leading-normal tracking-tight">{body}</p>
      </div>
    </div>
  )
}
