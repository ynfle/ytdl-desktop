import { resolve } from 'path'
import type { ChannelInfoRow } from '../../shared/ytdl-api'
import { LOG } from './constants'
import { channelLogoFilePath, downloadChannelLogo, pathExists } from './channel-logos'
import { channelLogoLoopbackUrl } from './media-server'
import { parseYtDlpJsonRecord, YT_DLP_BASE_JSON_ARGS } from './yt-dlp-json-helpers'
import { runYtDlpCaptureStdout } from './yt-dlp-runner'

export function channelVideosUrl(channel_identifier: string): string {
  return `https://www.youtube.com/${channel_identifier}/videos`
}

function channelAboutUrl(channel_identifier: string): string {
  return `https://www.youtube.com/${channel_identifier}/about`
}

/** Pick highest-quality channel avatar URL from yt-dlp `/about` JSON `thumbnails`. */
function pickBestAvatarUrl(thumbnails: unknown): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null
  type T = { url?: string; id?: string; width?: number; height?: number }
  const arr = thumbnails as T[]
  const byId = (id: string): string | null => {
    const t = arr.find((x) => x.id === id)
    return typeof t?.url === 'string' ? t.url : null
  }
  const direct =
    byId('7') || byId('avatar_uncropped') || byId('avatar') || byId('4') || byId('3')
  if (direct) return direct
  let best: T | null = null
  let bestArea = 0
  for (const t of arr) {
    if (typeof t.url !== 'string') continue
    const url = t.url
    if (!url.includes('yt3.googleusercontent.com') && !url.includes('ggpht.com')) continue
    const w = t.width ?? 0
    const h = t.height ?? 0
    const area = w > 0 && h > 0 ? w * h : Math.max(w, h, 1)
    if (area > bestArea) {
      bestArea = area
      best = t
    }
  }
  return best?.url ?? null
}

/** Channel display name, page, and avatar from `yt-dlp -J` on the channel `/about` tab. */
function pickChannelAboutMeta(raw: string): {
  name: string | null
  page: string | null
  avatarUrl: string | null
} {
  const data = parseYtDlpJsonRecord(raw)
  if (!data) return { name: null, page: null, avatarUrl: null }
  try {
    const entries = data.entries
    const entry: Record<string, unknown> =
      Array.isArray(entries) && entries[0] && typeof entries[0] === 'object'
        ? (entries[0] as Record<string, unknown>)
        : data
    const name =
      (typeof entry.channel === 'string' && entry.channel) ||
      (typeof entry.uploader === 'string' && entry.uploader) ||
      null
    const chUrl = entry.channel_url
    const upUrl = entry.uploader_url
    const page =
      (typeof chUrl === 'string' && chUrl && chUrl !== 'NA' ? chUrl : null) ||
      (typeof upUrl === 'string' && upUrl && upUrl !== 'NA' ? upUrl : null)
    const avatarUrl = pickBestAvatarUrl(entry.thumbnails)
    return { name, page, avatarUrl }
  } catch {
    return { name: null, page: null, avatarUrl: null }
  }
}

/** Parse first playlist/video entry from yt-dlp -J output. */
function pickNameFromJsonDump(raw: string): { name: string | null; page: string | null } {
  const data = parseYtDlpJsonRecord(raw)
  if (!data) return { name: null, page: null }
  try {
    const entries = data.entries
    if (Array.isArray(entries) && entries[0] && typeof entries[0] === 'object') {
      const e = entries[0] as Record<string, unknown>
      const name =
        (typeof e.channel === 'string' && e.channel) ||
        (typeof e.uploader === 'string' && e.uploader) ||
        (typeof e.playlist_title === 'string' && e.playlist_title) ||
        null
      const page =
        (typeof e.channel_url === 'string' && e.channel_url && e.channel_url !== 'NA' && e.channel_url) ||
        (typeof e.uploader_url === 'string' && e.uploader_url && e.uploader_url !== 'NA' && e.uploader_url) ||
        null
      return { name, page }
    }
    const name =
      (typeof data.channel === 'string' && data.channel) ||
      (typeof data.uploader === 'string' && data.uploader) ||
      null
    const page =
      (typeof data.channel_url === 'string' && data.channel_url && data.channel_url !== 'NA' && data.channel_url) ||
      (typeof data.uploader_url === 'string' && data.uploader_url && data.uploader_url !== 'NA' && data.uploader_url) ||
      null
    return { name, page }
  } catch {
    return { name: null, page: null }
  }
}

/**
 * Download avatar in main if we have `logoSourceUrl` (from yt-dlp / JSON cache) and no file yet;
 * set `logoUrl` to loopback only when `userData/channel-logos/*.avatar` exists.
 */
