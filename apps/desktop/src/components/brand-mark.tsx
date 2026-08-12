import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Brand badge: the Atum mark on its own full-bleed dark tile. The old white
// wrapper made the mark look like a small icon pasted into a generic app-icon
// container — especially obvious in Launchpad and the full-window auth gate.
// Size via className (default size-14).
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#141311]',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-cover" src={assetPath('atum-mark.svg')} />
    </span>
  )
}
