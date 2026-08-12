import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { ATUM_AUTH_ROUTE, SETTINGS_ROUTE } from '@/app/routes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { type Locale, LOCALE_META, useI18n } from '@/i18n'
import { $atumAccountStatus, signOutOfAtum } from '@/store/atum-messaging'
import { useTheme } from '@/themes'

/**
 * The account menu behind the rail's Atum tile. It is the home for everything
 * the simplified chat rim gave up that is genuinely account-shaped: identity,
 * language, appearance, settings, sign-out. Power-user chrome (model, approval
 * mode, gateway, context usage) stays in Settings and the ⌘K palette.
 *
 * Menu material is the shared menu/popover treatment, NOT the plate recipe —
 * plates are shell structure, menus are transient.
 */
export function AtumAccountMenu({ children }: { children: ReactNode }) {
  const { locale, setLocale, t } = useI18n()
  const { mode, setMode } = useTheme()
  const account = useStore($atumAccountStatus)
  const navigate = useNavigate()

  const signedIn = account.state === 'signed_in' || account.state === 'refreshing'
  const displayName = account.account?.displayName || account.account?.handle || account.account?.id || null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" side="right" sideOffset={8}>
        <DropdownMenuLabel className="truncate">
          {signedIn ? (displayName ?? t.atum.roster.assistant) : t.atum.account.signedOut}
        </DropdownMenuLabel>
        {account.account?.handle && displayName !== account.account.handle && (
          <DropdownMenuLabel className="truncate pt-0 text-[0.6875rem] font-normal text-(--ui-text-tertiary)">
            {account.account.handle}
          </DropdownMenuLabel>
        )}

        {/* Honest about a build that cannot sign in at all, instead of showing a
            dead "Sign in" item. */}
        {!account.configured && (
          <DropdownMenuLabel className="pt-0 text-[0.6875rem] font-normal text-(--ui-text-tertiary)">
            {t.dm.unavailable}
          </DropdownMenuLabel>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => navigate(SETTINGS_ROUTE)}>{t.atum.nav.settings}</DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t.atum.account.language}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup onValueChange={value => void setLocale(value as Locale)} value={locale}>
              {(Object.entries(LOCALE_META) as Array<[Locale, (typeof LOCALE_META)[Locale]]>).map(([code, meta]) => (
                <DropdownMenuRadioItem key={code} value={code}>
                  {meta.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t.atum.account.theme}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup onValueChange={value => setMode(value as 'dark' | 'light' | 'system')} value={mode}>
              <DropdownMenuRadioItem value="light">{t.settings.modeOptions.light.label}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t.settings.modeOptions.dark.label}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">{t.settings.modeOptions.system.label}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {account.configured && <DropdownMenuSeparator />}

        {account.configured &&
          (signedIn ? (
            <DropdownMenuItem onSelect={() => void signOutOfAtum()}>{t.dm.signOut}</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => navigate(ATUM_AUTH_ROUTE)}>{t.dm.signIn}</DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
