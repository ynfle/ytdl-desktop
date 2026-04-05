/** Log prefix for main-process diagnostics. */
export const LOG = '[ytdl-main]' as const

/** Max concurrent yt-dlp metadata processes (channel name lookup). */
export const CHANNEL_RESOLVE_CONCURRENCY = 4

export const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.m4v'])

/** Browser-like headers so CDNs (yt3/ggpht) accept main-process fetches. */
export const CHANNEL_LOGO_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
} as const
