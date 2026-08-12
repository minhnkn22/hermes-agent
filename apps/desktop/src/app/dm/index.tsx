import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

import type { StatusTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import {
  $atumAccountStatus,
  $atumActiveMessages,
  $atumConnectivity,
  $atumRoster,
  $atumStatus,
  initializeAtumMessaging,
  refreshAtumStatus,
  retryAtumMessage,
  setAtumActiveConversation
} from '@/store/atum-messaging'

import { DmComposer } from './dm-composer'
import { DmHeader } from './dm-header'
import { DmMessageList } from './dm-message-list'

function statusPresentation(
  connectivity: string,
  labels: { offline: string; reconnecting: string; authExpired: string; error: string }
): { label: string | null; tone: StatusTone } {
  if (connectivity === 'online') {
    return { label: null, tone: 'good' }
  }

  if (connectivity === 'offline_cached') {
    return { label: labels.offline, tone: 'warn' }
  }

  if (connectivity === 'reconnecting') {
    return { label: labels.reconnecting, tone: 'warn' }
  }

  if (connectivity === 'auth_expired') {
    return { label: labels.authExpired, tone: 'bad' }
  }

  if (connectivity === 'error') {
    return { label: labels.error, tone: 'bad' }
  }

  return { label: null, tone: 'muted' }
}

export function AtumDmView() {
  const { conversationId = '' } = useParams()
  const { t } = useI18n()
  const account = useStore($atumAccountStatus)
  const status = useStore($atumStatus)
  const connectivity = useStore($atumConnectivity)
  const roster = useStore($atumRoster)
  const messages = useStore($atumActiveMessages)
  const conversation = roster.find(item => item.id === conversationId)
  const title = conversation?.title?.trim() || conversation?.participantIds.join(', ') || t.dm.sectionTitle

  const presentation = statusPresentation(connectivity, {
    offline: t.dm.offline,
    reconnecting: t.dm.reconnecting,
    authExpired: t.dm.authExpired,
    error: t.dm.errorGeneric
  })

  const canCompose =
    account.state === 'signed_in' &&
    (connectivity === 'online' || connectivity === 'offline_cached' || connectivity === 'reconnecting')

  useEffect(() => {
    void initializeAtumMessaging()
  }, [])

  useEffect(() => {
    setAtumActiveConversation(conversationId || null)

    return () => setAtumActiveConversation(null)
  }, [conversationId])

  return (
    <main className="flex h-full min-h-0 flex-col bg-(--ui-editor-surface-background)">
      <DmHeader statusLabel={presentation.label} title={title} tone={presentation.tone} />
      {(account.state === 'expired' || connectivity === 'auth_expired') && (
        <div className="flex items-center justify-between gap-4 border-b border-destructive/25 bg-destructive/8 px-5 py-2 text-xs">
          <span>{t.dm.authExpired}</span>
          <span className="text-(--ui-text-tertiary)">{t.dm.authExpiredAction}</span>
        </div>
      )}
      {(account.state === 'error' || connectivity === 'error') && (
        <div className="flex items-center justify-between gap-4 border-b border-destructive/25 bg-destructive/8 px-5 py-2 text-xs">
          <span>{account.errorCode || status?.errorCode || t.dm.errorGeneric}</span>
          <Button onClick={() => void refreshAtumStatus()} size="sm" variant="outline">
            {t.dm.retry}
          </Button>
        </div>
      )}
      {(connectivity === 'offline_cached' || connectivity === 'reconnecting') && (
        <div className="border-b border-amber-500/20 bg-amber-500/8 px-5 py-2 text-center text-[0.6875rem] text-amber-700 dark:text-amber-300">
          {presentation.label}
        </div>
      )}
      <DmMessageList
        accountId={status?.accountId ?? account.account?.id ?? null}
        emptyLabel={connectivity === 'loading' ? t.dm.loadingMessages : t.dm.noMessages}
        messages={messages}
        onRetry={clientMessageId => void retryAtumMessage(clientMessageId)}
        retryLabel={t.dm.retry}
      />
      <DmComposer conversationId={conversationId} disabled={!canCompose} />
    </main>
  )
}
