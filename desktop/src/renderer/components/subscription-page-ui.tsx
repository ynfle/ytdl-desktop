import { type ReactNode, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { Loader2, RefreshCw } from 'lucide-react'

/** Shared Tailwind for Channels / Podcasts "Look up" rows and metadata toolbars. */
export const subPageLookUpInputClass =
  'flex-1 min-w-[200px] text-sm px-3 py-2 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/30 disabled:opacity-50 transition-all duration-150'

export const subPageLookUpButtonClass =
  'inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg border border-border bg-surface-raised text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150'

export const subPageToolbarBtnNeutralClass =
  'inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-border bg-surface-raised text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150'

export const subPageToolbarBtnAccentClass =
  'inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-accent/20 text-accent hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150'

/** Filled amber CTA (e.g. "Add channel" after a successful Look up); gradient lives in `main.css`. */
export const subPagePrimaryButtonClass =
  'inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg text-bg bg-accent-gradient disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150'

/** Bordered secondary action (e.g. "Back" out of an add preview). */
export const subPageSecondaryButtonClass = subPageLookUpButtonClass

/** Card wrapping the add / look-up flow on subscription pages. */
export const subPageAddCardClass = 'rounded-xl border border-border bg-surface-raised/60 p-4 space-y-3'

/** Ghost icon button used in table rows (open in browser, etc.). */
export const subPageRowIconButtonClass =
  'p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-all duration-150'

/** Square icon-only close button for drawers and modals (Queue, Settings). */
export const iconCloseButtonClass =
  'w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised transition-colors'

/** Shared single-line truncation for identifier / title cells so all three tables clip at the same width. */
export const subPageCellTruncateClass = 'truncate block max-w-[220px]'

/** Max characters shown for a row error before ellipsis (full text stays in `title`). */
const FRIENDLY_ROW_ERROR_MAX = 80

/**
 * Shorten a raw yt-dlp / IPC error for a table status cell.
 * Keeps the first non-empty line, strips `ERROR:` / `WARNING:` and `[extractor]` prefixes
 * (plus the bare `id:` token yt-dlp prints after the extractor tag), then clamps to ~80 chars.
 * Pure: safe to call during render.
 */
export function friendlyRowError(raw: string): string {
  // First non-empty line only; yt-dlp often appends multi-line hints / tracebacks.
  const firstLine =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  let text = firstLine
  let strippedExtractor = false
  // Peel stacked prefixes like `ERROR: [youtube:tab] ` until none remain.
  for (;;) {
    const level = text.match(/^(ERROR|WARNING|Error)\s*:\s*/)
    if (level) {
      text = text.slice(level[0].length)
      continue
    }
    const tag = text.match(/^\[[^\]]+\]\s*/)
    if (tag) {
      text = text.slice(tag[0].length)
      strippedExtractor = true
      continue
    }
    break
  }
  // After `[youtube] dQw4w9WgXcQ: Video unavailable`, drop the single-token id before the colon.
  if (strippedExtractor) {
    const idPrefix = text.match(/^\S+:\s+/)
    if (idPrefix && idPrefix[0].length < text.length) text = text.slice(idPrefix[0].length)
  }
  text = text.trim()
  if (!text) return 'Error'
  // Clamp with a single-character ellipsis so the cell stays one or two lines.
  return text.length > FRIENDLY_ROW_ERROR_MAX ? `${text.slice(0, FRIENDLY_ROW_ERROR_MAX - 1).trimEnd()}\u2026` : text
}

type SubscriptionRowStatusProps = {
  /** Resolved name/title; null until metadata resolves. */
  displayName: string | null
  /** Raw error from resolve (yt-dlp stderr or IPC message), if any. */
  error: string | null
}

/**
 * Status cell for Channels / Playlists / Podcasts tables:
 * friendly error (full text in tooltip), green dot when resolved, otherwise muted "Pending".
 */
export function SubscriptionRowStatus({ displayName, error }: SubscriptionRowStatusProps): React.ReactElement {
  if (error) {
    return (
      <span className="text-[11px] text-danger line-clamp-2 max-w-[260px]" title={error}>
        {friendlyRowError(error)}
      </span>
    )
  }
  if (displayName) {
    return <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" title="resolved" aria-label="Resolved" />
  }
  // Not yet resolved (fresh line, or cache miss before Fetch).
  return <span className="text-[11px] text-text-muted">Pending</span>
}

type SubscriptionListLoadingProps = {
  /** Log prefix for the page (e.g. `[Channels]`), used once on mount. */
  logTag: string
}

/** Subtle placeholder shown until the first hydrate finishes, so the empty state does not flash. */
export function SubscriptionListLoading({ logTag }: SubscriptionListLoadingProps): React.ReactElement {
  useEffect(() => {
    console.info(`${logTag} list not loaded yet; showing loading state`)
  }, [logTag])
  return (
    <div
      className="flex items-center justify-center gap-2 h-full min-h-[280px] text-[11px] text-text-muted"
      role="status"
      aria-live="polite"
    >
      <Loader2 size={14} className="animate-spin" />
      Loading subscriptions&hellip;
    </div>
  )
}

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
        <RefreshCw size={12} />
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
      <span className="text-[10px] text-text-muted ml-auto font-mono">{statusHint}</span>
    </div>
  )
}

/** Default spinner for toolbar "fetch" busy state (12px to match icons). */
export function subscriptionToolbarFetchSpinner(): React.ReactElement {
  return <Loader2 size={12} className="animate-spin" />
}
