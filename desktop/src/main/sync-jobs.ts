import { join } from 'path'
import { promises as fs } from 'fs'
import { broadcastLibraryStale, broadcastLog } from './broadcast'
import { folderIdFromFeedUrl } from './podcast-input'
import { readChannelsFile, readPodcastsLinesOrEmpty } from './library-scan'
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

/** Channel download: mirrors scripts/download_videos.sh (non-ytrec branch). */
export async function syncChannelsJob(dataRoot: string): Promise<void> {
  await withVideosLibraryWatchDuringJob(dataRoot, () => runSyncChannelsJobInner(dataRoot))
}

async function runSyncChannelsJobInner(dataRoot: string): Promise<void> {
  const lines = await readChannelsFile(dataRoot)
  broadcastLog(`[ytdl] channels.txt: ${lines.length} lines\n`)
  for (const channel_identifier of lines) {
    const url = `https://www.youtube.com/${channel_identifier}/videos`
    const args = [
      '--playlist-items',
      '1-10',
      '--download-archive',
      'downloaded.txt',
      '--ignore-errors',
      '--remote-components',
      'ejs:github',
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
      url
    ]
    broadcastLog(`\n[ytdl] === ${url} ===\n`)
    const { code } = await runYtDlp(args, dataRoot)
    if (code !== 0) {
      broadcastLog(`[ytdl] warning: exit code ${code} for ${url}\n`)
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
      '-f',
      'bestaudio/best',
      '-o',
      `videos/podcasts/${folderId}/%(title)s.%(ext)s`,
      '--restrict-filenames',
      feedUrl
    ]
    broadcastLog(`\n[ytdl] === podcast ${feedUrl.slice(0, 72)}… ===\n`)
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
