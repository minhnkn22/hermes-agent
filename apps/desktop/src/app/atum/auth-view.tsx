import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { AtumAccountForm } from '@/app/chat/sidebar/atum-account-form'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { authFailureKind } from '@/lib/atum-auth'
import {
  $atumAccountStatus,
  cancelAtumSignIn,
  signInToAtum,
  signInToAtumWithPassword
} from '@/store/atum-messaging'

/**
 * The Atum sign-in gate — a full-window surface, not a card floating over the
 * shell and emphatically not a form crammed into a 274px rail. When it is
 * showing, the rail, roster, chat, and workspace are not in the DOM at all;
 * `shell.test.tsx` asserts that, so the inline-form regression cannot return
 * silently.
 *
 * It is deliberately NOT dismissable (DESIGN.md requires that be explicit).
 * `Esc` cancels an in-flight sign-in and does nothing else — one cancel
 * gesture, one action.
 */
export function AtumAuthView() {
  const { t } = useI18n()
  const account = useStore($atumAccountStatus)
  const [method, setMethod] = useState<'google' | 'password' | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)

  const signingIn = account.state === 'signing_in'
  const expired = account.state === 'expired'
  const failureKind = account.state === 'error' ? authFailureKind(account.errorCode) : null

  const failureCopy =
    failureKind === 'credentials'
      ? t.dm.signInFailed
      : failureKind === 'network'
        ? t.dm.signInOffline
        : failureKind === 'provider'
          ? t.dm.signInProviderDown
          : null

  // The gate owns the window on arrival, so the heading is the entry point for
  // screen readers and keyboard users alike.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // A failure is the one thing that must interrupt: move focus to the band so
  // the reason is read before the user retypes.
  useEffect(() => {
    if (failureCopy) {
      alertRef.current?.focus()
    }
  }, [failureCopy])

  const noProviders = !account.providers.google && !account.providers.password

  return (
    <div
      className="atum-shell grid h-dvh place-items-center overflow-auto bg-(--atum-desk) p-6 [-webkit-app-region:drag]"
      onKeyDown={event => {
        if (event.key === 'Escape' && signingIn) {
          event.preventDefault()
          void cancelAtumSignIn()
        }
      }}
    >
      <main className="atum-plate w-[400px] max-w-full p-8 [-webkit-app-region:no-drag]">
        <BrandMark className="size-14 rounded-[var(--atum-r-tile)]" />

        <h1
          className="atum-auth-heading mt-5 text-[22px] font-semibold tracking-[-0.02em] text-(--atum-ink)"
          ref={headingRef}
          tabIndex={-1}
        >
          {expired ? t.atum.auth.expiredTitle : t.atum.auth.title}
        </h1>
        <p className="mt-2 max-w-prose text-[13px] leading-5 text-(--atum-ink-soft)">
          {expired ? t.atum.auth.expiredBody : t.dm.brandLine}
        </p>

        {failureCopy && (
          <p
            className="mt-5 text-[13px] leading-5 text-destructive outline-none"
            ref={alertRef}
            role="alert"
            tabIndex={-1}
          >
            {failureCopy}
          </p>
        )}

        {!account.configured || noProviders ? (
          <p className="mt-6 text-[13px] leading-5 text-(--atum-ink-soft)">{t.dm.unavailable}</p>
        ) : (
          <div className="mt-6 space-y-4">
            {account.providers.google && (
              <Button
                aria-busy={signingIn && method === 'google'}
                className="h-11 w-full text-sm"
                disabled={signingIn}
                onClick={() => {
                  setMethod('google')
                  void signInToAtum()
                }}
                type="button"
              >
                {signingIn && method === 'google' ? t.dm.googlePending : t.dm.continueWithGoogle}
              </Button>
            )}

            {account.providers.google && account.providers.password && (
              <div className="flex items-center gap-3 text-[11px] text-(--atum-ink-faint)">
                <span className="h-px flex-1 bg-(--atum-line-strong)" />
                <span>{t.dm.or}</span>
                <span className="h-px flex-1 bg-(--atum-line-strong)" />
              </div>
            )}

            {account.providers.password && (
              <AtumAccountForm
                appearance="atum"
                autoFocus={!account.providers.google}
                copy={{
                  identifier: t.dm.identifier,
                  identifierHint: t.dm.identifierHint,
                  identifierPlaceholder: t.dm.identifierPlaceholder,
                  identifierRequired: t.dm.identifierRequired,
                  password: t.dm.password,
                  passwordRequired: t.dm.passwordRequired,
                  signIn: expired ? t.dm.authExpiredAction : t.dm.signIn,
                  signingIn: t.dm.signingIn
                }}
                failureKind={failureKind}
                onSubmit={async credentials => {
                  setMethod('password')
                  await signInToAtumWithPassword(credentials)
                  const next = $atumAccountStatus.get()

                  return next.state === 'signed_in' || authFailureKind(next.errorCode) === 'credentials'
                }}
                pending={signingIn}
              />
            )}

            {signingIn && (
              <Button className="w-full" onClick={() => void cancelAtumSignIn()} type="button" variant="text">
                {t.dm.cancelSignIn}
              </Button>
            )}
          </div>
        )}

        <p className="mt-6 text-[11px] leading-4 text-(--atum-ink-faint)">{t.atum.auth.terms}</p>
      </main>
    </div>
  )
}
