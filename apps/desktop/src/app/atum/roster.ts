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

import type { AtumMessagingConversation } from '@/lib/atum-messaging-client'

import { dmRoute, NEW_CHAT_ROUTE, sessionRoute } from '../routes'

export type AtumRosterKind = 'assistant' | 'dm'

export interface AtumRosterEntry {
  /** Stable list key. `assistant` for the local assistant, the conversation id for DMs. */
  id: string
  kind: AtumRosterKind
  title: string
  /** One quiet line under the title. Empty string renders nothing — never a placeholder. */
  preview: string
  unreadCount: number
  /** Route this row opens. */
  route: string
  /** ISO timestamp used for ordering DMs. `null` for the pinned assistant. */
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

  return foldSearchText(`${entry.title} ${entry.preview}`).includes(needle)
}

function dmPreview(conversation: AtumMessagingConversation): string {
  const preview = conversation.payload?.preview

  return typeof preview === 'string' ? preview : ''
}

export interface BuildRosterInput {
  /** The live local session's durable id, when one exists. */
  activeSessionId: null | string
  /** Copy for the synthetic assistant row. */
  assistantHint: string
  assistantTitle: string
  /** Hosted Atum DM conversations, already sorted by last activity. */
  conversations: readonly AtumMessagingConversation[]
  /** Hosted DMs only exist once the account is usable. */
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
  conversations,
  dmsAvailable
}: BuildRosterInput): AtumRosterEntry[] {
  const assistant: AtumRosterEntry = {
    id: 'assistant',
    kind: 'assistant',
    title: assistantTitle,
    preview: assistantHint,
    unreadCount: 0,
    route: activeSessionId ? sessionRoute(activeSessionId) : NEW_CHAT_ROUTE,
    activityAt: null
  }

  if (!dmsAvailable) {
    return [assistant]
  }

  const dms = conversations.map<AtumRosterEntry>(conversation => ({
    id: conversation.id,
    kind: 'dm',
    title: conversation.title ?? conversation.participantIds[0] ?? conversation.id,
    preview: dmPreview(conversation),
    unreadCount: conversation.unreadCount,
    route: dmRoute(conversation.id),
    activityAt: conversation.lastMessageAt ?? conversation.updatedAt
  }))

  return [assistant, ...dms]
}

export function filterRoster(entries: readonly AtumRosterEntry[], query: string): AtumRosterEntry[] {
  return query.trim() ? entries.filter(entry => rosterEntryMatches(entry, query)) : [...entries]
}
