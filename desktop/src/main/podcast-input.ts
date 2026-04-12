import { createHash } from 'node:crypto'

/** Normalize user paste or iTunes `feedUrl` into a canonical https URL, or null. */
export function normalizePodcastFeedUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.startsWith('#')) return null
  if (/[\r\n]/.test(t)) return null
  if (!/^https?:\/\//i.test(t)) return null
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname) return null
    if (u.protocol === 'http:') u.protocol = 'https:'
    return u.href
  } catch {
    return null
  }
}

/**
 * Extract iTunes collection id from podcasts.apple.com (or itunes.apple.com) show URLs.
 */
export function extractApplePodcastCollectionId(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const m = /(?:id\/|id=)(\d+)/i.exec(t)
  return m?.[1] ?? null
}

/** Stable folder name for on-disk episodes: first 16 hex chars of SHA-256(feed URL). */
export function folderIdFromFeedUrl(feedUrl: string): string {
  return createHash('sha256').update(feedUrl.trim()).digest('hex').slice(0, 16)
}

/** Row is saveable when we have a display title and no resolve error. Logo optional for bare RSS. */
export function isPodcastRowValidForAdd(row: {
  displayName: string | null
  error: string | null
}): boolean {
  const name = row.displayName?.trim()
  if (!name) return false
  if (row.error) return false
  return true
}
