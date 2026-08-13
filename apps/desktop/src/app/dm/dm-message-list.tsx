import { type ReactNode, useEffect, useRef } from 'react'

import type { AtumMessagingMessage } from '@/lib/atum-messaging-client'

import { DmMessageBubble } from './dm-message-bubble'

interface DmMessageListProps {
  accountId: string | null
  emptyContent: ReactNode
  messages: AtumMessagingMessage[]
  retryLabel: string
  onRetry: (clientMessageId: string) => void
}

function dayKey(date: string): string {
  return date.slice(0, 10)
}

export function DmMessageList({ accountId, emptyContent, messages, onRetry, retryLabel }: DmMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  if (messages.length === 0) {
    return <div className="grid min-h-0 flex-1 place-items-center">{emptyContent}</div>
  }

  let priorDay: string | null = null

  return (
    <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-4 py-5" role="log">
      <div className="mx-auto w-full max-w-3xl">
        {messages.map(message => {
          const currentDay = dayKey(message.createdAt)
          const showDate = currentDay !== priorDay
          priorDay = currentDay

          return (
            <div key={message.localId}>
              {showDate && (
                <div className="my-3 text-center text-[0.6875rem] text-(--atum-ink-muted)">
                  {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(message.createdAt))}
                </div>
              )}
              <DmMessageBubble
                message={message}
                onRetry={onRetry}
                own={Boolean(accountId && message.sender.id === accountId)}
                retryLabel={retryLabel}
              />
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
    </div>
  )
}
