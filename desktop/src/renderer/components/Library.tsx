import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { AlertCircle, ArrowLeft, Play, Plus, Film, Loader2, Search, X } from 'lucide-react'
import type { LibraryVideo } from '../../../shared/ytdl-api'
import type { LibraryVideoGroup } from '../hooks/useLibrary'
import {
  libraryItemDisplayTitle,
  libraryItemSortMs,
  parseLibraryRelPath
} from '../hooks/useLibrary'
import { MediaThumbSlot } from './MediaThumbSlot'
import { ChannelAvatar } from './ChannelAvatar'
import { RowDeleteButton } from './ui/row-delete-button'
import { iconCloseButtonClass } from './subscription-page-ui'

/**
 * Delay before a single row click queues, so a double-click (play) can cancel it.
 * Without this, the first click of a double-click queues the row and `playFrom*` then
 * merges that queue tail back in, leaving a duplicate of the just-started item in Queue.
 */
const ROW_QUEUE_CLICK_DELAY_MS = 250

/** True when a keydown carries Ctrl / Meta / Alt (leave OS / app chords alone). */
function hasCommandModifier(e: React.KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}

/** Sort a channel's items oldest → newest (upload date, else file mtime) and return rel paths. */
function chronologicalRels(items: readonly LibraryVideo[]): string[] {
  return [...items]
    .sort((a, b) => libraryItemSortMs(a) - libraryItemSortMs(b))
    .map((i) => i.relPath)
}

/** Danger banner for a failed library scan; dismiss hides it until the message changes. */
function ScanErrorBanner({
  message,
  onDismiss
}: {
  message: string
  onDismiss: () => void
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg bg-danger-dim border border-danger/20 px-3 py-2 text-danger"
    >
      <AlertCircle size={14} className="shrink-0 mt-[3px]" aria-hidden />
      <div className="flex-1 min-w-0 text-xs leading-relaxed">
        <span className="font-semibold">Library scan failed. </span>
        <span className="break-words">{message}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className={`${iconCloseButtonClass} -my-1 -mr-1.5 shrink-0`}
        aria-label="Dismiss scan error"
        title="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  )
}

/** Human-friendly relative time label (used when no `.info.json` upload date). */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

/** Format library-scan duration (seconds) as m:ss or h:mm:ss; null when unknown. */
function formatLibraryDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

const ROW_DATE_FMT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }

/** Right column: upload date from `.info.json` plus relative time since file was downloaded. */
function libraryRowTimeLabel(item: {
  uploadedAtMs: number | null
  mtimeMs: number
}): { uploadDate: string | null; downloadAge: string; title: string } {
  const downloadedAt = new Date(item.mtimeMs)
  const downloadAge = relativeTime(item.mtimeMs)
  const downloadedFull = downloadedAt.toLocaleString(undefined, ROW_DATE_FMT)

  if (item.uploadedAtMs != null) {
    const uploadedAt = new Date(item.uploadedAtMs)
    const uploadDate = uploadedAt.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
    const uploadedFull = uploadedAt.toLocaleString(undefined, ROW_DATE_FMT)
    return {
      uploadDate,
      downloadAge,
      title: `Uploaded ${uploadedFull}\nDownloaded ${downloadedFull} (${downloadAge})`
    }
  }

  return {
    uploadDate: null,
    downloadAge,
    title: `Downloaded ${downloadedFull} (no upload date in .info.json)`
  }
}

/**
 * Match library search against channel title/folder and per-item display title / filename / path.
 * Case-insensitive substring match.
 */
function itemMatchesSearch(item: LibraryVideo, queryLower: string, group: LibraryVideoGroup): boolean {
  if (group.title.toLowerCase().includes(queryLower)) return true
  if (group.channelFolder.toLowerCase().includes(queryLower)) return true
  const title = libraryItemDisplayTitle(item).toLowerCase()
  if (title.includes(queryLower)) return true
  const { fileName } = parseLibraryRelPath(item.relPath)
  if (fileName.toLowerCase().includes(queryLower)) return true
  if (item.relPath.toLowerCase().includes(queryLower)) return true
  return false
}

