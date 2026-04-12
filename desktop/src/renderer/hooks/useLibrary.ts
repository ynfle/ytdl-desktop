import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChannelInfoRow, LibraryVideo, PodcastInfoRow } from '../../../shared/ytdl-api'

/* ── Helpers ── */

/** Split a library relPath into grouping key, folder label, and file name. */
function parseLibraryRelPath(relPath: string): {
  groupKey: string
  channelFolder: string
  fileName: string
} {
  const parts = relPath.split('/').filter(Boolean)
  const fileName = parts.length > 0 ? parts[parts.length - 1]! : relPath
  // New layout: videos/rec/<channel>/file
  if (parts.length >= 4 && parts[0] === 'videos' && parts[1] === 'rec') {
    return { groupKey: `rec/${parts[2]!}`, channelFolder: parts[2]!, fileName }
  }
  // Podcast episodes: videos/podcasts/<folderId>/file.ext
  if (parts.length >= 4 && parts[0] === 'videos' && parts[1] === 'podcasts') {
    const folderId = parts[2]!
    return { groupKey: `podcast/${folderId}`, channelFolder: folderId, fileName }
  }
  // New layout: videos/<uploader>/file
  if (parts.length >= 3 && parts[0] === 'videos' && parts[1] !== 'rec') {
    return { groupKey: parts[1]!, channelFolder: parts[1]!, fileName }
  }
  // Loose file directly under videos/
  if (parts.length === 2 && parts[0] === 'videos') {
    return { groupKey: '__root__', channelFolder: 'videos', fileName }
  }
  // Legacy: rec/<channel>/file at data root
  if (parts.length >= 3 && parts[0] === 'rec') {
    return { groupKey: `rec/${parts[1]!}`, channelFolder: parts[1]!, fileName }
  }
  // Legacy: <uploader>/file at data root
  if (parts.length >= 2) {
    return { groupKey: parts[0]!, channelFolder: parts[0]!, fileName }
  }
  return { groupKey: '__root__', channelFolder: parts[0] ?? relPath, fileName }
}
export { parseLibraryRelPath }

function normFolder(s: string): string {
  return s.toLowerCase().replace(/_+/g, ' ').trim()
}

