import { resolve } from 'path'
import type { ChannelInfoRow } from '../../shared/ytdl-api'
import { LOG } from './constants'
import { channelLogoFilePath, downloadChannelLogo } from './channel-logos'
import {
  parseYtDlpJsonRecord,
  pickThumbnailUrlByMaxArea,
  YT_DLP_BASE_JSON_ARGS
} from './yt-dlp-json-helpers'
import { enrichChannelRowWithLogo } from './channel-yt-dlp'
import { runYtDlpCaptureStdout } from './yt-dlp-runner'

/** Playlist title and uploader page from yt-dlp `-J` on a playlist URL. */
function pickPlaylistMeta(raw: string): {
  displayName: string | null
  channelPageUrl: string | null
  thumbUrl: string | null
} {
  const data = parseYtDlpJsonRecord(raw)
  if (!data) return { displayName: null, channelPageUrl: null, thumbUrl: null }
  try {
    const title =
      (typeof data.playlist_title === 'string' &&
        data.playlist_title !== 'NA' &&
        data.playlist_title) ||
      (typeof data.title === 'string' && data.title !== 'NA' && data.title) ||
      null
    const topThumb = pickThumbnailUrlByMaxArea(data.thumbnails)
    const entries = data.entries
    if (Array.isArray(entries) && entries[0] && typeof entries[0] === 'object') {
      const e = entries[0] as Record<string, unknown>
      const chUrl = e.channel_url
      const upUrl = e.uploader_url
      const page =
        (typeof chUrl === 'string' && chUrl && chUrl !== 'NA' ? chUrl : null) ||
        (typeof upUrl === 'string' && upUrl && upUrl !== 'NA' ? upUrl : null)
      const entryThumb = pickThumbnailUrlByMaxArea(e.thumbnails)
      return {
        displayName: title,
        channelPageUrl: page,
        thumbUrl: topThumb ?? entryThumb
      }
    }
    return { displayName: title, channelPageUrl: null, thumbUrl: topThumb }
  } catch {
    return { displayName: null, channelPageUrl: null, thumbUrl: null }
  }
}

/**
 * Resolve one playlists.txt line: yt-dlp JSON on the playlist, title + thumbnail → channel logo slot.
 * Reuses ChannelInfoRow / channel-display-cache (identifier = canonical URL).
 */
export async function resolvePlaylistRow(
  dataRoot: string,
  playlistUrl: string
): Promise<{ row: ChannelInfoRow; logoSourceUrl?: string }> {
  const root = resolve(dataRoot)
  const baseArgs = [...YT_DLP_BASE_JSON_ARGS, '--playlist-items', '1', '-J', '--skip-download', playlistUrl]

  try {
    const jsonOut = await runYtDlpCaptureStdout(baseArgs, dataRoot)
    const parsed = pickPlaylistMeta(jsonOut)
    console.info(LOG, 'playlist yt-dlp -J', {
      urlPreview: playlistUrl.slice(0, 64),
      displayName: parsed.displayName,
      hasThumb: Boolean(parsed.thumbUrl)
    })

    if (!parsed.displayName) {
      const row: ChannelInfoRow = {
        identifier: playlistUrl,
        videosUrl: playlistUrl,
        displayName: null,
        channelPageUrl: parsed.channelPageUrl,
        error: 'Could not read playlist title (private, empty, or login required?)',
        logoUrl: null
      }
      const enriched = await enrichChannelRowWithLogo(root, playlistUrl, row, undefined)
      return { row: enriched }
    }

    let avatarUrl: string | undefined
    if (parsed.thumbUrl) {
      avatarUrl = parsed.thumbUrl
      const dest = channelLogoFilePath(root, playlistUrl)
      const ok = await downloadChannelLogo(parsed.thumbUrl, dest)
      if (!ok) {
        console.warn(LOG, 'playlist thumbnail download failed', playlistUrl.slice(0, 48))
      }
    }

    const base: ChannelInfoRow = {
      identifier: playlistUrl,
      videosUrl: playlistUrl,
      displayName: parsed.displayName,
      channelPageUrl: parsed.channelPageUrl,
      error: null,
      logoUrl: null
    }
    const enriched = await enrichChannelRowWithLogo(root, playlistUrl, base, avatarUrl)
    return avatarUrl ? { row: enriched, logoSourceUrl: avatarUrl } : { row: enriched }
  } catch (e) {
    const row: ChannelInfoRow = {
      identifier: playlistUrl,
      videosUrl: playlistUrl,
      displayName: null,
      channelPageUrl: null,
      error: String(e),
      logoUrl: null
    }
    const enriched = await enrichChannelRowWithLogo(root, playlistUrl, row, undefined)
    return { row: enriched }
  }
}