/**
 * Filter groups for the sticky search bar.
 * Channel-name hits keep the whole group; otherwise only matching rows remain.
 */
function filterLibraryGroups(groups: LibraryVideoGroup[], query: string): LibraryVideoGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  const out: LibraryVideoGroup[] = []
  for (const g of groups) {
    const channelHit =
      g.title.toLowerCase().includes(q) || g.channelFolder.toLowerCase().includes(q)
    if (channelHit) {
      out.push(g)
      continue
    }
    const items = g.items.filter((item) => itemMatchesSearch(item, q, g))
    if (items.length > 0) out.push({ ...g, items })
  }
  console.log('[Library] search filter', {
    query: q,
    groupsIn: groups.length,
    groupsOut: out.length,
    itemsOut: out.reduce((n, g) => n + g.items.length, 0)
  })
  return out
}

type Props = {
  groups: LibraryVideoGroup[]
  currentRel: string | null
  onQueue: (relPath: string) => void
  /** Main library double-click: global scan order (newest-first slice). */
  onPlayFrom: (relPath: string) => void
  /**
   * Channel detail double-click: play `orderedRels` from `startRel` (chronological within channel).
   * Prefer `.info.json` upload time via {@link libraryItemSortMs}, else file mtime.
   */
  onPlayFromOrdered: (orderedRels: string[], startRel: string) => void
  /** Permanently delete one file. The row button confirms first. */
  onDelete: (relPath: string) => void
  isEmpty: boolean
  /** True until the first library scan completes; empty list shows a loading state instead of "No videos yet". */
  scanning?: boolean
  /** Last library scan error message; shown as a danger banner above the list. */
  scanError?: string | null
}

/**
 * One media row: click queues (deferred so double-click can cancel), double-click plays.
 * Keyboard: Enter plays, `q` (or Space when not consumed by global play/pause) queues.
 */
