/**
 * Circular avatar for channels, playlists, and podcasts.
 * The container is always square (equal w/h) with `rounded-full` + `overflow-hidden`,
 * and the image uses `object-cover`, so non-square art is center-cropped into a true
 * circle instead of being stretched into an oval.
 */

type Size = 'sm' | 'md' | 'lg'

/** Square dimensions + full radius per preset; w and h must stay equal to keep the mask circular. */
const SIZE_CLASSES: Record<Size, string> = {
  sm: 'w-7 h-7 rounded-full text-[10px]',
  md: 'w-8 h-8 rounded-full text-[11px]',
  lg: 'w-14 h-14 rounded-full text-base'
}

type Props = {
  /** Loopback URL (already resolved), or null/undefined for placeholder. */
  src: string | null | undefined
  /** Display name — first letter used as placeholder when no image. */
  name?: string | null
  /** Size preset. */
  size?: Size
}

/** Pick a deterministic hue from a name for the placeholder gradient. */
function nameHue(name: string | null | undefined): number {
  if (!name) return 30
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return h % 360
}

export function ChannelAvatar({ src, name, size = 'md' }: Props) {
  const sizeClass = SIZE_CLASSES[size]
  const letter = name?.trim().charAt(0).toUpperCase() ?? ''
  const hue = nameHue(name)

  return (
    <div
      className={`
        shrink-0 overflow-hidden ${sizeClass}
        ring-1 ring-white/[0.06]
      `}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-bold text-white/70 select-none"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 40% 22%) 0%, hsl(${hue} 30% 14%) 100%)`
          }}
        >
          {letter}
        </div>
      )}
    </div>
  )
}
