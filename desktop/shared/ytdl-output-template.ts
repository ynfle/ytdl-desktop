/**
 * yt-dlp `-o` filename fields with Windows MAX_PATH headroom.
 * Full titles remain in per-episode `.info.json`; only on-disk basenames are shortened.
 */

/** Truncate `title` by byte count (ASCII podcast titles ≈ 1 byte/char). */
export const YTDLP_TITLE_MAX_BYTES = 70

/** Suffix from `id` so truncated titles stay unique within a folder. */
export const YTDLP_ID_MAX_CHARS = 16

/** `%(title).70B_%(id).16s` — use inside yt-dlp output templates. */
export const YTDLP_TRUNCATED_BASENAME = `%(title).${YTDLP_TITLE_MAX_BYTES}B_%(id).${YTDLP_ID_MAX_CHARS}s`

/** Channel / playlist episode path under `videos/<uploader>/`. */
export function ytdlpChannelOutputTemplate(): string {
  return `videos/%(uploader)s/${YTDLP_TRUNCATED_BASENAME}.%(ext)s`
}

/** ytrec episode path under `videos/rec/<channel>/`. */
export function ytdlpYtrecOutputTemplate(): string {
  return `videos/rec/%(channel)s/${YTDLP_TRUNCATED_BASENAME}.%(ext)s`
}

/** Podcast basename: readable truncated title + short id tail (Windows-safe, browseable). */
export const YTDLP_PODCAST_TITLE_MAX_BYTES = 50

/** Disambiguate when two titles share the same 50-byte prefix. */
export const YTDLP_PODCAST_ID_SUFFIX_CHARS = 8

/** `%(title).50B_%(id).8s` — human-readable stem for podcast `-o` templates. */
export const YTDLP_PODCAST_BASENAME = `%(title).${YTDLP_PODCAST_TITLE_MAX_BYTES}B_%(id).${YTDLP_PODCAST_ID_SUFFIX_CHARS}s`

/** Truncate a UTF-8 string to at most `maxBytes` (yt-dlp `.NB` semantics). */
export function truncateUtf8Bytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= maxBytes) return s
  let end = maxBytes
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

/**
 * Approximate yt-dlp `--restrict-filenames` + podcast output template for renaming uuid-only files.
 * Full title remains in `.info.json` when the on-disk stem is shortened further.
 */
export function podcastReadableBasename(title: string, episodeId: string): string {
  let stem = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ /g, '_')
    .replace(/[^\w.\-+]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  stem = truncateUtf8Bytes(stem, YTDLP_PODCAST_TITLE_MAX_BYTES)
  const idTail = episodeId.replace(/-/g, '').slice(0, YTDLP_PODCAST_ID_SUFFIX_CHARS)
  return idTail.length > 0 ? `${stem}_${idTail}` : stem
}

/**
 * Podcast RSS episode path under `videos/podcasts/<folderId>/`.
 * Readable truncated title on disk; full title in `.info.json` / library `displayTitle`.
 */
export function ytdlpPodcastOutputTemplate(folderId: string): string {
  return `videos/podcasts/${folderId}/${YTDLP_PODCAST_BASENAME}.%(ext)s`
}
