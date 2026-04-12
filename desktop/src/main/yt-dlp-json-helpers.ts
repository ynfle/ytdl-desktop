/**
 * Shared yt-dlp stdout JSON parsing and thumbnail heuristics for channel + podcast resolve.
 */

/** Passed to every `runYtDlpCaptureStdout` that needs YouTube / RSS JSON metadata. */
export const YT_DLP_BASE_JSON_ARGS = [
  '--no-warnings',
  '--ignore-errors',
  '--remote-components',
  'ejs:github'
] as const

export function parseYtDlpJsonRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
}

type Thumb = { url?: string; width?: number; height?: number }

/** Largest area thumbnail with an http(s) URL (podcast RSS / generic playlist dumps). */
export function pickThumbnailUrlByMaxArea(thumbnails: unknown): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null
  let best: Thumb | null = null
  let bestArea = 0
  for (const t of thumbnails as Thumb[]) {
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
