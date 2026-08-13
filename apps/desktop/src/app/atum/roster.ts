/**
 * The Atum roster — the narrow, honest adapter.
 *
 * The visible product model is Atum: ONE local assistant conversation backed by
 * the Hermes engine, plus hosted Atum DMs. This module therefore reads exactly
 * two sources and never touches `$sessions`, `$profiles`, `$projects`,
 * `$cronSessions`, pins, worktrees, or session groups. No Hermes noun reaches
 * the roster, and `roster.test.ts` asserts that this file's import graph stays
 * that way.
 *
 * The local assistant is a synthetic entry rather than a session list because a
 * list of sessions IS the Hermes organisation. The entry's route is the only
 * place the underlying session identity appears, and it is durable-id based
 * (`sessionRoute`) so navigation survives a stream restart.
 */

import type { Locale } from '@/i18n'
import type { AtumMessagingConversation } from '@/lib/atum-messaging-client'

import { dmRoute, NEW_CHAT_ROUTE, sessionRoute } from '../routes'

export type AtumRosterKind = 'assistant' | 'app' | 'direct'

const APP_PRESENTATION = {
  moon: { order: 1, role: { vi: 'Chuyên gia chiêm tinh', en: 'Astrology specialist' } },
  andy: { order: 2, role: { vi: 'Người đồng hành tinh thần', en: 'Mental & emotional guide' } },
  ben: { order: 3, role: { vi: 'Chuyên gia hướng nghiệp', en: 'Career counselor' } },
  taylor: { order: 4, role: { vi: 'Chuyên gia nghiên cứu tài chính', en: 'Financial research specialist' } }
} as const

/** Deterministic avatar tint steps — an accent-mix percentage, never a raw
 *  colour, so `design-contract.test.ts` keeps passing. */
export const ATUM_AVATAR_TINTS = [8, 14, 20, 26] as const

export interface AtumRosterEntry {
  /** Stable list key. `assistant` for the local assistant, the conversation id for DMs. */
  id: string
  kind: AtumRosterKind
  title: string
  /** One quiet line under the title. Empty string renders nothing — never a placeholder. */
  preview: string
  /** The app role from the Atum presentation catalog or hosted row; wins over `preview`. */
  role: string
  /** Hosted avatar image when the row carries one; else an initial on a tint. */
  avatarUrl: string
  /** Index into ATUM_AVATAR_TINTS, derived from the id — stable across renders. */
  avatarTint: number
  /** `'online'` only when the hosted row says so; the assistant never has one. */
  presence: 'online' | null
  unreadCount: number
  /** Route this row opens. */
  route: string
  /** ISO timestamp used for ordering conversations. `null` for the pinned assistant. */
  activityAt: null | string
}

// Unicode combining diacritical marks — stripped after NFD so a query typed
// without tone marks still matches Vietnamese titles.
const COMBINING_MARKS = /[̀-ͯ]/gu
const D_WITH_STROKE = /[đĐ]/gu

/** Fold Vietnamese diacritics so `tro chuyen` finds `Trò chuyện`. */
export function foldSearchText(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').replace(D_WITH_STROKE, 'd').toLowerCase()
}

export function rosterEntryMatches(entry: AtumRosterEntry, query: string): boolean {
  const needle = foldSearchText(query.trim())

  if (!needle) {
    return true
  }

  return foldSearchText(`${entry.title} ${entry.role} ${entry.preview}`).includes(needle)
}

function dmPreview(conversation: AtumMessagingConversation): string {
  const preview = conversation.payload?.preview

  return typeof preview === 'string' ? preview : ''
}

const HAS_UPPERCASE = /\p{Lu}/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * Display title for a hosted row. Hosted specialist ids arrive lowercase
 * (`moon`, `taylor`) — those get proper title case. A title that already
 * carries its own casing (`Trò chuyện nhóm`) is left alone except for a
 * capital first letter.
 */
export function toDisplayTitle(raw: string): string {
  const title = raw.trim()

  if (!title) {
    return title
  }

  if (!HAS_UPPERCASE.test(title)) {
    return title.replace(/(^|\s)(\p{L})/gu, (_match, space: string, letter: string) => space + letter.toUpperCase())
  }

  return title.charAt(0).toUpperCase() + title.slice(1)
}

