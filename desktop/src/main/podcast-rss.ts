import { LOG, PODCAST_RSS_FETCH_HEADERS, PODCAST_SYNC_MAX_EPISODES } from './constants'

/** One RSS `<item>` in document order (same indexing as yt-dlp `--playlist-items`). */
export type PodcastRssItem = {
  /** 1-based index among `<item>` elements. */
  playlistIndex: number
  /** RSS `<guid>` when present; otherwise the enclosure URL without query/hash. */
  guid: string
  /** Enclosure media URL (may be a tracking redirect or signed CDN link). */
  enclosureUrl: string
  /** Episode title from RSS `<title>` (written into `.info.json` for the library). */
  title: string
  /** `pubDate` / `dc:date` / Atom `published` as epoch ms, when parseable. */
  publishedAtMs: number | null
  /** `itunes:duration` (clock or seconds), when parseable. */
  durationSec: number | null
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
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, 'i')
  const m = re.exec(block)
  if (!m?.[1]) return null
  const text = decodeXmlText(m[1])
  return text.length > 0 ? text : null
}

/** Match `pubDate` / `itunes:duration` even when the feed uses a different namespace prefix. */
function firstLocalTagInner(block: string, localName: string): string | null {
  const exact = firstTagInner(block, localName)
  if (exact) return exact
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${escaped}>`,
    'i'
  )
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
  const media = /<media:content\b[^>]*\burl\s*=\s*["']([^"']+)["']/i.exec(block)
  if (media?.[1]) {
    const url = decodeXmlText(media[1])
    return url.length > 0 ? url : null
  }
  const link = firstTagInner(block, 'link')
  return link && /^https?:\/\//i.test(link) ? link : null
}

/**
 * Hide CDATA bodies before splitting `<item>` so a `</item>` inside a description
 * cannot truncate the block and drop `pubDate` / `itunes:duration`.
 */
function withMaskedRssCdata(xml: string): { masked: string; restore: (block: string) => string } {
  const parts: string[] = []
  const masked = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (full) => {
    const i = parts.length
    parts.push(full)
    return `<![CDATA[\u0001${i}\u0001]]>`
  })
  const restore = (block: string): string =>
    block.replace(/<!\[CDATA\[\u0001(\d+)\u0001\]\]>/g, (_, n) => parts[Number(n)] ?? '')
  return { masked, restore }
}

/**
 * Parse `itunes:duration` / `HH:MM:SS` / raw seconds for the library duration column.
 * Returns null when the tag is missing or not a positive length.
 */
export function parseRssClockDurationSec(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const parts = t.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
  const sec =
    nums.length === 3 ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]! : nums[0]! * 60 + nums[1]!
  return sec > 0 ? sec : null
}

/** RFC 2822 `pubDate`, ISO `dc:date`, or Atom `published`/`updated` → epoch ms. */
function publishedAtMsFromItem(block: string): number | null {
  const raw =
    firstLocalTagInner(block, 'pubDate') ??
    firstTagInner(block, 'dc:date') ??
    firstLocalTagInner(block, 'published') ??
    firstLocalTagInner(block, 'updated')
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms) || ms <= 0) {
    console.info(LOG, 'podcast rss: unparsed pubDate', { preview: raw.slice(0, 48) })
    return null
  }
  return ms
}

function durationSecFromItem(block: string): number | null {
  const raw = firstTagInner(block, 'itunes:duration') ?? firstLocalTagInner(block, 'duration')
  if (!raw) return null
  const sec = parseRssClockDurationSec(raw)
  if (sec == null) {
    console.info(LOG, 'podcast rss: unparsed itunes:duration', { preview: raw.slice(0, 24) })
  }
  return sec
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
  const { masked, restore } = withMaskedRssCdata(xml)
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(masked)) !== null && items.length < limit) {
    const block = restore(match[1] ?? '')
    const enclosureUrl = enclosureUrlFromItem(block)
    if (!enclosureUrl) {
      console.info(LOG, 'podcast rss: skip item without enclosure/link', { index: items.length + 1 })
      continue
    }
    const guid = guidFromItem(block, enclosureUrl)
    const title = firstTagInner(block, 'title') ?? ''
    const publishedAtMs = publishedAtMsFromItem(block)
    const durationSec = durationSecFromItem(block)
    items.push({
      playlistIndex: items.length + 1,
      guid,
      enclosureUrl,
      title,
      publishedAtMs,
      durationSec
    })
  }
  console.info(LOG, 'podcast rss: parsed items', {
    count: items.length,
    limit,
    withPubDate: items.filter((i) => i.publishedAtMs != null).length,
    withDuration: items.filter((i) => i.durationSec != null).length
  })
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
