import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Play, Plus, Film, Trash2, Search, X } from 'lucide-react'
import type { LibraryVideo } from '../../../shared/ytdl-api'
import type { LibraryVideoGroup } from '../hooks/useLibrary'
import {
  libraryItemDisplayTitle,
  libraryItemSortMs,
  parseLibraryRelPath
} from '../hooks/useLibrary'
import { MediaThumbSlot } from './MediaThumbSlot'
import { ChannelAvatar } from './ChannelAvatar'

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
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null
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
  /** Remove file from disk (caller confirms). */
  onDelete: (relPath: string) => void
  isEmpty: boolean
}

/** One media row: click queues, double-click plays (handler from parent context). */
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
  return (
    <li
      className={`
        group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all duration-120
        ${isActive ? 'now-playing-glow bg-accent-dim/30' : 'hover:bg-surface-raised/60'}
      `}
      onClick={() => onQueue(item.relPath)}
      onDoubleClick={() => onPlay(item.relPath)}
      title={item.relPath}
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
            className="text-text-muted opacity-0 group-hover:opacity-70 transition-opacity duration-150"
          />
        )}
      </div>

      <span
        className={`flex-1 text-[11px] truncate leading-tight ${isActive ? 'text-accent' : 'text-text-secondary group-hover:text-text'}`}
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
        className="flex flex-col items-end gap-0.5 shrink-0 max-w-[8.5rem] text-right leading-tight"
        title={rowTime.title}
      >
        {rowTime.uploadDate != null ? (
          <span className="text-[10px] text-text-muted tabular-nums font-mono truncate max-w-full">
            {rowTime.uploadDate}
          </span>
        ) : null}
        <span className="text-[10px] text-text-muted/80 tabular-nums font-mono truncate max-w-full">
          {rowTime.downloadAge}
        </span>
      </div>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void onDelete(item.relPath)
        }}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger-dim transition-all shrink-0"
        title="Delete from library"
      >
        <Trash2 size={12} />
      </button>
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
  isEmpty
}: Props) {
  /** Sticky search query (filters filename, channel name, display title). */
  const [searchQuery, setSearchQuery] = useState('')
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
    const chronological = [...channelGroup.items].sort(
      (a, b) => libraryItemSortMs(a) - libraryItemSortMs(b)
    )
    const orderedRels = chronological.map((i) => i.relPath)
    const withUpload = chronological.filter((i) => i.uploadedAtMs != null).length
    console.info('[Library] channel chronological play', {
      groupKey: channelGroup.groupKey,
      startRel: relPath,
      count: orderedRels.length,
      withUploadDate: withUpload,
      sortHint: 'uploadedAtMs ?? mtimeMs, ascending (oldest first)'
    })
    onPlayFromOrdered(orderedRels, relPath)
  }

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-text-muted px-8">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(232, 168, 73, 0.08) 0%, rgba(232, 168, 73, 0.02) 100%)',
            border: '1px solid rgba(232, 168, 73, 0.1)'
          }}
        >
          <Film size={32} strokeWidth={1.2} className="text-accent/50" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-semibold text-text-secondary">No videos yet</p>
          <p className="text-sm text-text-muted max-w-xs leading-relaxed">
            Choose a data folder and download some channels to get started.
          </p>
        </div>
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
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-muted hover:text-text transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Scrollable channel groups (under sticky chrome) */}
      <div ref={listScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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
                  ${inChannelDetail ? '' : 'cursor-pointer hover:bg-surface-raised transition-colors'}
                `}
                onClick={
                  inChannelDetail
                    ? undefined
                    : () => openChannel(group.groupKey, group.title)
                }
                title={inChannelDetail ? undefined : `Open ${group.title}`}
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
