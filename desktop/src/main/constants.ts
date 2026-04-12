/** Log prefix for main-process diagnostics. */
export const LOG = '[ytdl-main]' as const

/** Cached channel/podcast display metadata (titles, artwork refs) TTL — 7 days. */
export const DISPLAY_META_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Max concurrent yt-dlp metadata processes (channel name lookup). */
export const CHANNEL_RESOLVE_CONCURRENCY = 4

export const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.m4v'])

/** Audio extensions yt-dlp may write for RSS/podcast enclosures. */
export const AUDIO_EXT = new Set(['.m4a', '.mp3', '.opus', '.ogg', '.aac'])

/** Library scan: video + podcast audio files under the data root. */
export const LIBRARY_MEDIA_EXT = new Set<string>([...VIDEO_EXT, ...AUDIO_EXT])

/** Browser-like headers so CDNs (yt3/ggpht) accept main-process fetches. */
export const CHANNEL_LOGO_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
} as const
