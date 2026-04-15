import { Play, Film } from 'lucide-react'
import { useLoopbackMediaUrl } from '../hooks/useLoopbackMediaUrl'

type Props = {
  /** Library scan sidecar path under data root, or null for placeholder only. */
  thumbRelPath: string | null
  /**
   * Direct image URL when there is no sidecar (e.g. loopback show/channel artwork).
   * Used after loopback resolution for `thumbRelPath` fails or when it is null.
   */
  fallbackImageUrl?: string | null
  /** Tailwind width class for the container (height = width * 9/16). */
  widthClassName: string
  /** Show a play overlay glyph on hover. */
  showPlayOverlay?: boolean
  /** Highlight ring + glow when this item is currently playing. */
  isActive?: boolean
}

/**
 * 16:9 video thumbnail with cinematic vignette, hover lift, and active glow.
 * All video thumbnails use widescreen -- no square/circle modes.
 */
export function MediaThumbSlot({
  thumbRelPath,
  fallbackImageUrl = null,
  widthClassName,
  showPlayOverlay = false,
  isActive = false
}: Props) {
  const loopbackUrl = useLoopbackMediaUrl(thumbRelPath)
  const url = loopbackUrl ?? (fallbackImageUrl && fallbackImageUrl.length > 0 ? fallbackImageUrl : null)

  return (
    <div
      className={`
        group/thumb relative shrink-0 overflow-hidden rounded-[6px]
        aspect-video ${widthClassName}
        transition-all duration-200 ease-out
        ${isActive
          ? 'ring-[1.5px] ring-accent/70'
          : 'ring-1 ring-white/[0.05] hover:ring-white/[0.1]'}
      `}
      style={isActive ? { boxShadow: '0 0 12px rgba(232,168,73,0.18), 0 0 4px rgba(232,168,73,0.10)' } : undefined}
    >
      {url ? (
        <>
          <img
            src={url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-[transform,filter] duration-300 ease-out group-hover/thumb:scale-105 group-hover/thumb:brightness-110"
            loading="lazy"
            decoding="async"
          />

          {/* Cinematic vignette: heavier at bottom, light at top */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `
                linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.08) 40%, transparent 70%),
                linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 20%)
              `
            }}
          />

          {/* Inset shadow for "screen" depth feel */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[6px]"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3)' }}
          />
        </>
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: 'linear-gradient(160deg, #18181e 0%, #111116 60%, #0d0d10 100%)'
          }}
        >
          <Film size={16} strokeWidth={1.3} className="text-text-muted/20" />
        </div>
      )}

      {/* Play hover overlay */}
      {showPlayOverlay && url && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100">
          <div className="absolute inset-0 bg-black/35" />
          <div
            className="relative flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm"
            style={{
              background: 'linear-gradient(135deg, rgba(232,168,73,0.95) 0%, rgba(212,137,58,0.95) 100%)',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5), 0 0 20px rgba(232,168,73,0.15)'
            }}
          >
            <Play size={11} className="ml-px text-[#08080a] fill-[#08080a]" />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Transport bar thumbnail for the currently playing track.
 * Square with rounded corners, deep shadow, inner highlight.
 */
export function TransportThumb({ posterUrl }: { posterUrl: string | null }) {
  if (!posterUrl) return null

  return (
    <div
      className="relative shrink-0 h-11 w-11 overflow-hidden rounded-lg ring-1 ring-white/[0.06]"
      style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3)' }}
    >
      <img
        src={posterUrl}
        alt=""
        className="h-full w-full object-cover"
        decoding="async"
      />
      {/* Inset highlight + vignette */}
      <div
        className="pointer-events-none absolute inset-0 rounded-lg"
        style={{
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.4)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 30%, rgba(0,0,0,0.15) 100%)'
        }}
      />
    </div>
  )
}
