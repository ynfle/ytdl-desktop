import type { ChannelInfoRow } from '../../shared/ytdl-api'

/** Hostnames allowed when normalizing a pasted YouTube playlist URL. */
const YT_PLAYLIST_HOST =
  /^(?:www\.|m\.)?youtube\.com$|^music\.youtube\.com$/i

/** Minimum plausible YouTube list= id length (PL…, OLAK5uy_…, etc.). */
const MIN_LIST_ID_LEN = 10

/** YouTube `list` query values are typically alphanumerics, underscore, hyphen. */
const LIST_ID_RE = /^[A-Za-z0-9_-]+$/

/**
 * Extract playlist list= id from a URL, or null.
 */
function listIdFromUrl(u: URL): string | null {
  const list = u.searchParams.get('list')
  if (list && list.length >= MIN_LIST_ID_LEN && LIST_ID_RE.test(list)) return list
  return null
}

/**
 * Turn user paste into canonical `https://www.youtube.com/playlist?list=…`.
 * Accepts playlist URLs, watch URLs with list=, or a bare list id.
 */
export function normalizePlaylistInput(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.startsWith('#')) return null
  if (/[\r\n]/.test(t)) return null
  if (t.includes('..')) return null

  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) {
    try {
      const urlStr = /^www\./i.test(t) ? `https://${t}` : t
      const u = new URL(urlStr)
      if (!YT_PLAYLIST_HOST.test(u.hostname)) return null
      const list = listIdFromUrl(u)
      if (list) return `https://www.youtube.com/playlist?list=${list}`
      return null
    } catch {
      return null
    }
  }

  if (t.length < MIN_LIST_ID_LEN || !LIST_ID_RE.test(t)) return null
  return `https://www.youtube.com/playlist?list=${t}`
}

/** Same gate as channel add: resolved title, loopback artwork, no error row. */
export function isPlaylistRowValidForAdd(row: ChannelInfoRow): boolean {
  const name = row.displayName?.trim()
  if (!name) return false
  if (row.error) return false
  if (!row.logoUrl) return false
  return true
}
