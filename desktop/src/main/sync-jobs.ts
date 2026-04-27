import { join } from 'path'
import { promises as fs } from 'fs'
import { broadcastLibraryStale, broadcastLog } from './broadcast'
import { folderIdFromFeedUrl } from './podcast-input'
import { readChannelsFile, readPlaylistsLinesOrEmpty, readPodcastsLinesOrEmpty } from './library-scan'
import { LOG } from './constants'
import { runYtDlp } from './yt-dlp-runner'
import { startVideosLibraryWatch } from './videos-watch-during-sync'

/** Debounced watch on `videos/` so the renderer can refresh while a sync job runs. */
async function withVideosLibraryWatchDuringJob<T>(
  dataRoot: string,
  job: () => Promise<T>
): Promise<T> {
  const videosWatch = startVideosLibraryWatch(dataRoot, {
    onTick: () => broadcastLibraryStale({ reason: 'watch' })
  })
  try {
    return await job()
  } finally {
    videosWatch.stop()
  }
}

/** Channel download: channels.txt only (same flags as `scripts/download_videos.sh channels`). */
export async function syncChannelsJob(dataRoot: string): Promise<void> {
  await withVideosLibraryWatchDuringJob(dataRoot, () => runSyncChannelsJobInner(dataRoot))
}

/** Playlist download: playlists.txt only (shared downloaded.txt + output template). */
export async function syncPlaylistsJob(dataRoot: string): Promise<void> {
  await withVideosLibraryWatchDuringJob(dataRoot, () => runSyncPlaylistsJobInner(dataRoot))
}

/** Shared yt-dlp argv for channel /videos tab and playlist URLs (same archive + output template). */
function youtubeChannelLikeDownloadArgs(targetUrl: string): string[] {
  return [
    '--playlist-items',
    '1-10',
    '--download-archive',
    'downloaded.txt',
    '--ignore-errors',
    '--remote-components',
    'ejs:github',
    '--write-info-json',
    '--embed-metadata',
    '-f',
    'bestvideo[height<=720]+bestaudio/best[height<=720]',
    '--write-thumbnail',
    '--embed-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '-t',
    'mp4',
    '-o',
    'videos/%(uploader)s/%(title)s.%(ext)s',
    '--restrict-filenames',
    targetUrl
  ]
}

async function runSyncChannelsJobInner(dataRoot: string): Promise<void> {
  const lines = await readChannelsFile(dataRoot)
  broadcastLog(`[ytdl] channels.txt: ${lines.length} lines\n`)
  for (const channel_identifier of lines) {
    const url = `https://www.youtube.com/${channel_identifier}/videos`
    const args = youtubeChannelLikeDownloadArgs(url)
    broadcastLog(`\n[ytdl] === ${url} ===\n`)
    const { code } = await runYtDlp(args, dataRoot)
    if (code !== 0) {
      broadcastLog(`[ytdl] warning: exit code ${code} for ${url}\n`)
    }
  }
}

async function runSyncPlaylistsJobInner(dataRoot: string): Promise<void> {
  const playlistLines = await readPlaylistsLinesOrEmpty(dataRoot)
  broadcastLog(`[ytdl] playlists.txt: ${playlistLines.length} lines\n`)
  for (const playlistUrl of playlistLines) {
    const args = youtubeChannelLikeDownloadArgs(playlistUrl)
    const logLabel =
      playlistUrl.length > 96 ? `${playlistUrl.slice(0, 96)}…` : playlistUrl
    broadcastLog(`\n[ytdl] === playlist ${logLabel} ===\n`)
    const { code } = await runYtDlp(args, dataRoot)
    if (code !== 0) {
      broadcastLog(`[ytdl] warning: exit code ${code} for playlist\n`)
    }
  }
}

/** Recommended feed: mirrors scripts/download_videos.sh ytrec branch. */
export async function syncYtrecJob(dataRoot: string, count: number): Promise<void> {
  await withVideosLibraryWatchDuringJob(dataRoot, () => runSyncYtrecJobInner(dataRoot, count))
}

/** Podcast RSS: latest episodes as audio via yt-dlp (separate archive from YouTube). */
export async function syncPodcastsJob(dataRoot: string): Promise<void> {
  await withVideosLibraryWatchDuringJob(dataRoot, () => runSyncPodcastsJobInner(dataRoot))
}

async function runSyncPodcastsJobInner(dataRoot: string): Promise<void> {
  const lines = await readPodcastsLinesOrEmpty(dataRoot)
  broadcastLog(`[ytdl] podcasts.txt: ${lines.length} feeds\n`)
  for (const feedUrl of lines) {
    const folderId = folderIdFromFeedUrl(feedUrl)
    const outDir = join(dataRoot, 'videos', 'podcasts', folderId)
    await fs.mkdir(outDir, { recursive: true })
    const args = [
      '--playlist-items',
      '1-10',
      '--download-archive',
      'podcast-downloaded.txt',
      '--ignore-errors',
      '--remote-components',
      'ejs:github',
      '--write-info-json',
      '--embed-metadata',
      '--write-thumbnail',
      '--embed-thumbnail',
      '--convert-thumbnails',
      'jpg',
      '-f',
      'bestaudio/best',
      '-o',
      `videos/podcasts/${folderId}/%(title)s.%(ext)s`,
      '--restrict-filenames',
      feedUrl
    ]
    broadcastLog(`\n[ytdl] === podcast ${feedUrl.slice(0, 72)}… ===\n`)
    broadcastLog('[ytdl] podcast: episode thumbnails enabled (write-thumbnail, embed-thumbnail, jpg)\n')
    console.info(LOG, 'podcast sync feed starting', {
      folderId,
      thumbnails: true,
      feedPreview: feedUrl.slice(0, 72)
    })
    const { code } = await runYtDlp(args, dataRoot)
    if (code !== 0) {
      broadcastLog(`[ytdl] warning: exit code ${code} for podcast feed\n`)
    }
  }
}

async function runSyncYtrecJobInner(dataRoot: string, count: number): Promise<void> {
  await fs.mkdir(join(dataRoot, 'videos', 'rec'), { recursive: true })
  const args = [
    '--cookies-from-browser',
    'firefox',
    '--remote-components',
    'ejs:github',
    '--playlist-items',
    `1-${count}`,
    '--write-thumbnail',
    '--embed-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '-t',
    'mp4',
    '--download-archive',
    'downloaded.txt',
    '--ignore-errors',
    '--write-info-json',
    '--embed-metadata',
    '-f',
    'bestvideo[height<=720]+bestaudio/best[height<=720]',
    '-o',
    'videos/rec/%(channel)s/%(title)s.%(ext)s',
    '--restrict-filenames',
    ':ytrec'
  ]
  broadcastLog(`[ytdl] ytrec count=${count}\n`)
  const { code } = await runYtDlp(args, dataRoot)
  if (code !== 0) {
    broadcastLog(`[ytdl] warning: ytrec exit code ${code}\n`)
  }
}
