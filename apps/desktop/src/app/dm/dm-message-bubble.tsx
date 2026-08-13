import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import type { AtumMessagingMessage } from '@/lib/atum-messaging-client'
import { cn } from '@/lib/utils'

interface DmMessageBubbleProps {
  message: AtumMessagingMessage
  own: boolean
  retryLabel: string
  onRetry: (clientMessageId: string) => void
}

export function DmMessageBubble({ message, onRetry, own, retryLabel }: DmMessageBubbleProps) {
  const failed = message.delivery === 'failed_retryable' || message.delivery === 'failed_permanent'
  const pending = message.delivery === 'queued' || message.delivery === 'sending'
  const conflicted = message.delivery === 'conflicted'

  return (
    <div className={cn('flex py-1.5', own ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[min(36rem,78%)] rounded-[17px] px-3.5 py-2 text-[13px] leading-5 shadow-xs',
          own
            ? 'rounded-br-[6px] bg-(--atum-ink) text-(--atum-card)'
            : 'rounded-bl-[6px] border border-(--atum-line) bg-(--atum-card) text-(--atum-ink)',
          failed && 'opacity-75 ring-1 ring-destructive/50',
          conflicted && 'ring-1 ring-amber-500/70'
        )}
      >
        <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[0.625rem]',
            own ? 'text-(--atum-card)/65' : 'text-(--atum-ink-muted)'
          )}
        >
          <time dateTime={message.createdAt}>
            {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
              new Date(message.createdAt)
            )}
          </time>
          {pending && <Codicon aria-label="sending" name="clock" size="0.625rem" />}
          {failed && <Codicon aria-label="failed" name="error" size="0.625rem" />}
          {conflicted && <Codicon aria-label="conflicted" name="warning" size="0.625rem" />}
        </div>
        {message.delivery === 'failed_retryable' && message.clientMessageId && (
          <Button
            className="mt-1 h-6 px-2 text-[0.6875rem]"
            onClick={() => onRetry(message.clientMessageId!)}
            size="sm"
            variant="outline"
          >
            {retryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
