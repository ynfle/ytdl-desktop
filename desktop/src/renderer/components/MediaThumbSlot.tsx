import { useLoopbackMediaUrl } from '../hooks/useLoopbackMediaUrl'

type Props = {
  /** Library scan sidecar path under data root, or null for placeholder only. */
  thumbRelPath: string | null
  /** Tailwind size classes for the fixed frame (e.g. `h-12 w-12`). */
  boxClassName: string
}

/** Small cover art from loopback URL; muted placeholder when missing or resolve fails. */
export function MediaThumbSlot({ thumbRelPath, boxClassName }: Props) {
  const url = useLoopbackMediaUrl(thumbRelPath)
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-md border border-border bg-surface-overlay ${boxClassName}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="h-full w-full bg-surface-overlay" aria-hidden />
      )}
    </div>
  )
}