function payloadString(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function appId(conversation: AtumMessagingConversation): string {
  return payloadString(conversation.payload, 'specialist').toLowerCase() || (conversation.title ?? '').toLowerCase()
}

function appRole(conversation: AtumMessagingConversation, locale: Locale): string {
  const supplied = payloadString(conversation.payload, 'role', 'specialist_role')

  if (supplied) {
    return supplied
  }

  const presentation = APP_PRESENTATION[appId(conversation) as keyof typeof APP_PRESENTATION]

  return presentation?.role[locale === 'vi' ? 'vi' : 'en'] ?? ''
}

function appOrder(conversation: AtumMessagingConversation): number {
  return APP_PRESENTATION[appId(conversation) as keyof typeof APP_PRESENTATION]?.order ?? Number.MAX_SAFE_INTEGER
}

export interface AtumConversationPresentation {
  avatarUrl: string
  kind: 'app' | 'direct'
  presence: 'online' | null
  role: string
  title: string
}

/** One presentation adapter shared by the roster, transcript empty state and
 * workspace details. Raw participant ids never need to become UI copy. */
export function presentAtumConversation(
  conversation: AtumMessagingConversation,
  locale: Locale
): AtumConversationPresentation {
  const kind = conversation.kind === 'specialist' ? 'app' : 'direct'
  const suppliedTitle = conversation.title?.trim() ?? ''
  const participantLabel = conversation.participantIds.find(id => !UUID.test(id)) ?? ''
  const title = suppliedTitle && !UUID.test(suppliedTitle) ? suppliedTitle : participantLabel

  return {
    avatarUrl: payloadString(conversation.payload, 'avatar_url', 'avatarUrl'),
    kind,
    presence: conversation.payload?.presence === 'online' ? 'online' : null,
    role: kind === 'app' ? appRole(conversation, locale) : '',
    title: toDisplayTitle(title || (locale === 'vi' ? 'Cuộc trò chuyện' : 'Conversation'))
  }
}

function activityTime(conversation: AtumMessagingConversation): string {
  return conversation.lastMessageAt ?? conversation.updatedAt
}

/** Stable tint pick: same conversation id → same step, on every render. */
export function avatarTintIndex(id: string): number {
  let hash = 0

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }

  return hash % ATUM_AVATAR_TINTS.length
}

export interface BuildRosterInput {
  /** The live local session's durable id, when one exists. */
  activeSessionId: null | string
  /** Copy for the synthetic assistant row. */
  assistantHint: string
  assistantTitle: string
  /** Current renderer locale, used only for the curated app-role presentation. */
  locale: Locale
  /** Hosted Atum app and direct conversations. */
  conversations: readonly AtumMessagingConversation[]
  /** Hosted conversations only exist once the account is usable. */
  dmsAvailable: boolean
}

/**
 * Build the visible roster. The assistant is always first and always present —
 * it is the product's home surface, so "no chats" is never a state the user can
 * reach by having no sessions.
 */
export function buildAtumRoster({
  activeSessionId,
  assistantHint,
  assistantTitle,
  locale,
  conversations,
  dmsAvailable
}: BuildRosterInput): AtumRosterEntry[] {
  const assistant: AtumRosterEntry = {
    id: 'assistant',
    kind: 'assistant',
    title: assistantTitle,
    preview: assistantHint,
    role: '',
    avatarUrl: '',
    avatarTint: 0,
    presence: null,
    unreadCount: 0,
    route: activeSessionId ? sessionRoute(activeSessionId) : NEW_CHAT_ROUTE,
    activityAt: null
  }

  if (!dmsAvailable) {
    return [assistant]
  }

  const entries = conversations.map<AtumRosterEntry>(conversation => {
    const presentation = presentAtumConversation(conversation, locale)

    return {
      id: conversation.id,
      kind: presentation.kind,
      title: presentation.title,
      preview: dmPreview(conversation),
      role: presentation.role,
      avatarUrl: presentation.avatarUrl,
      avatarTint: avatarTintIndex(conversation.id),
      presence: presentation.presence,
      unreadCount: conversation.unreadCount,
      route: dmRoute(conversation.id),
      activityAt: activityTime(conversation)
    }
  })

  const apps = entries
    .filter(entry => entry.kind === 'app')
    .sort((left, right) => {
      const leftConversation = conversations.find(conversation => conversation.id === left.id)!
      const rightConversation = conversations.find(conversation => conversation.id === right.id)!

      return appOrder(leftConversation) - appOrder(rightConversation) || left.title.localeCompare(right.title)
    })

  const direct = entries
    .filter(entry => entry.kind === 'direct')
    .sort((left, right) => (right.activityAt ?? '').localeCompare(left.activityAt ?? ''))

  return [assistant, ...apps, ...direct]
}

export function filterRoster(entries: readonly AtumRosterEntry[], query: string): AtumRosterEntry[] {
  return query.trim() ? entries.filter(entry => rosterEntryMatches(entry, query)) : [...entries]
}
