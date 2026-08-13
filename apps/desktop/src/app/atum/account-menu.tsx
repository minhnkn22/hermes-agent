import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  preventCloseButtonAutoFocus
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { $atumAccountStatus, signOutOfAtum } from '@/store/atum-messaging'

function IdentityRow({ label, value, unavailable }: { label: string; value?: string | null; unavailable: string }) {
  return (
    <div className="grid gap-1 border-b border-(--ui-stroke-tertiary) py-3 last:border-b-0 sm:grid-cols-[8rem_1fr] sm:gap-4">
      <dt className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{label}</dt>
      <dd className="min-w-0 break-words text-[length:var(--conversation-text-font-size)] text-foreground">
        {value || <span className="text-(--ui-text-tertiary)">{unavailable}</span>}
      </dd>
    </div>
  )
}

/**
 * A consumer account surface, deliberately separate from Settings. The native
 * account seam currently exposes only display name, handle and account id, so
 * email and phone are shown honestly as unavailable rather than as editable
 * controls that could never save.
 */
export function AtumAccountDialog({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const account = useStore($atumAccountStatus)
  const identity = account.account
  const signedIn = account.state === 'signed_in' || account.state === 'refreshing'

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md" onOpenAutoFocus={preventCloseButtonAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t.atum.account.title}</DialogTitle>
          <DialogDescription>{t.atum.account.description}</DialogDescription>
        </DialogHeader>

        <dl className="border-y border-(--ui-stroke-tertiary)">
          <IdentityRow
            label={t.atum.account.name}
            unavailable={t.atum.account.unavailable}
            value={identity?.displayName}
          />
          <IdentityRow
            label={t.atum.account.username}
            unavailable={t.atum.account.unavailable}
            value={identity?.handle}
          />
          <IdentityRow label={t.atum.account.email} unavailable={t.atum.account.unavailable} />
          <IdentityRow label={t.atum.account.phone} unavailable={t.atum.account.unavailable} />
          <IdentityRow label={t.atum.account.id} unavailable={t.atum.account.unavailable} value={identity?.id} />
        </dl>

        <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {t.atum.account.editUnavailable}
        </p>

        {signedIn && (
          <DialogFooter>
            <Button onClick={() => void signOutOfAtum()} type="button" variant="outline">
              {t.dm.signOut}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
