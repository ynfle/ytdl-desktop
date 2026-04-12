import type { PodcastInfoRow } from '../../shared/ytdl-api'
import { LOG } from './constants'
import { folderIdFromFeedUrl } from './podcast-input'
import { downloadPodcastCover, pathExistsPodcastLogo, podcastLogoFilePath } from './podcast-logos'
import { podcastLogoLoopbackUrl } from './media-server'
import { runYtDlpCaptureStdout } from './yt-dlp-runner'

const BASE_YTDLP = ['--no-warnings', '--ignore-errors', '--remote-components', 'ejs:github'] as const

function pickThumbnailFromEntry(entry: Record<string, unknown>): string | null {
  const thumbs = entry.thumbnails
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null
  type T = { url?: string; width?: number; height?: number }
  let best: T | null = null
  let bestArea = 0
  for (const t of thumbs as T[]) {
    if (typeof t?.url !== 'string' || !t.url.startsWith('http')) continue
    const w = t.width ?? 0
    const h = t.height ?? 0
    const area = w > 0 && h > 0 ? w * h : 1
    if (area > bestArea) {
      bestArea = area
      best = t
    }
  }
  return best?.url ?? null
}

/** Parse yt-dlp -J for an RSS / playlist URL: title + optional thumbnail. */
function parsePlaylistJsonDump(raw: string): {
  displayName: string | null
  thumbnailUrl: string | null
  feedPageUrl: string | null
} {
  const trimmed = raw.trim()
  if (!trimmed) return { displayName: null, thumbnailUrl: null, feedPageUrl: null }
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>
    const entries = data.entries
    const topTitle =
      (typeof data.title === 'string' && data.title !== 'NA' && data.title) ||
      (typeof data.playlist_title === 'string' &&
        data.playlist_title !== 'NA' &&
        data.playlist_title) ||
      null
    const webpage = data.webpage_url
    const feedPageUrl =
      typeof webpage === 'string' && webpage.startsWith('http') ? webpage : null

    let displayName = topTitle
    let thumbnailUrl: string | null = null

    if (Array.isArray(entries) && entries[0] && typeof entries[0] === 'object') {
      const e = entries[0] as Record<string, unknown>
      if (!displayName) {
        displayName =
          (typeof e.playlist_title === 'string' && e.playlist_title) ||
          (typeof e.series === 'string' && e.series) ||
          (typeof e.uploader === 'string' && e.uploader) ||
          (typeof e.channel === 'string' && e.channel) ||
          null
      }
      thumbnailUrl = pickThumbnailFromEntry(e)
    }

    if (!thumbnailUrl && Array.isArray(data.thumbnails)) {
      thumbnailUrl = pickThumbnailFromEntry({ thumbnails: data.thumbnails } as Record<string, unknown>)
    }

    return {
      displayName: displayName?.trim() || null,
      thumbnailUrl,
      feedPageUrl
    }
  } catch (e) {
    console.warn(LOG, 'podcast yt-dlp JSON parse failed', e)
    return { displayName: null, thumbnailUrl: null, feedPageUrl: null }
  }
}

/**
 * Download cover when we have a remote URL and no local file; set loopback logoUrl when file exists.
 */
export async function enrichPodcastRowWithLogo(
  folderId: string,
  row: PodcastInfoRow,
  logoSourceUrl?: string | null
): Promise<PodcastInfoRow> {
  const filePath = podcastLogoFilePath(folderId)
  const remote =
    typeof logoSourceUrl === 'string' && logoSourceUrl.length > 0 ? logoSourceUrl : null
  if (remote && !(await pathExistsPodcastLogo(filePath))) {
    console.info(LOG, 'podcast cover file missing, downloading', folderId)
    await downloadPodcastCover(remote, filePath)
  }
  const logoUrl = (await pathExistsPodcastLogo(filePath)) ? podcastLogoLoopbackUrl(folderId) : null
  return { ...row, logoUrl }
}

/**
 * Resolve metadata for one feed URL using yt-dlp (and optional iTunes artwork).
 * `dataRoot` is yt-dlp cwd (matches channel resolve).
 */
export async function resolvePodcastRowFromFeed(
  dataRoot: string,
  feedUrl: string,
  opts?: { prefetchedArtworkUrl?: string | null; feedPageUrl?: string | null }
): Promise<{ row: PodcastInfoRow; logoSourceUrl?: string | null }> {
  const folderId = folderIdFromFeedUrl(feedUrl)
  const args = [...BASE_YTDLP, '--playlist-items', '1', '-J', '--skip-download', feedUrl]
  let displayName: string | null = null
  let thumbnailFromDump: string | null = null
  let feedPageUrl: string | null = opts?.feedPageUrl ?? null

  try {
    const out = await runYtDlpCaptureStdout(args, dataRoot)
    const parsed = parsePlaylistJsonDump(out)
    displayName = parsed.displayName
    thumbnailFromDump = parsed.thumbnailUrl
    if (!feedPageUrl && parsed.feedPageUrl) feedPageUrl = parsed.feedPageUrl
    console.info(LOG, 'podcast yt-dlp preview', {
      folderId,
      hasName: Boolean(displayName),
      hasThumb: Boolean(thumbnailFromDump)
    })
  } catch (e) {
    console.warn(LOG, 'podcast yt-dlp preview failed', feedUrl.slice(0, 80), e)
    const row: PodcastInfoRow = {
      feedUrl,
      folderId,
      displayName: null,
      feedPageUrl,
      error: 'Could not read podcast feed (invalid URL, private, or network error?)',
      logoUrl: null
    }
    const enriched = await enrichPodcastRowWithLogo(folderId, row, undefined)
    return { row: enriched }
  }

  const prefetched = opts?.prefetchedArtworkUrl
  const logoSourceUrl =
    (typeof prefetched === 'string' && prefetched.startsWith('http') ? prefetched : null) ||
    thumbnailFromDump

  if (!displayName) {
    const row: PodcastInfoRow = {
      feedUrl,
      folderId,
      displayName: null,
      feedPageUrl,
      error: 'Could not read podcast title from the feed.',
      logoUrl: null
    }
    const enriched = await enrichPodcastRowWithLogo(folderId, row, logoSourceUrl)
    return { row: enriched, logoSourceUrl }
  }

  const base: PodcastInfoRow = {
    feedUrl,
    folderId,
    displayName,
    feedPageUrl,
    error: null,
    logoUrl: null
  }
  const enriched = await enrichPodcastRowWithLogo(folderId, base, logoSourceUrl)
  return logoSourceUrl ? { row: enriched, logoSourceUrl } : { row: enriched }
}
