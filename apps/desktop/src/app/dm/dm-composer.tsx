import { useStore } from '@nanostores/react'
import { type KeyboardEvent, useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { $atumDrafts, persistAtumDraft, sendAtumMessage, setAtumDraft } from '@/store/atum-messaging'

interface DmComposerProps {
  conversationId: string
  disabled: boolean
  onSend?: (text: string) => Promise<void> | void
  placeholder?: string
}

export function DmComposer({ conversationId, disabled, onSend, placeholder }: DmComposerProps) {
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
    <div className="shrink-0 px-4 pt-2 pb-4">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[var(--atum-r-composer)] border border-(--atum-line-strong) bg-(--atum-card) p-1.5 shadow-(--atum-shadow-row) focus-within:border-(--atum-focus) focus-within:ring-3 focus-within:ring-(--atum-focus)/20">
        <textarea
          aria-label={t.dm.compose}
          className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-[13px] text-(--atum-ink) outline-none placeholder:text-(--atum-ink-faint) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onBlur={() => void persistAtumDraft(conversationId)}
          onChange={event => setAtumDraft(conversationId, event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? t.dm.loadingMessages : (placeholder ?? t.dm.compose)}
          rows={1}
          value={text}
        />
        <Button
          aria-label={t.dm.send}
          className="size-9 shrink-0 rounded-full bg-(--atum-ink) text-(--atum-card) hover:bg-(--atum-ink-strong)"
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
