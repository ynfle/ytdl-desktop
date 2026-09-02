import { LOG, PODCAST_RSS_FETCH_HEADERS, PODCAST_SYNC_MAX_EPISODES } from './constants'

/** One RSS `<item>` in document order (same indexing as yt-dlp `--playlist-items`). */
export type PodcastRssItem = {
  /** 1-based index among `<item>` elements. */
  playlistIndex: number
  /** RSS `<guid>` when present; otherwise the enclosure URL without query/hash. */
  guid: string
  /** Enclosure media URL (may be a tracking redirect or signed CDN link). */
  enclosureUrl: string
  /** Episode title from the feed (for logs). */
  title: string
}

const RSS_FETCH_TIMEOUT_MS = 30_000
const RSS_MAX_BYTES = 8 * 1024 * 1024

/** Decode a handful of XML entities and unwrap CDATA used in RSS guid/url/title text. */
export function decodeXmlText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return unwrapped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

function firstTagInner(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = re.exec(block)
  if (!m?.[1]) return null
  const text = decodeXmlText(m[1])
  return text.length > 0 ? text : null
}

function enclosureUrlFromItem(block: string): string | null {
  const m = /<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["']/i.exec(block)
  if (m?.[1]) {
    const url = decodeXmlText(m[1])
    return url.length > 0 ? url : null
  }
  const link = firstTagInner(block, 'link')
  return link && /^https?:\/\//i.test(link) ? link : null
}

function guidFromItem(block: string, enclosureUrl: string): string {
  const guid = firstTagInner(block, 'guid')
  if (guid) return guid
  try {
    const u = new URL(enclosureUrl)
    u.search = ''
    u.hash = ''
    return u.href
  } catch {
    return enclosureUrl
  }
}

/**
 * Parse RSS 2.0 channel items in document order (yt-dlp GenericIE `_extract_rss` walks the same list).
 * Atom feeds and empty bodies yield `[]` so the caller can fall back to a full-feed yt-dlp run.
 */
export function parsePodcastRssItems(xml: string, limit: number = PODCAST_SYNC_MAX_EPISODES): PodcastRssItem[] {
  const items: PodcastRssItem[] = []
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null && items.length < limit) {
    const block = match[1] ?? ''
    const enclosureUrl = enclosureUrlFromItem(block)
    if (!enclosureUrl) {
      console.info(LOG, 'podcast rss: skip item without enclosure/link', { index: items.length + 1 })
      continue
    }
    const guid = guidFromItem(block, enclosureUrl)
    const title = firstTagInner(block, 'title') ?? ''
    items.push({
      playlistIndex: items.length + 1,
      guid,
      enclosureUrl,
      title
    })
  }
  console.info(LOG, 'podcast rss: parsed items', { count: items.length, limit })
  return items
}

/**
 * Compress 1-based indices for yt-dlp `--playlist-items` (`1,2,3,5` → `1-3,5`).
 */
export function formatPlaylistItemsSpec(indices: number[]): string {
  const sorted = [...new Set(indices.filter((n) => n >= 1))].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let runStart = sorted[0]!
  let runEnd = runStart
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!
    if (n === runEnd + 1) {
      runEnd = n
      continue
    }
    parts.push(runStart === runEnd ? String(runStart) : `${runStart}-${runEnd}`)
    runStart = runEnd = n
  }
  parts.push(runStart === runEnd ? String(runStart) : `${runStart}-${runEnd}`)
  return parts.join(',')
}

/** Fetch a podcast RSS/Atom document as text (size-capped). */
export async function fetchPodcastRssXml(feedUrl: string): Promise<string | null> {
  const preview = feedUrl.slice(0, 96)
  console.info(LOG, 'podcast rss: fetching feed', { preview })
  try {
    const res = await fetch(feedUrl, {
      redirect: 'follow',
      headers: { ...PODCAST_RSS_FETCH_HEADERS },
      signal: AbortSignal.timeout(RSS_FETCH_TIMEOUT_MS)
    })
    if (!res.ok) {
      console.warn(LOG, 'podcast rss: HTTP error', { preview, status: res.status })
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > RSS_MAX_BYTES) {
      console.warn(LOG, 'podcast rss: feed too large, truncating parse buffer', {
        preview,
        bytes: buf.length
      })
    }
    const xml = buf.subarray(0, RSS_MAX_BYTES).toString('utf8').replace(/^\uFEFF/, '')
    console.info(LOG, 'podcast rss: fetched', { preview, bytes: buf.length, chars: xml.length })
    return xml
  } catch (e) {
    console.warn(LOG, 'podcast rss: fetch failed', { preview, e })
    return null
  }
}

/** Latest `limit` RSS items, or `[]` when the feed cannot be read/parsed. */
export async function loadPodcastRssWindow(
  feedUrl: string,
  limit: number = PODCAST_SYNC_MAX_EPISODES
): Promise<PodcastRssItem[]> {
  const xml = await fetchPodcastRssXml(feedUrl)
  if (!xml) return []
  return parsePodcastRssItems(xml, limit)
}