export async function enrichChannelRowWithLogo(
  dataRoot: string,
  identifier: string,
  row: ChannelInfoRow,
  logoSourceUrl?: string | null
): Promise<ChannelInfoRow> {
  const root = resolve(dataRoot)
  const filePath = channelLogoFilePath(root, identifier)
  const remote =
    typeof logoSourceUrl === 'string' && logoSourceUrl.length > 0 ? logoSourceUrl : null
  if (remote) {
    if (await pathExists(filePath)) {
      console.info(LOG, 'channel logo on disk, skip network fetch', identifier)
    } else {
      console.info(LOG, 'channel logo file missing, downloading', identifier)
      await downloadChannelLogo(remote, filePath)
    }
  }
  const logoUrl = (await pathExists(filePath)) ? channelLogoLoopbackUrl(identifier) : null
  return { ...row, logoUrl }
}

/**
 * Resolve one channel line: prefer `/about` (name + avatar in one yt-dlp -J), else fall back to `/videos`.
 * Returns enriched row (loopback `logoUrl` when a file exists) and optional `logoSourceUrl` for the JSON cache.
 */
export async function resolveChannelRow(
  dataRoot: string,
  channel_identifier: string
): Promise<{ row: ChannelInfoRow; logoSourceUrl?: string }> {
  const videosUrl = channelVideosUrl(channel_identifier)
  const baseArgs = YT_DLP_BASE_JSON_ARGS
  const aboutUrl = channelAboutUrl(channel_identifier)

  let displayName: string | null = null
  let channelPageUrl: string | null = null
  let avatarUrl: string | undefined = undefined

  try {
    const aboutArgs = [...baseArgs, '--playlist-items', '1', '-J', '--skip-download', aboutUrl]
    const aboutOut = await runYtDlpCaptureStdout(aboutArgs, dataRoot)
    const aboutParsed = pickChannelAboutMeta(aboutOut)
    displayName = aboutParsed.name
    channelPageUrl = aboutParsed.page
    if (aboutParsed.avatarUrl) {
      avatarUrl = aboutParsed.avatarUrl
    }
    console.info(LOG, 'channel about yt-dlp', {
      channel_identifier,
      displayName,
      hasAvatar: Boolean(avatarUrl)
    })
  } catch (e) {
    console.warn(LOG, 'channel /about failed, trying /videos', channel_identifier, e)
  }

  if (!displayName) {
    const printArgs = [
      ...baseArgs,
      '--playlist-items',
      '1',
      '--skip-download',
      '--print',
      '%(channel)s||%(channel_url)s||%(uploader)s||%(uploader_url)s',
      videosUrl
    ]
    try {
      const out = await runYtDlpCaptureStdout(printArgs, dataRoot)
      const lastLine = out
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop()

      if (lastLine && !lastLine.startsWith('{')) {
        const parts = lastLine.split('||').map((s) => s.trim())
        const ch = parts[0] && parts[0] !== 'NA' && parts[0] !== 'None' ? parts[0] : ''
        const chUrl = parts[1] && parts[1] !== 'NA' && parts[1] !== 'None' ? parts[1] : ''
        const up = parts[2] && parts[2] !== 'NA' && parts[2] !== 'None' ? parts[2] : ''
        const upUrl = parts[3] && parts[3] !== 'NA' && parts[3] !== 'None' ? parts[3] : ''
        displayName = ch || up || null
        channelPageUrl = channelPageUrl || chUrl || upUrl || null
      }

      if (!displayName) {
        const jsonArgs = [...baseArgs, '--playlist-items', '1', '-J', '--skip-download', videosUrl]
        const jsonOut = await runYtDlpCaptureStdout(jsonArgs, dataRoot)
        const parsed = pickNameFromJsonDump(jsonOut)
        displayName = parsed.name
        channelPageUrl = channelPageUrl || parsed.page
      }
    } catch (e) {
      const row: ChannelInfoRow = {
        identifier: channel_identifier,
        videosUrl,
        displayName: null,
        channelPageUrl: null,
        error: String(e),
        logoUrl: null
      }
      const enriched = await enrichChannelRowWithLogo(dataRoot, channel_identifier, row, undefined)
      return { row: enriched }
    }
  }

  if (!displayName) {
    const row: ChannelInfoRow = {
      identifier: channel_identifier,
      videosUrl,
      displayName: null,
      channelPageUrl,
      error: 'Could not read channel name (no videos, private, or login required?)',
      logoUrl: null
    }
    const enriched = await enrichChannelRowWithLogo(dataRoot, channel_identifier, row, undefined)
    return { row: enriched }
  }

  // Logo bytes: only `enrichChannelRowWithLogo` fetches — it skips when `*.avatar` already exists.
  const base: ChannelInfoRow = {
    identifier: channel_identifier,
    videosUrl,
    displayName,
    channelPageUrl,
    error: null,
    logoUrl: null
  }
  const enriched = await enrichChannelRowWithLogo(dataRoot, channel_identifier, base, avatarUrl)
  return avatarUrl ? { row: enriched, logoSourceUrl: avatarUrl } : { row: enriched }
}
