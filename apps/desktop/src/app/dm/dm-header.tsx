import { StatusDot, type StatusTone } from '@/components/status-dot'

interface DmHeaderProps {
  statusLabel: string | null
  title: string
  tone: StatusTone
}

export function DmHeader({ statusLabel, title, tone }: DmHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-(--ui-border) px-5">
      <span className="grid size-8 place-items-center rounded-full bg-primary/12 font-semibold text-primary">
        {title.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {statusLabel && (
          <span className="flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-tertiary)">
            <StatusDot tone={tone} /> {statusLabel}
          </span>
        )}
      </span>
    </header>
  )
}
