import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

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
  setAtumActiveConversation,
  signInToAtum
} from '@/store/atum-messaging'

import { presentAtumConversation } from '../atum/roster'

import { DmComposer } from './dm-composer'
import { DmMessageList } from './dm-message-list'

export function canComposeAtum(accountState: string, connectivity: string): boolean {
  return (
    (accountState === 'signed_in' || accountState === 'refreshing') &&
    (connectivity === 'online' || connectivity === 'offline_cached' || connectivity === 'reconnecting')
  )
}

export function AtumDmView() {
  const { conversationId = '' } = useParams()
  const { locale, t } = useI18n()
  const account = useStore($atumAccountStatus)
  const status = useStore($atumStatus)
  const connectivity = useStore($atumConnectivity)
  const roster = useStore($atumRoster)
  const messages = useStore($atumActiveMessages)
  const conversation = roster.find(item => item.id === conversationId)
  const conversationPresentation = conversation ? presentAtumConversation(conversation, locale) : null
  const title = conversationPresentation?.title ?? t.dm.sectionTitle

  const canCompose = canComposeAtum(account.state, connectivity)

  const reauthenticate = () => {
    if (account.providers.google) {
      void signInToAtum()

      return
    }

    document.getElementById('atum-identifier')?.focus()
  }

  useEffect(() => {
    void initializeAtumMessaging()
  }, [])

  useEffect(() => {
    setAtumActiveConversation(conversationId || null)

    return () => setAtumActiveConversation(null)
  }, [conversationId])

  return (
    <main className="flex h-full min-h-0 flex-col bg-(--atum-chat-solid)">
      {(account.state === 'expired' || connectivity === 'auth_expired') && (
        <div
          className="flex items-center justify-between gap-4 border-b border-destructive/25 bg-destructive/8 px-5 py-2 text-xs"
          role="alert"
        >
          <span>{t.dm.authExpired}</span>
          <Button onClick={reauthenticate} size="sm" variant="outline">
            {t.dm.authExpiredAction}
          </Button>
        </div>
      )}
      {(account.state === 'error' || connectivity === 'error') && (
        <div
          className="flex items-center justify-between gap-4 border-b border-destructive/25 bg-destructive/8 px-5 py-2 text-xs"
          role="alert"
        >
          <span>{t.dm.errorGeneric}</span>
          <Button onClick={() => void refreshAtumStatus()} size="sm" variant="outline">
            {t.dm.retry}
          </Button>
        </div>
      )}
      <DmMessageList
        accountId={status?.accountId ?? account.account?.id ?? null}
        emptyContent={
          connectivity === 'loading' ? (
            <p className="text-[13px] text-(--atum-ink-muted)">{t.dm.loadingMessages}</p>
          ) : (
            <DmEmptyState
              avatarUrl={conversationPresentation?.avatarUrl ?? ''}
              role={conversationPresentation?.role ?? ''}
              title={title}
            />
          )
        }
        messages={messages}
        onRetry={clientMessageId => void retryAtumMessage(clientMessageId)}
        retryLabel={t.dm.retry}
      />
      <DmComposer
        conversationId={conversationId}
        disabled={!canCompose}
        placeholder={
          connectivity === 'reconnecting' || connectivity === 'offline_cached' ? t.atum.offline.reconnecting : undefined
        }
      />
    </main>
  )
}

function DmEmptyState({ avatarUrl, role, title }: { avatarUrl: string; role: string; title: string }) {
  const { t } = useI18n()

  return (
    <div className="flex max-w-sm flex-col items-center px-6 text-center">
      {avatarUrl ? (
        <img alt="" className="size-14 rounded-2xl object-cover shadow-(--atum-shadow-row)" src={avatarUrl} />
      ) : (
        <span className="grid size-14 place-items-center rounded-2xl bg-(--atum-sunk) text-lg font-semibold text-(--atum-ink-soft) shadow-(--atum-shadow-row)">
          {title.slice(0, 1).toLocaleUpperCase()}
        </span>
      )}
      <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-(--atum-ink)">
        {t.dm.startConversation(title)}
      </h2>
      {role && <p className="mt-1 text-[12px] text-(--atum-ink-muted)">{role}</p>}
    </div>
  )
}