function slugFolder(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Map on-disk folder (yt-dlp uploader dir) to a channels.txt row for title + avatar. */
function channelRowForFolder(
  rows: ChannelInfoRow[],
  channelFolder: string
): ChannelInfoRow | undefined {
  const f = normFolder(channelFolder)
  const fSlug = slugFolder(channelFolder)
  if (!fSlug) return undefined
  for (const r of rows) {
    if (r.displayName && normFolder(r.displayName) === f) return r
    const id = r.identifier.trim()
    const idNoAt = id.startsWith('@') ? id.slice(1) : id
    if (normFolder(idNoAt) === f || slugFolder(idNoAt) === fSlug) return r
    const last = id.split('/').filter(Boolean).pop()
    if (last) {
      const lastNoAt = last.startsWith('@') ? last.slice(1) : last
      if (normFolder(lastNoAt) === f || slugFolder(lastNoAt) === fSlug) return r
    }
    if (r.displayName && slugFolder(r.displayName) === fSlug) return r
  }
  return undefined
}

/** Match on-disk podcast folder id to a podcasts.txt row. */
function podcastRowForFolder(
  rows: PodcastInfoRow[],
  folderId: string
): PodcastInfoRow | undefined {
  return rows.find((r) => r.folderId === folderId)
}

export type LibraryVideoGroup = {
  groupKey: string
  channelFolder: string
  /** Resolved YouTube title when matched, else prettified folder name. */
  title: string
  logoUrl: string | null
  items: LibraryVideo[]
}

function buildLibraryGroups(
  videos: LibraryVideo[],
  channelRows: ChannelInfoRow[],
  podcastRows: PodcastInfoRow[]
): LibraryVideoGroup[] {
  const bucket = new Map<string, LibraryVideo[]>()
  for (const v of videos) {
    const { groupKey } = parseLibraryRelPath(v.relPath)
    const list = bucket.get(groupKey)
    if (list) list.push(v)
    else bucket.set(groupKey, [v])
  }
  const groups: LibraryVideoGroup[] = []
  for (const [groupKey, items] of bucket) {
    items.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const first = items[0]!
    const { channelFolder } = parseLibraryRelPath(first.relPath)
    const pRow = groupKey.startsWith('podcast/')
      ? podcastRowForFolder(podcastRows, channelFolder)
      : undefined
    const row = pRow ? undefined : channelRowForFolder(channelRows, channelFolder)
    const prettyFolder = channelFolder.replace(/_/g, ' ')
    const title =
      groupKey === '__root__'
        ? 'Library root'
        : groupKey.startsWith('podcast/')
          ? (pRow?.displayName ?? `Podcast · ${prettyFolder}`)
          : row?.displayName ??
            (groupKey.startsWith('rec/') ? `ytrec · ${prettyFolder}` : prettyFolder)
    const logoUrl = pRow?.logoUrl ?? row?.logoUrl ?? null
    groups.push({ groupKey, channelFolder, title, logoUrl, items })
  }
  groups.sort((a, b) => {
    const newest = (g: LibraryVideoGroup): number =>
      Math.max(...g.items.map((i) => i.mtimeMs), 0)
    return newest(b) - newest(a)
  })
  return groups
}

/* ── Hook ── */

/** Library scan, media grouping, and helpers. Enriched with channel + podcast rows. */
export function useLibrary(
  appendLog: (chunk: string) => void,
  dataDir: string,
  channelRows: ChannelInfoRow[],
  podcastRows: PodcastInfoRow[]
) {
  const [library, setLibrary] = useState<LibraryVideo[]>([])
  /** Tracks which data root has been hydrated (one-shot per root). */
  const hydratedDataRootRef = useRef<string | null>(null)
  /** After first successful hydrate, allow patch writes. */
  const allowSpotSaveRef = useRef(false)

  const refreshLibrary = useCallback(async () => {
    console.log('[useLibrary] scanning library')
    const r = await window.ytdl.scanLibrary()
    if (!r.ok) {
      appendLog(`[ui] scan failed: ${r.error}\n`)
      return { videos: [] as LibraryVideo[], freshHydrate: false }
    }
    const videos = r.videos ?? []
    setLibrary(videos)
    appendLog(`[ui] library: ${videos.length} media files\n`)

    const root = await window.ytdl.getDataDir()
    if (hydratedDataRootRef.current === root) {
      allowSpotSaveRef.current = true
      // Re-load spot from disk so resume positions stay in sync (e.g. React Strict Mode can skip
      // the first restoreFromSnapshot while this ref is already marked hydrated).
      const spotAgain = await window.ytdl.loadPlaybackSpot()
      if (spotAgain.ok && spotAgain.snapshot) {
        console.log('[useLibrary] same root: reloading playback spot for position merge')
        return { videos, freshHydrate: false, snapshot: spotAgain.snapshot, positionsOnly: true }
      }
      return { videos, freshHydrate: false }
    }
    hydratedDataRootRef.current = root
    console.log(`[useLibrary] hydrating playback spot for root: ${root}`)
    const spot = await window.ytdl.loadPlaybackSpot()
    if (!spot.ok || !spot.snapshot) {
      appendLog(`[ui] playback spot: ${spot.error ?? 'load failed'}\n`)
      allowSpotSaveRef.current = true
      return { videos, freshHydrate: false }
    }
    allowSpotSaveRef.current = true
    return { videos, freshHydrate: true, snapshot: spot.snapshot }
  }, [appendLog])

  const libraryGroups = useMemo(
    () => buildLibraryGroups(library, channelRows, podcastRows),
    [library, channelRows, podcastRows]
  )

  /** Reset hydrate flag when user picks a new data dir. */
  const resetHydrate = useCallback(() => {
    hydratedDataRootRef.current = null
    allowSpotSaveRef.current = false
  }, [])

  /** When Settings / startup updates the chosen data root, drop hydrate gate so the next scan re-loads spot. */
  useEffect(() => {
    console.log('[useLibrary] dataDir changed, reset hydrate gate', dataDir || '(empty)')
    resetHydrate()
  }, [dataDir, resetHydrate])

  return {
    library,
    setLibrary,
    libraryGroups,
    refreshLibrary,
    allowSpotSaveRef,
    resetHydrate
  }
}
