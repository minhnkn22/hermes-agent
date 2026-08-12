import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'

interface AtumAccountFormProps {
  copy: { identifier: string; password: string; signIn: string; signingIn: string }
  error: string | null
  pending: boolean
  onSubmit: (credentials: { identifier: string; password: string }) => Promise<void>
}

/** Ephemeral credential form: values never leave component state except for the one native IPC call. */
export function AtumAccountForm({ copy, error, onSubmit, pending }: AtumAccountFormProps) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (pending || !identifier.trim() || !password) {
      return
    }

    try {
      await onSubmit({ identifier: identifier.trim(), password })
    } finally {
      // Never retain the password after its one-shot native request settles.
      setPassword('')
    }
  }

  return (
    <form className="space-y-1.5" onSubmit={event => void submit(event)}>
      <input
        aria-label={copy.identifier}
        autoCapitalize="none"
        autoComplete="username"
        className="h-8 w-full rounded-md border border-(--ui-border) bg-(--ui-control-background) px-2 text-xs outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/15"
        disabled={pending}
        onChange={event => setIdentifier(event.target.value)}
        placeholder={copy.identifier}
        spellCheck={false}
        type="text"
        value={identifier}
      />
      <input
        aria-label={copy.password}
        autoComplete="current-password"
        className="h-8 w-full rounded-md border border-(--ui-border) bg-(--ui-control-background) px-2 text-xs outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/15"
        disabled={pending}
        onChange={event => setPassword(event.target.value)}
        placeholder={copy.password}
        type="password"
        value={password}
      />
      {error && (
        <p aria-live="polite" className="text-[0.6875rem] leading-4 text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        className="h-7 w-full text-xs"
        disabled={pending || !identifier.trim() || !password}
        size="sm"
        type="submit"
      >
        {pending ? copy.signingIn : copy.signIn}
      </Button>
    </form>
  )
}
