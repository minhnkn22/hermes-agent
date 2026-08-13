import { useStore } from '@nanostores/react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Palette } from '@/lib/icons'
import {
  $zoomPercent,
  normalizeTextSizeSliderPercent,
  setZoomPercent,
  TEXT_SIZE_MAX_PERCENT,
  TEXT_SIZE_MIN_PERCENT,
  TEXT_SIZE_STEP_PERCENT
} from '@/store/zoom'
import { useTheme } from '@/themes'

import { MODE_OPTIONS } from './constants'
import { ListRow, SectionHeading, SettingsContent } from './primitives'

/** The intentionally small, consumer-facing Atum settings home. */
export function AtumConsumerSettings() {
  const { isSavingLocale, t } = useI18n()
  const { mode, setMode } = useTheme()
  const zoomPercent = useStore($zoomPercent)
  const textSizePercent = normalizeTextSizeSliderPercent(zoomPercent)
  const copy = t.atum.settings
  const modeOptions = MODE_OPTIONS.map(({ id, icon }) => ({ icon, id, label: t.settings.modeOptions[id].label }))

  return (
    <SettingsContent>
      <SectionHeading icon={Palette} title={copy.title} />
      <p className="max-w-2xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {copy.description}
      </p>

      <div className="mt-3 divide-y divide-(--ui-stroke-tertiary)">
        <ListRow
          action={<LanguageSwitcher />}
          description={isSavingLocale ? t.language.saving : t.language.description}
          title={t.language.label}
        />

        <ListRow
          action={
            <div aria-label={copy.appearance} role="group">
              <SegmentedControl
                onChange={next => {
                  triggerHaptic('selection')
                  setMode(next)
                }}
                options={modeOptions}
                value={mode}
              />
            </div>
          }
          description={copy.appearanceDescription}
          title={copy.appearance}
        />

        <ListRow
          action={
            <div className="flex min-w-56 items-center gap-3">
              <span aria-hidden className="text-xs text-(--ui-text-tertiary)">
                A
              </span>
              <input
                aria-label={copy.textSize}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-(--ui-stroke-tertiary)"
                max={TEXT_SIZE_MAX_PERCENT}
                min={TEXT_SIZE_MIN_PERCENT}
                onChange={event => setZoomPercent(Number(event.target.value))}
                step={TEXT_SIZE_STEP_PERCENT}
                style={{ accentColor: 'var(--dt-primary)' }}
                type="range"
                value={textSizePercent}
              />
              <span aria-hidden className="text-base text-(--ui-text-secondary)">
                A
              </span>
              <output className="w-10 text-right text-[length:var(--conversation-caption-font-size)] tabular-nums text-(--ui-text-tertiary)">
                {textSizePercent}%
              </output>
            </div>
          }
          description={copy.textSizeDescription}
          title={copy.textSize}
        />
      </div>
    </SettingsContent>
  )
}
