import { type ReactNode, useMemo } from 'react'
import { motion } from 'motion/react'
import { Loader2, RefreshCw } from 'lucide-react'

/** Shared Tailwind for Channels / Podcasts “Look up” rows and metadata toolbars. */
export const subPageLookUpInputClass =
  'flex-1 min-w-[200px] text-sm px-3 py-2 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50'

export const subPageLookUpButtonClass =
  'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border bg-bg text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

export const subPageToolbarBtnNeutralClass =
  'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-surface-raised text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

export const subPageToolbarBtnAccentClass =
  'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-accent-dim text-accent hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

/**
 * Same busy rules as main-process gates: sync + cross-type metadata resolve + add preview flows.
 * Keeps Channels and Podcasts pages aligned without merging their data hooks.
 */
export function useSubscriptionPageLocks(
  busy: boolean,
  podcastsBusy: boolean,
  channelsBusy: boolean,
  addPreviewLoading: boolean,
  addConfirmBusy: boolean,
  playlistsBusy = false,
  playlistAddPreviewLoading = false,
  playlistAddConfirmBusy = false,
  channelsAddPreviewLoading = false,
  channelsAddConfirmBusy = false
): { anyBusy: boolean; addInteractionLocked: boolean } {
  return useMemo(() => {
    const locked =
      busy ||
      podcastsBusy ||
      channelsBusy ||
      playlistsBusy ||
      addPreviewLoading ||
      addConfirmBusy ||
      playlistAddPreviewLoading ||
      playlistAddConfirmBusy ||
      channelsAddPreviewLoading ||
      channelsAddConfirmBusy
    return { anyBusy: locked, addInteractionLocked: locked }
  }, [
    busy,
    podcastsBusy,
    channelsBusy,
    playlistsBusy,
    addPreviewLoading,
    addConfirmBusy,
    playlistAddPreviewLoading,
    playlistAddConfirmBusy,
    channelsAddPreviewLoading,
    channelsAddConfirmBusy
  ])
}

/** Parse `channels:resolveProgress` / `podcasts:resolveProgress` text like `3/12`. */
export function parseResolveProgressFraction(progress: string | null): number {
  if (!progress) return 0
  const m = progress.match(/^(\d+)\/(\d+)/)
  if (!m) return 0
  const cur = Number(m[1])
  const total = Number(m[2])
  return total > 0 ? cur / total : 0
}

type SubscriptionResolveProgressBarProps = {
  active: boolean
  progress: string | null
}

export function SubscriptionResolveProgressBar({
  active,
  progress
}: SubscriptionResolveProgressBarProps): React.ReactElement | null {
  const fraction = parseResolveProgressFraction(progress)
  if (!active) return null
  return (
    <div className="progress-track">
      <motion.div
        className="progress-fill"
        initial={{ width: 0 }}
        animate={{ width: `${fraction * 100}%` }}
      />
    </div>
  )
}

type SubscriptionMetadataToolbarProps = {
  anyBusy: boolean
  onReload: () => void
  onFetch: () => void
  onRefetchAll: () => void
  fetchBusy: boolean
  fetchIcon: ReactNode
  fetchIconBusy: ReactNode
  fetchLabel: string
  /** Right-aligned hint (idle vs busy line built by parent). */
  statusHint: string
}

export function SubscriptionMetadataToolbar({
  anyBusy,
  onReload,
  onFetch,
  onRefetchAll,
  fetchBusy,
  fetchIcon,
  fetchIconBusy,
  fetchLabel,
  statusHint
}: SubscriptionMetadataToolbarProps): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onReload}
        disabled={anyBusy}
        className={subPageToolbarBtnNeutralClass}
      >
        <RefreshCw size={13} />
        Reload list
      </button>
      <button
        type="button"
        onClick={onFetch}
        disabled={anyBusy}
        className={subPageToolbarBtnNeutralClass}
      >
        {fetchBusy ? fetchIconBusy : fetchIcon}
        {fetchLabel}
      </button>
      <button
        type="button"
        onClick={onRefetchAll}
        disabled={anyBusy}
        className={subPageToolbarBtnAccentClass}
      >
        Refetch all
      </button>
      <span className="text-[11px] text-text-muted ml-auto">{statusHint}</span>
    </div>
  )
}

/** Default spinner for toolbar “fetch” busy state (13px to match icons). */
export function subscriptionToolbarFetchSpinner(): React.ReactElement {
  return <Loader2 size={13} className="animate-spin" />
}
