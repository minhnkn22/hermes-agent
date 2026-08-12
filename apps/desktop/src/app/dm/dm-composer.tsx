import { useStore } from '@nanostores/react'
import { type KeyboardEvent, useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { $atumDrafts, persistAtumDraft, sendAtumMessage, setAtumDraft } from '@/store/atum-messaging'

interface DmComposerProps {
  conversationId: string
  disabled: boolean
  onSend?: (text: string) => Promise<void> | void
}

export function DmComposer({ conversationId, disabled, onSend }: DmComposerProps) {
  const { locale, t } = useI18n()
  const drafts = useStore($atumDrafts)
  const text = drafts[conversationId] ?? ''

  useEffect(
    () => () => {
      void persistAtumDraft(conversationId)
    },
    [conversationId]
  )

  const send = async () => {
    if (disabled || !text.trim()) {
      return
    }

    if (onSend) {
      await onSend(text)
    } else {
      await sendAtumMessage(conversationId, text, locale)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return
    }

    event.preventDefault()
    void send()
  }

  return (
    <div className="shrink-0 border-t border-(--ui-border) p-4">
      <div className="flex items-end gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-control-background) p-1.5 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
        <textarea
          aria-label={t.dm.compose}
          className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-(--ui-text-tertiary) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onBlur={() => void persistAtumDraft(conversationId)}
          onChange={event => setAtumDraft(conversationId, event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? t.dm.loadingMessages : t.dm.compose}
          rows={1}
          value={text}
        />
        <Button
          aria-label={t.dm.send}
          className="size-9 shrink-0 rounded-full"
          disabled={disabled || !text.trim()}
          onClick={() => void send()}
          size="icon"
        >
          ↑
        </Button>
      </div>
    </div>
  )
}
