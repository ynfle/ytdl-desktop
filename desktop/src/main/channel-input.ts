import type { ChannelInfoRow } from '../../shared/ytdl-api'

/** Hostnames we accept when normalizing a pasted YouTube channel URL. */
const YT_HOST = /^(?:www\.|m\.)?youtube\.com$/i

/**
 * Turn user paste or typed slug into a single channels.txt path segment.
 * Full URLs are reduced to the pathname (e.g. /@x/videos → @x). Bare slugs pass through.
 */
export function normalizeChannelInput(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.startsWith('#')) return null
  if (/[\r\n]/.test(t)) return null
  if (t.includes('..')) return null

  let s = t
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) {
    try {
      const urlStr = /^www\./i.test(t) ? `https://${t}` : t
      const u = new URL(urlStr)
      if (!YT_HOST.test(u.hostname)) return null
      let path = u.pathname.replace(/^\/+|\/+$/g, '')
      path = path
        .replace(/\/videos\/?$/i, '')
        .replace(/\/about\/?$/i, '')
        .replace(/\/featured\/?$/i, '')
      if (!path) return null
      s = path
    } catch {
      return null
    }
  }

  if (s.includes('..') || /[\r\n]/.test(s)) return null
  return s
}

/** Strict gate: only allow persisting when preview showed name + loopback avatar and no error. */
export function isChannelRowValidForAdd(row: ChannelInfoRow): boolean {
  const name = row.displayName?.trim()
  if (!name) return false
  if (row.error) return false
  if (!row.logoUrl) return false
  return true
}
