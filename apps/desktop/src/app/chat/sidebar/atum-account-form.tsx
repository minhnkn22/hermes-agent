import { type FormEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

export type AtumAuthFailureKind = 'credentials' | 'network' | 'provider' | null

interface AtumAccountFormProps {
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
export function AtumAccountForm({ copy, failureKind, onSubmit, pending }: AtumAccountFormProps) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({})
  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (failureKind === 'credentials') {
      setPassword('')
      identifierRef.current?.focus()
      identifierRef.current?.select()
    }
  }, [failureKind])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (pending) {return}

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
    <form aria-busy={pending} className="space-y-2" onSubmit={event => void submit(event)}>
      <div className="space-y-1">
        <label className="block text-[0.6875rem] font-medium text-(--ui-text-secondary)" htmlFor="atum-identifier">
          {copy.identifier}
        </label>
        <p className="text-[0.6875rem] leading-4 text-(--ui-text-tertiary)" id="atum-identifier-hint">
          {copy.identifierHint}
        </p>
        <input
          aria-describedby={`atum-identifier-hint${fieldErrors.identifier ? ' atum-identifier-error' : ''}`}
          aria-invalid={Boolean(fieldErrors.identifier)}
          autoCapitalize="none"
          autoComplete="username"
          className="h-8 w-full rounded-md border border-(--ui-border) bg-(--ui-control-background) px-2 text-xs outline-none focus-visible:border-primary/60"
          disabled={pending}
          id="atum-identifier"
          name="identifier"
          onChange={event => {
            setIdentifier(event.target.value)

            if (fieldErrors.identifier) {setFieldErrors(previous => ({ ...previous, identifier: undefined }))}
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
        <label className="block text-[0.6875rem] font-medium text-(--ui-text-secondary)" htmlFor="atum-password">
          {copy.password}
        </label>
        <input
          aria-describedby={fieldErrors.password ? 'atum-password-error' : undefined}
          aria-invalid={Boolean(fieldErrors.password)}
          autoComplete="current-password"
          className="h-8 w-full rounded-md border border-(--ui-border) bg-(--ui-control-background) px-2 text-xs outline-none focus-visible:border-primary/60"
          disabled={pending}
          id="atum-password"
          name="password"
          onChange={event => {
            setPassword(event.target.value)

            if (fieldErrors.password) {setFieldErrors(previous => ({ ...previous, password: undefined }))}
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
      <Button className="h-8 w-full text-xs" disabled={pending} size="sm" type="submit">
        {pending ? copy.signingIn : copy.signIn}
      </Button>
    </form>
  )
}
