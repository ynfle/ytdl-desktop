import { join } from 'path'
import { promises as fs } from 'fs'
import { broadcastLibraryStale, broadcastLog } from './broadcast'
import { readChannelsFile } from './library-scan'
import { runYtDlp } from './yt-dlp-runner'
import { startVideosLibraryWatch } from './videos-watch-during-sync'

/** Channel download: mirrors scripts/download_videos.sh (non-ytrec branch). */
export async function syncChannelsJob(dataRoot: string): Promise<void> {
  const videosWatch = startVideosLibraryWatch(dataRoot, {
    onTick: () => broadcastLibraryStale({ reason: 'watch' })
  })
  try {
    await runSyncChannelsJobInner(dataRoot)
  } finally {
    videosWatch.stop()
  }
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
  const videosWatch = startVideosLibraryWatch(dataRoot, {
    onTick: () => broadcastLibraryStale({ reason: 'watch' })
  })
  try {
    await runSyncYtrecJobInner(dataRoot, count)
  } finally {
    videosWatch.stop()
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
