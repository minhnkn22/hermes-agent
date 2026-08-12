import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { dmRoute, routeDmConversationId } from '@/app/routes'
import { StatusDot, type StatusTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import {
  $atumAccountStatus,
  $atumConnectivity,
  $atumSortedRoster,
  initializeAtumMessaging,
  refreshAtumRoster,
  signInToAtum,
  signInToAtumWithPassword,
  signOutOfAtum
} from '@/store/atum-messaging'

import { AtumAccountForm } from './atum-account-form'
import { AtumConversationRow } from './atum-row'

function toneFor(connectivity: string, accountState: string): StatusTone {
  if (
    accountState === 'expired' ||
    accountState === 'error' ||
    connectivity === 'auth_expired' ||
    connectivity === 'error'
  ) {
    return 'bad'
  }

  if (connectivity === 'online') {
    return 'good'
  }

  if (connectivity === 'offline_cached' || connectivity === 'reconnecting') {
    return 'warn'
  }

  return 'muted'
}

export function AtumSection() {
  const { t } = useI18n()
  const account = useStore($atumAccountStatus)
  const connectivity = useStore($atumConnectivity)
  const roster = useStore($atumSortedRoster)
  const location = useLocation()
  const navigate = useNavigate()
  const activeId = routeDmConversationId(location.pathname)
  const signedIn = account.state === 'signed_in' || account.state === 'refreshing'
  const signingIn = account.state === 'signing_in'

  useEffect(() => {
    void initializeAtumMessaging()
  }, [])

  const statusLabel =
    connectivity === 'offline_cached'
      ? t.dm.offline
      : connectivity === 'reconnecting'
        ? t.dm.reconnecting
        : connectivity === 'auth_expired' || account.state === 'expired'
          ? t.dm.authExpired
          : connectivity === 'error' || account.state === 'error'
            ? t.dm.errorGeneric
            : null

  return (
    <SidebarGroup className="shrink-0 border-y border-(--sidebar-edge-border) p-0 py-1.5">
      <SidebarGroupLabel className="h-7 gap-2 px-2">
        <StatusDot tone={toneFor(connectivity, account.state)} />
        <span className="font-semibold text-foreground">{t.dm.sectionTitle}</span>
        {statusLabel && (
          <span className="ml-auto truncate text-[0.625rem] font-normal text-(--ui-text-tertiary)">{statusLabel}</span>
        )}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        {!signedIn ? (
          <div className="px-2 pb-1.5">
            <p className="mb-2 text-[0.6875rem] leading-4 text-(--ui-text-tertiary)">
              {account.state === 'unconfigured' ? t.dm.unavailable : t.dm.notSignedIn}
            </p>
            {account.configured && (
              <div className="space-y-2">
                {account.providers.google && (
                  <Button
                    className="h-8 w-full text-xs"
                    disabled={signingIn}
                    onClick={() => void signInToAtum()}
                    size="sm"
                    variant="outline"
                  >
                    {signingIn ? t.dm.signingIn : t.dm.continueWithGoogle}
                  </Button>
                )}
                {account.providers.google && account.providers.password && (
                  <div className="flex items-center gap-2 text-[0.625rem] text-(--ui-text-tertiary)">
                    <span className="h-px flex-1 bg-(--ui-border)" />
                    <span>{t.dm.or}</span>
                    <span className="h-px flex-1 bg-(--ui-border)" />
                  </div>
                )}
                {account.providers.password && (
                  <AtumAccountForm
                    copy={{
                      identifier: t.dm.identifier,
                      password: t.dm.password,
                      signIn: account.state === 'expired' ? t.dm.authExpiredAction : t.dm.signIn,
                      signingIn: t.dm.signingIn
                    }}
                    error={account.state === 'error' ? t.dm.signInFailed : null}
                    onSubmit={signInToAtumWithPassword}
                    pending={signingIn}
                  />
                )}
                {!account.providers.google && !account.providers.password && (
                  <p className="text-[0.6875rem] text-(--ui-text-tertiary)">{t.dm.unavailable}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2 pb-1 text-[0.625rem] text-(--ui-text-tertiary)">
              <span className="min-w-0 flex-1 truncate">
                {t.dm.signedInAs(
                  account.account?.displayName || account.account?.email || account.account?.id || 'Atum'
                )}
              </span>
              <button
                className="shrink-0 rounded px-1 py-0.5 hover:bg-(--ui-control-hover-background) focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => void signOutOfAtum()}
                type="button"
              >
                {t.dm.signOut}
              </button>
            </div>
            <SidebarMenu className="gap-px">
              {roster.map(conversation => (
                <AtumConversationRow
                  active={activeId === conversation.id}
                  conversation={conversation}
                  key={conversation.id}
                  onOpen={() => navigate(dmRoute(conversation.id))}
                  unreadLabel={t.dm.unreadCount}
                />
              ))}
            </SidebarMenu>
            {roster.length === 0 && (
              <button
                className="w-full rounded px-2 py-2 text-left text-[0.6875rem] text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)"
                onClick={() => void refreshAtumRoster()}
                type="button"
              >
                {t.dm.noConversations}
              </button>
            )}
          </>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