function LibraryMediaRow({
  item,
  group,
  currentRel,
  onQueue,
  onPlay,
  onDelete
}: {
  item: LibraryVideo
  group: LibraryVideoGroup
  currentRel: string | null
  onQueue: (relPath: string) => void
  onPlay: (relPath: string) => void
  onDelete: (relPath: string) => void
}): React.ReactElement {
  const label = libraryItemDisplayTitle(item)
  const rowTime = libraryRowTimeLabel(item)
  const durationLabel = formatLibraryDuration(item.duration)
  const isActive = item.relPath === currentRel
  /** Pending single-click queue timer (cancelled by a double-click). */
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drop a pending queue on unmount (e.g. row deleted / view switched) so it never targets a stale row.
  useEffect(
    () => () => {
      if (queueTimerRef.current != null) {
        clearTimeout(queueTimerRef.current)
        queueTimerRef.current = null
        console.info('[Library] row unmounted; pending click-queue cancelled', item.relPath)
      }
    },
    [item.relPath]
  )

  /** Cancel a pending deferred queue; returns true when one was pending. */
  const cancelPendingQueue = (): boolean => {
    if (queueTimerRef.current == null) return false
    clearTimeout(queueTimerRef.current)
    queueTimerRef.current = null
    return true
  }

  /** Single click: queue after a short delay unless a double-click follows. */
  const handleClick = (e: React.MouseEvent<HTMLLIElement>): void => {
    // Second click of a double-click: the dblclick handler owns this gesture.
    if (e.detail > 1) {
      console.info('[Library] row repeat click ignored (double-click in progress)', {
        relPath: item.relPath,
        detail: e.detail
      })
      return
    }
    cancelPendingQueue()
    queueTimerRef.current = setTimeout(() => {
      queueTimerRef.current = null
      console.info('[Library] row click → queue', item.relPath)
      onQueue(item.relPath)
    }, ROW_QUEUE_CLICK_DELAY_MS)
  }

  /** Double click: play now; cancels the first click's pending queue to avoid a duplicate. */
  const handleDoubleClick = (): void => {
    const cancelled = cancelPendingQueue()
    console.info('[Library] row double-click → play', {
      relPath: item.relPath,
      cancelledPendingQueue: cancelled
    })
    onPlay(item.relPath)
  }

  /** Keyboard: Enter = play, `q` / Space = queue (immediate; no double-click ambiguity). */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLLIElement>): void => {
    // Keys from nested controls (delete button) are not row actions.
    if (e.target !== e.currentTarget) return
    if (e.repeat || hasCommandModifier(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      cancelPendingQueue()
      console.info('[Library] row Enter → play', item.relPath)
      onPlay(item.relPath)
      return
    }
    const isSpace = e.key === ' ' || e.code === 'Space'
    if (isSpace && e.defaultPrevented) {
      // Global Space shortcut (usePlayback capture listener) already toggled play/pause.
      console.info('[Library] row Space consumed by global play/pause; not queueing', item.relPath)
      return
    }
    if (isSpace || e.key === 'q' || e.key === 'Q') {
      e.preventDefault()
      cancelPendingQueue()
      console.info('[Library] row key → queue', { relPath: item.relPath, key: e.key })
      onQueue(item.relPath)
    }
  }

  return (
    <li
      className={`
        group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all duration-120
        outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60
        ${isActive ? 'now-playing-glow bg-accent-dim/30' : 'hover:bg-surface-raised/60 focus-visible:bg-surface-raised/60'}
      `}
      tabIndex={0}
      role="button"
      aria-label={isActive ? `${label} (now playing)` : label}
      aria-current={isActive ? 'true' : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      title={`${item.relPath}\nClick or Q to queue · Double-click or Enter to play`}
    >
      <MediaThumbSlot
        thumbRelPath={item.thumbRelPath}
        fallbackImageUrl={group.logoUrl}
        widthClassName="w-20"
        showPlayOverlay={!isActive}
        isActive={isActive}
      />
      {/* Play indicator or queue icon */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        {isActive ? (
          <Play size={13} className="text-accent fill-accent" />
        ) : (
          <Plus
            size={13}
            className="text-text-muted opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70 transition-opacity duration-150"
            aria-hidden
          />
        )}
      </div>

      <span
        className={`flex-1 min-w-0 text-[11px] truncate leading-tight ${isActive ? 'text-accent' : 'text-text-secondary group-hover:text-text group-focus-visible:text-text'}`}
        title={label}
      >
        {label}
      </span>
      {durationLabel != null ? (
        <span
          className="text-[10px] text-text-muted tabular-nums font-mono shrink-0"
          title={`Duration ${durationLabel}`}
        >
          {durationLabel}
        </span>
      ) : null}
      <div
        className="flex flex-col items-end gap-0.5 shrink-0 max-w-[10.5rem] text-right leading-tight"
        title={rowTime.title}
      >
        {rowTime.uploadDate != null ? (
          <span className="text-[10px] text-text-muted tabular-nums font-mono truncate max-w-full">
            {rowTime.uploadDate}
          </span>
        ) : null}
        <span className="text-[10px] text-text-muted tabular-nums font-mono truncate max-w-full">
          {rowTime.downloadAge}
        </span>
      </div>
      <RowDeleteButton
        label={item.relPath}
        onConfirm={() => {
          console.info('[Library] delete confirmed', item.relPath)
          void onDelete(item.relPath)
        }}
      />
    </li>
  )
}

/** Library page: sticky search, channel groups, and optional channel detail sub-view. */
export default function LibraryPage({
  groups,
  currentRel,
  onQueue,
  onPlayFrom,
  onPlayFromOrdered,
  onDelete,
  isEmpty,
  scanning = false,
  scanError = null
}: Props) {
  /** Sticky search query (filters filename, channel name, display title). */
  const [searchQuery, setSearchQuery] = useState('')
  /** Scan error message the user dismissed; a different message shows the banner again. */
  const [dismissedScanError, setDismissedScanError] = useState<string | null>(null)
  /** Banner text when a scan error is present and not dismissed. */
  const visibleScanError = scanError && scanError !== dismissedScanError ? scanError : null

  // Surface scan state transitions in the console for debugging startup / rescans.
  useEffect(() => {
    console.info('[Library] scan state', { scanning, isEmpty, hasError: scanError != null })
  }, [scanning, isEmpty, scanError])
  /** When set, show only that channel's media (detail page). */
  const [channelGroupKey, setChannelGroupKey] = useState<string | null>(null)
  /** Scrollable file list under the sticky chrome. */
  const listScrollRef = useRef<HTMLDivElement>(null)
  /** Library-list `scrollTop` captured when opening a channel (restored on Back). */
  const savedLibraryScrollTopRef = useRef(0)
  /** When set, the next library-list layout should restore this `scrollTop`. */
  const pendingRestoreScrollTopRef = useRef<number | null>(null)
  /** Skip group enter animation on Back so the restored scroll offset stays visually stable. */
  const skipListEnterAnimationRef = useRef(false)

  /** Resolve the open channel from the full (unfiltered) group list. */
  const channelGroup = useMemo(() => {
    if (!channelGroupKey) return null
    return groups.find((g) => g.groupKey === channelGroupKey) ?? null
  }, [groups, channelGroupKey])

  // Drop stale channel detail if the group disappeared (e.g. last file deleted).
  useEffect(() => {
    if (channelGroupKey && !channelGroup) {
      console.info('[Library] channel detail group missing; returning to library', {
        channelGroupKey
      })
      pendingRestoreScrollTopRef.current = savedLibraryScrollTopRef.current
      skipListEnterAnimationRef.current = true
      setChannelGroupKey(null)
    }
  }, [channelGroupKey, channelGroup])

  /**
   * After channel detail opens, start that file list at the top.
   * After Back, restore the library list to the saved scroll offset (same files in view).
   */
  useLayoutEffect(() => {
    const el = listScrollRef.current
    if (!el) return
    if (channelGroupKey != null) {
      el.scrollTop = 0
      console.info('[Library] channel detail list scrolled to top', { channelGroupKey })
      return
    }
    const pending = pendingRestoreScrollTopRef.current
    if (pending == null) return
    pendingRestoreScrollTopRef.current = null
    skipListEnterAnimationRef.current = false
    el.scrollTop = pending
    console.info('[Library] restored library list scroll', { scrollTop: pending })
    // Re-apply after paint in case group remount / motion layout shifts height.
    requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = pending
        console.info('[Library] re-applied library list scroll after paint', { scrollTop: pending })
      }
    })
  }, [channelGroupKey])

  /** Groups shown in the scroll list (search-filtered; single group on channel page). */
  const visibleGroups = useMemo(() => {
    const base = channelGroup ? [channelGroup] : groups
    return filterLibraryGroups(base, searchQuery)
  }, [channelGroup, groups, searchQuery])

  /** Total video count badge (respects current filter / channel view). */
  const totalVideos = useMemo(
    () => visibleGroups.reduce((n, g) => n + g.items.length, 0),
    [visibleGroups]
  )

  /** Open channel detail from a sticky group header click. */
  const openChannel = (groupKey: string, title: string): void => {
    const scrollTop = listScrollRef.current?.scrollTop ?? 0
    savedLibraryScrollTopRef.current = scrollTop
    pendingRestoreScrollTopRef.current = null
    skipListEnterAnimationRef.current = false
    console.info('[Library] open channel detail', { groupKey, title, savedScrollTop: scrollTop })
    setChannelGroupKey(groupKey)
    // Keep search so users can refine within the channel; clear noise if empty-looking.
  }

  /** Leave channel detail and return to the full library at the same list offset. */
  const goBackToLibrary = (): void => {
    const restoreTo = savedLibraryScrollTopRef.current
    pendingRestoreScrollTopRef.current = restoreTo
    skipListEnterAnimationRef.current = true
    console.info('[Library] back from channel detail', { channelGroupKey, restoreScrollTop: restoreTo })
    setChannelGroupKey(null)
  }

  /**
   * Double-click play on channel detail: chronological within that channel only
   * (earliest upload/mtime → newest), starting at the clicked row.
   */
  const playFromChannelItem = (relPath: string): void => {
    if (!channelGroup) {
      console.warn('[Library] playFromChannelItem without channelGroup; falling back to library play')
      onPlayFrom(relPath)
      return
    }
    // Full channel list (not search-filtered) so Up next stays complete for the show.
    // Full channel list (not search-filtered) so Up next stays complete for the show.
    const orderedRels = chronologicalRels(channelGroup.items)
    const withUpload = channelGroup.items.filter((i) => i.uploadedAtMs != null).length
    console.info('[Library] channel chronological play', {
      groupKey: channelGroup.groupKey,
      startRel: relPath,
      count: orderedRels.length,
      withUploadDate: withUpload,
      sortHint: 'uploadedAtMs ?? mtimeMs, ascending (oldest first)'
    })
    onPlayFromOrdered(orderedRels, relPath)
  }

  /**
   * Keyboard "play channel" from a group header: whole channel (unfiltered),
   * oldest → newest, starting at the earliest item.
   */
  const playWholeChannel = (groupKey: string): void => {
    const full = groups.find((g) => g.groupKey === groupKey)
    if (!full || full.items.length === 0) {
      console.warn('[Library] playWholeChannel: group missing or empty', { groupKey })
      return
    }
    const orderedRels = chronologicalRels(full.items)
    console.info('[Library] header play channel (chronological)', {
      groupKey,
      count: orderedRels.length,
      startRel: orderedRels[0]
    })
    onPlayFromOrdered(orderedRels, orderedRels[0])
  }

  /** Dismiss the current scan error banner (until a new message arrives). */
  const dismissScanError = (): void => {
    console.info('[Library] scan error banner dismissed')
    setDismissedScanError(scanError)
  }

  if (isEmpty) {
    return (
      <div className="flex flex-col h-full">
        {visibleScanError ? (
          <div className="px-6 pt-4 shrink-0">
            <ScanErrorBanner message={visibleScanError} onDismiss={dismissScanError} />
          </div>
        ) : null}
        {scanning ? (
          // First scan still running: calm loading state instead of the "No videos yet" prompt.
          <div
            className="flex flex-col items-center justify-center flex-1 gap-3 text-text-muted px-8"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={22} className="animate-spin text-accent/70" aria-hidden />
            <p className="text-sm text-text-secondary">Scanning library…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-5 text-text-muted px-8">
            <div className="empty-state-icon">
              <Film size={32} strokeWidth={1.2} className="text-accent/50" aria-hidden />
            </div>
            <div className="text-center space-y-2">
              <p className="text-base font-semibold text-text-secondary">No videos yet</p>
              <p className="text-sm text-text-muted max-w-xs leading-relaxed">
                Choose a data folder and download some channels to get started.
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  const inChannelDetail = channelGroup != null
  const searchTrimmed = searchQuery.trim()

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sticky chrome: title + search stay fixed while the list scrolls underneath */}
      <div className="shrink-0 border-b border-border bg-bg/95 backdrop-blur-md z-20">
        <div className="flex items-center gap-3 px-6 pt-4 pb-2">
          {inChannelDetail ? (
            <>
              <button
                type="button"
                onClick={goBackToLibrary}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border text-text-secondary hover:text-text hover:border-border-bright transition-all duration-150 shrink-0"
                title="Back to library"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <ChannelAvatar
                src={channelGroup.logoUrl}
                name={channelGroup.title}
                size="md"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <h1 className="text-lg font-bold tracking-tight truncate">{channelGroup.title}</h1>
                <span className="text-[11px] text-text-muted">
                  {channelGroup.items.length} file{channelGroup.items.length !== 1 ? 's' : ''}
                  {' · '}
                  play order: oldest → newest
                </span>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold tracking-tight">Library</h1>
              <span className="section-pill">
                {totalVideos} video{totalVideos !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>

        {/* Sticky search bar */}
        <div className="flex items-center gap-2 px-6 pb-3">
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            {/* type=text (not search) so Chromium does not draw a second native clear “X” */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                const next = e.target.value
                setSearchQuery(next)
                console.log('[Library] search query changed', { length: next.length })
              }}
              onKeyDown={(e) => {
                // Escape clears a non-empty query; an empty field lets Escape bubble as usual.
                if (e.key === 'Escape' && searchQuery.length > 0) {
                  e.preventDefault()
                  e.stopPropagation()
                  console.log('[Library] search cleared via Escape')
                  setSearchQuery('')
                }
              }}
              placeholder={
                inChannelDetail
                  ? `Search in ${channelGroup.title}…`
                  : 'Search titles, channels, filenames…'
              }
              className="w-full text-sm py-2 pl-9 pr-9 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/30 transition-all duration-150"
              aria-label="Search library"
            />
            {searchTrimmed ? (
              <button
                type="button"
                onClick={() => {
                  console.log('[Library] clear search')
                  setSearchQuery('')
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-muted hover:text-text transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Scrollable channel groups (under sticky chrome) */}
      <div ref={listScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {visibleScanError ? (
          <ScanErrorBanner message={visibleScanError} onDismiss={dismissScanError} />
        ) : null}
        {visibleGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-text-muted px-6">
            <p className="text-sm font-medium text-text-secondary">No matches</p>
            <p className="text-xs text-center max-w-sm">
              Nothing matched “{searchTrimmed}”. Try another title, channel, or filename.
            </p>
          </div>
        ) : (
          visibleGroups.map((group, gi) => (
            <motion.div
              key={group.groupKey}
              initial={skipListEnterAnimationRef.current ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(gi * 0.04, 0.4), ease: [0.22, 0.61, 0.36, 1] }}
              className="card-interactive rounded-xl border border-border bg-surface overflow-hidden"
            >
              {/* Channel header: sticky within scroll; click opens detail (unless already there) */}
              <div
                className={`
                  sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-surface-raised/80 backdrop-blur-md border-b border-border
                  ${inChannelDetail ? '' : 'cursor-pointer hover:bg-surface-raised transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60'}
                `}
                onClick={
                  inChannelDetail
                    ? undefined
                    : () => openChannel(group.groupKey, group.title)
                }
                onKeyDown={
                  inChannelDetail
                    ? undefined
                    : (e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.repeat || hasCommandModifier(e)) return
                        // Shift+Enter or `p`: play this channel oldest → newest.
                        if ((e.key === 'Enter' && e.shiftKey) || e.key === 'p' || e.key === 'P') {
                          e.preventDefault()
                          playWholeChannel(group.groupKey)
                          return
                        }
                        // Enter: open channel detail (same as click).
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          console.info('[Library] header Enter → open channel', group.groupKey)
                          openChannel(group.groupKey, group.title)
                        }
                      }
                }
                tabIndex={inChannelDetail ? undefined : 0}
                aria-label={
                  inChannelDetail
                    ? undefined
                    : `${group.title}, ${group.items.length} file${group.items.length !== 1 ? 's' : ''}. Enter to open, P to play channel`
                }
                title={inChannelDetail ? undefined : `Open ${group.title}\nShift+Enter or P plays the channel oldest → newest`}
                role={inChannelDetail ? undefined : 'button'}
              >
                <ChannelAvatar src={group.logoUrl} name={group.title} size="md" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold truncate">{group.title}</span>
                  <span className="text-[11px] text-text-muted">
                    {group.items.length} file{group.items.length !== 1 ? 's' : ''}
                    {!inChannelDetail ? ' · click for channel' : ''}
                  </span>
                </div>
              </div>

              {/* File list */}
              <ul className="divide-y divide-border">
                {group.items.map((item) => (
                  <LibraryMediaRow
                    key={item.relPath}
                    item={item}
                    group={group}
                    currentRel={currentRel}
                    onQueue={onQueue}
                    onPlay={inChannelDetail ? playFromChannelItem : onPlayFrom}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}
