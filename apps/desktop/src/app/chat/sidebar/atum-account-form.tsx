import { type FormEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { AtumAuthFailureKind } from '@/lib/atum-auth'
import { cn } from '@/lib/utils'

export type { AtumAuthFailureKind }

/** `sidebar` is the compact legacy treatment; `atum` is the full-window auth
 *  gate's roomier one. Appearance changes container/control sizing only — the
 *  validation, `aria-invalid` wiring, and messages are identical. */
export type AtumAccountFormAppearance = 'atum' | 'sidebar'

interface AtumAccountFormProps {
  appearance?: AtumAccountFormAppearance
  /** Focus the identifier field on mount (the auth gate's entry point). */
  autoFocus?: boolean
  copy: {
    identifier: string
    identifierHint: string
    identifierPlaceholder: string
    identifierRequired: string
    password: string
    passwordRequired: string
    signIn: string
    signingIn: string
  }
  failureKind: AtumAuthFailureKind
  pending: boolean
  onSubmit: (credentials: { identifier: string; password: string }) => Promise<boolean>
}

/** Ephemeral credential form: values never leave component state except for the one native IPC call. */
export function AtumAccountForm({
  appearance = 'sidebar',
  autoFocus = false,
  copy,
  failureKind,
  onSubmit,
  pending
}: AtumAccountFormProps) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({})
  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const roomy = appearance === 'atum'

  const fieldClass = roomy
    ? 'h-11 w-full rounded-[var(--atum-r-control)] border border-(--atum-line-strong) bg-(--atum-sunk) px-3 text-sm text-(--atum-ink) outline-none placeholder:text-(--atum-ink-faint) focus-visible:border-(--atum-focus)'
    : 'h-8 w-full rounded-md border border-(--ui-border) bg-(--ui-control-background) px-2 text-xs outline-none focus-visible:border-primary/60'

  const labelClass = cn(
    'block font-medium',
    roomy ? 'text-xs text-(--atum-ink-soft)' : 'text-[0.6875rem] text-(--ui-text-secondary)'
  )

  const hintClass = roomy
    ? 'text-xs leading-5 text-(--atum-ink-soft)'
    : 'text-[0.6875rem] leading-4 text-(--ui-text-tertiary)'

  useEffect(() => {
    if (autoFocus) {
      identifierRef.current?.focus()
    }
  }, [autoFocus])

  useEffect(() => {
    if (failureKind === 'credentials') {
      setPassword('')
      identifierRef.current?.focus()
      identifierRef.current?.select()
    }
  }, [failureKind])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (pending) {
      return
    }

    const nextErrors = {
      ...(!identifier.trim() && { identifier: copy.identifierRequired }),
      ...(!password && { password: copy.passwordRequired })
    }

    setFieldErrors(nextErrors)

    if (nextErrors.identifier) {
      identifierRef.current?.focus()

      return
    }

    if (nextErrors.password) {
      passwordRef.current?.focus()

      return
    }

    if (await onSubmit({ identifier: identifier.trim(), password })) {
      setPassword('')
    }
  }

  return (
    <form aria-busy={pending} className={roomy ? 'space-y-3' : 'space-y-2'} onSubmit={event => void submit(event)}>
      <div className="space-y-1">
        <label className={labelClass} htmlFor="atum-identifier">
          {copy.identifier}
        </label>
        <p className={hintClass} id="atum-identifier-hint">
          {copy.identifierHint}
        </p>
        <input
          aria-describedby={`atum-identifier-hint${fieldErrors.identifier ? ' atum-identifier-error' : ''}`}
          aria-invalid={Boolean(fieldErrors.identifier)}
          autoCapitalize="none"
          autoComplete="username"
          className={fieldClass}
          disabled={pending}
          id="atum-identifier"
          name="identifier"
          onChange={event => {
            setIdentifier(event.target.value)

            if (fieldErrors.identifier) {
              setFieldErrors(previous => ({ ...previous, identifier: undefined }))
            }
          }}
          placeholder={copy.identifierPlaceholder}
          ref={identifierRef}
          spellCheck={false}
          type="text"
          value={identifier}
        />
        {fieldErrors.identifier && (
          <p className="text-[0.6875rem] leading-4 text-destructive" id="atum-identifier-error">
            {fieldErrors.identifier}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <label className={labelClass} htmlFor="atum-password">
          {copy.password}
        </label>
        <input
          aria-describedby={fieldErrors.password ? 'atum-password-error' : undefined}
          aria-invalid={Boolean(fieldErrors.password)}
          autoComplete="current-password"
          className={fieldClass}
          disabled={pending}
          id="atum-password"
          name="password"
          onChange={event => {
            setPassword(event.target.value)

            if (fieldErrors.password) {
              setFieldErrors(previous => ({ ...previous, password: undefined }))
            }
          }}
          ref={passwordRef}
          type="password"
          value={password}
        />
        {fieldErrors.password && (
          <p className="text-[0.6875rem] leading-4 text-destructive" id="atum-password-error">
            {fieldErrors.password}
          </p>
        )}
      </div>
      <Button
        className={roomy ? 'h-11 w-full text-sm' : 'h-8 w-full text-xs'}
        disabled={pending}
        size={roomy ? 'default' : 'sm'}
        type="submit"
      >
        {pending ? copy.signingIn : copy.signIn}
      </Button>
    </form>
  )
}
