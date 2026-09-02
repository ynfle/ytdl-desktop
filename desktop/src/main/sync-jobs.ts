import { tmpdir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import {
  ytdlpChannelOutputTemplate,
  ytdlpPodcastOutputTemplate,
  ytdlpYtrecOutputTemplate
} from '../../shared/ytdl-output-template'
import { broadcastLibraryStale, broadcastLog } from './broadcast'
import {
  cleanupLegacyPodcastDuplicatesInFolder,
  migrateUuidPodcastFilesToReadable
} from './podcast-dedupe'
import { repairPodcastEpisodeThumbnailsInFolder } from './podcast-episode-thumbnail'
import { folderIdFromFeedUrl } from './podcast-input'
import { readChannelsFile, readPlaylistsLinesOrEmpty, readPodcastsLinesOrEmpty } from './library-scan'
import { LOG, PODCAST_SYNC_MAX_EPISODES, SYNC_DOWNLOAD_CONCURRENCY } from './constants'
import {
  appendArchiveRecords,
  archiveLookupIdSet,
  createAsyncMutex,
  createYoutubeIdClaimSet,
  parseArchiveLines,
  podcastArchiveLookupKeys,
  podcastItemAlreadyArchived,
  readArchiveVideoIds,
  withTempDownloadArchive
} from './download-archive'
import { formatPlaylistItemsSpec, loadPodcastRssWindow } from './podcast-rss'
import { runYtDlp, runYtDlpCaptureStdout, runWithConcurrency } from './yt-dlp-runner'
import { startVideosLibraryWatch } from './videos-watch-during-sync'

/** YouTube watch ids from `--print %(id)s` (11-char base64url). */
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

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

/** Shared yt-dlp argv for channel /videos tab, playlist URLs, or claimed watch?v= URLs. */
function youtubeChannelLikeDownloadArgs(opts: {
  /** Absolute or cwd-relative `--download-archive` path (temp copy per parallel worker). */
  archivePath: string
  /** Channel/playlist URL, or one-or-more `watch?v=` URLs after playlist id claiming. */
  urls: string[]
  /** Limit a channel/playlist slice; omit when `urls` are already specific videos. */
  playlistItems?: string
}): string[] {
  return [
    ...(opts.playlistItems ? ['--playlist-items', opts.playlistItems] : []),
    '--download-archive',
    opts.archivePath,
    '--ignore-errors',
    // Per-video sidecars only — no channel/playlist aggregate .info.json or thumbs on every sync.
    '--no-write-playlist-metafiles',
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
    ytdlpChannelOutputTemplate(),
    '--restrict-filenames',
    ...opts.urls
  ]
}

/** Sync-log prefix so interleaved workers stay distinguishable (`[ytdl:@handle] `). */
function workerLogPrefix(label: string): string {
  return `[ytdl:${label}] `
}

/** Short playlist label: `list=` id when present, otherwise a truncated URL. */
function playlistLogLabel(playlistUrl: string): string {
  try {
    const u = new URL(playlistUrl)
    const list = u.searchParams.get('list')
    if (list) return list.length > 24 ? `${list.slice(0, 24)}…` : list
  } catch {
    /* ignore malformed */
  }
  return playlistUrl.length > 32 ? `${playlistUrl.slice(0, 32)}…` : playlistUrl
}

/**
 * Cheap `--flat-playlist` listing of the first 10 video ids (no download).
 * Used so parallel playlist workers can claim ids and avoid double-fetching a shared video.
 */
async function listYoutubePlaylistVideoIds(playlistUrl: string, dataRoot: string): Promise<string[]> {
  const args = [
    '--flat-playlist',
    '--skip-download',
    '--playlist-items',
    '1-10',
    '--print',
    '%(id)s',
    '--ignore-errors',
    '--no-write-playlist-metafiles',
    '--remote-components',
    'ejs:github',
    playlistUrl
  ]
  console.info(LOG, 'playlist sync: listing video ids', { playlistUrl: playlistUrl.slice(0, 96) })
  const out = await runYtDlpCaptureStdout(args, dataRoot)
  const ids: string[] = []
  for (const raw of out.split(/\r?\n/)) {
    const id = raw.trim()
    if (!id || id === 'NA' || id === 'None') continue
    if (!YOUTUBE_VIDEO_ID_RE.test(id)) {
      console.info(LOG, 'playlist sync: skip non-id print line', id.slice(0, 80))
      continue
    }
    ids.push(id)
  }
  console.info(LOG, 'playlist sync: listed video ids', { count: ids.length, ids })
  return ids
}

async function runSyncChannelsJobInner(dataRoot: string): Promise<void> {
  const lines = await readChannelsFile(dataRoot)
  const archiveAbs = join(dataRoot, 'downloaded.txt')
  const archiveMutex = createAsyncMutex()
  broadcastLog(
    `[ytdl] channels.txt: ${lines.length} lines (concurrency ${SYNC_DOWNLOAD_CONCURRENCY})\n`
  )
  console.info(LOG, 'channel sync starting', {
    count: lines.length,
    concurrency: SYNC_DOWNLOAD_CONCURRENCY,
    archiveAbs
  })
  await runWithConcurrency(lines, SYNC_DOWNLOAD_CONCURRENCY, async (channel_identifier) => {
    const label = channel_identifier
    const prefix = workerLogPrefix(label)
    const url = `https://www.youtube.com/${channel_identifier}/videos`
    broadcastLog(`\n${prefix}=== ${url} ===\n`)
    console.info(LOG, 'channel sync worker start', { label, url })
    await withTempDownloadArchive(archiveMutex, archiveAbs, async (tempArchive) => {
      const args = youtubeChannelLikeDownloadArgs({
        archivePath: tempArchive,
        urls: [url],
        playlistItems: '1-10'
      })
      const { code } = await runYtDlp(args, dataRoot, { logPrefix: prefix })
      if (code !== 0) {
        broadcastLog(`${prefix}warning: exit code ${code} for ${url}\n`)
        console.warn(LOG, 'channel sync worker non-zero exit', { label, url, code })
      } else {
        console.info(LOG, 'channel sync worker done', { label, url, code })
      }
    })
  })
  console.info(LOG, 'channel sync finished', { count: lines.length })
}

async function runSyncPlaylistsJobInner(dataRoot: string): Promise<void> {
  const playlistLines = await readPlaylistsLinesOrEmpty(dataRoot)
  const archiveAbs = join(dataRoot, 'downloaded.txt')
  const archiveMutex = createAsyncMutex()
  const seedIds = await readArchiveVideoIds(archiveAbs)
  const claims = createYoutubeIdClaimSet(seedIds)
  broadcastLog(
    `[ytdl] playlists.txt: ${playlistLines.length} lines (concurrency ${SYNC_DOWNLOAD_CONCURRENCY})\n`
  )
  console.info(LOG, 'playlist sync starting', {
    count: playlistLines.length,
    concurrency: SYNC_DOWNLOAD_CONCURRENCY,
    archiveSeedIds: seedIds.length,
    archiveAbs
  })
  await runWithConcurrency(playlistLines, SYNC_DOWNLOAD_CONCURRENCY, async (playlistUrl) => {
    const label = playlistLogLabel(playlistUrl)
    const prefix = workerLogPrefix(label)
    const logLabel =
      playlistUrl.length > 96 ? `${playlistUrl.slice(0, 96)}…` : playlistUrl
    broadcastLog(`\n${prefix}=== playlist ${logLabel} ===\n`)
    console.info(LOG, 'playlist sync worker start', { label, playlistUrl: logLabel })

    /** Download the playlist URL as-is (listing failed or returned no ids). */
    const downloadPlaylistUrl = async (): Promise<void> => {
      await withTempDownloadArchive(archiveMutex, archiveAbs, async (tempArchive) => {
        const args = youtubeChannelLikeDownloadArgs({
          archivePath: tempArchive,
          urls: [playlistUrl],
          playlistItems: '1-10'
        })
        const { code } = await runYtDlp(args, dataRoot, { logPrefix: prefix })
        if (code !== 0) {
          broadcastLog(`${prefix}warning: exit code ${code} for playlist\n`)
          console.warn(LOG, 'playlist sync worker non-zero exit', { label, code })
        } else {
          console.info(LOG, 'playlist sync worker done (playlist URL)', { label, code })
        }
      })
    }

    let ids: string[] = []
    try {
      ids = await listYoutubePlaylistVideoIds(playlistUrl, dataRoot)
    } catch (e) {
      console.warn(LOG, 'playlist sync: list ids failed; falling back to playlist URL', label, e)
      broadcastLog(`${prefix}warning: could not list video ids; downloading playlist URL\n`)
      await downloadPlaylistUrl()
      return
    }

    if (ids.length === 0) {
      console.warn(LOG, 'playlist sync: zero ids listed; falling back to playlist URL', label)
      broadcastLog(`${prefix}warning: listed 0 video ids; downloading playlist URL\n`)
      await downloadPlaylistUrl()
      return
    }

    const mine = await claims.claim(ids)
    broadcastLog(`${prefix}listed ${ids.length} id(s); claimed ${mine.length} new video(s)\n`)
    console.info(LOG, 'playlist sync claimed ids', { label, listed: ids.length, claimed: mine.length, mine })
    if (mine.length === 0) {
      broadcastLog(`${prefix}skip: all videos already claimed or in archive\n`)
      console.info(LOG, 'playlist sync skip (nothing to claim)', { label })
      return
    }

    const watchUrls = mine.map((id) => `https://www.youtube.com/watch?v=${id}`)
    await withTempDownloadArchive(archiveMutex, archiveAbs, async (tempArchive) => {
      const args = youtubeChannelLikeDownloadArgs({
        archivePath: tempArchive,
        urls: watchUrls
      })
      const { code } = await runYtDlp(args, dataRoot, { logPrefix: prefix })
      if (code !== 0) {
        broadcastLog(`${prefix}warning: exit code ${code} for playlist\n`)
        console.warn(LOG, 'playlist sync worker non-zero exit', { label, code, watchCount: watchUrls.length })
      } else {
        console.info(LOG, 'playlist sync worker done', { label, code, watchCount: watchUrls.length })
      }
    })
  })
  console.info(LOG, 'playlist sync finished', { count: playlistLines.length })
}

/** Recommended feed: mirrors scripts/download_videos.sh ytrec branch. */
export async function syncYtrecJob(dataRoot: string, count: number): Promise<void> {
  await withVideosLibraryWatchDuringJob(dataRoot, () => runSyncYtrecJobInner(dataRoot, count))
}

/** Podcast RSS: latest episodes as audio via yt-dlp (separate archive from YouTube). */
export async function syncPodcastsJob(dataRoot: string): Promise<void> {
  await withVideosLibraryWatchDuringJob(dataRoot, () => runSyncPodcastsJobInner(dataRoot))
}

/** Short temp dir for yt-dlp/ffmpeg post-process on Windows (avoids MAX_PATH on `*.temp.mp3`). */
function ytDlpWindowsTempPathArgs(): string[] {
  if (process.platform !== 'win32') return []
  const tempDir = join(tmpdir(), 'ytdl-temp')
  console.info(LOG, 'podcast sync: Windows temp path for yt-dlp', tempDir)
  return ['-P', `temp:${tempDir}`]
}

async function runSyncPodcastsJobInner(dataRoot: string): Promise<void> {
  const lines = await readPodcastsLinesOrEmpty(dataRoot)
  const archiveAbs = join(dataRoot, 'podcast-downloaded.txt')
  const archiveMutex = createAsyncMutex()
  broadcastLog(
    `[ytdl] podcasts.txt: ${lines.length} feeds (concurrency ${SYNC_DOWNLOAD_CONCURRENCY})\n`
  )
  console.info(LOG, 'podcast sync starting', {
    count: lines.length,
    concurrency: SYNC_DOWNLOAD_CONCURRENCY,
    archiveAbs
  })
  await runWithConcurrency(lines, SYNC_DOWNLOAD_CONCURRENCY, async (feedUrl) => {
    const folderId = folderIdFromFeedUrl(feedUrl)
    const prefix = workerLogPrefix(folderId)
    const outDir = join(dataRoot, 'videos', 'podcasts', folderId)
    await fs.mkdir(outDir, { recursive: true })
    const outTemplate = ytdlpPodcastOutputTemplate(folderId)
    const feedPreview = feedUrl.slice(0, 72)
    broadcastLog(`\n${prefix}=== podcast ${feedPreview}… ===\n`)
    broadcastLog(`${prefix}podcast: output template ${outTemplate}\n`)
    broadcastLog(`${prefix}podcast: yt-dlp write-thumbnail; post-sync repair embeds cover art\n`)
    console.info(LOG, 'podcast sync feed starting', {
      folderId,
      outTemplate,
      thumbnails: 'write-then-repair',
      feedPreview
    })
    await withTempDownloadArchive(archiveMutex, archiveAbs, async (tempArchive) => {
      // yt-dlp often records rotating Beehiiv/Simplecast CDN URLs as the archive id, so
      // `--download-archive` alone re-downloads the latest N after a library delete.
      // Gate on RSS <guid> (and enclosure aliases) before invoking yt-dlp.
      const rssItems = await loadPodcastRssWindow(feedUrl, PODCAST_SYNC_MAX_EPISODES)
      let playlistItems = `1-${PODCAST_SYNC_MAX_EPISODES}`
      let pending = rssItems
      if (rssItems.length > 0) {
        let archiveText = ''
        try {
          archiveText = await fs.readFile(tempArchive, 'utf-8')
        } catch (e) {
          console.warn(LOG, 'podcast sync: temp archive read failed; treat as empty', {
            folderId,
            tempArchive,
            e
          })
        }
        const archiveIds = archiveLookupIdSet(parseArchiveLines(archiveText))
        const alreadyArchived = rssItems.filter((item) => {
          const keys = podcastArchiveLookupKeys(item.guid, item.enclosureUrl)
          const archived = podcastItemAlreadyArchived(archiveIds, keys)
          console.info(LOG, 'podcast sync: rss item archive check', {
            folderId,
            playlistIndex: item.playlistIndex,
            titlePreview: item.title.slice(0, 48),
            guidPreview: item.guid.slice(0, 64),
            archived
          })
          return archived
        })
        pending = rssItems.filter((item) => !alreadyArchived.includes(item))
        // Upgrade filename/CDN archive hits to stable guids so a later URL rotation still skips.
        if (alreadyArchived.length > 0) {
          const upgraded = await appendArchiveRecords(
            tempArchive,
            alreadyArchived.map((item) => `generic ${item.guid}`)
          )
          console.info(LOG, 'podcast sync: upgraded archived items to rss guids', {
            folderId,
            upgraded,
            alreadyArchived: alreadyArchived.length
          })
        }
        if (pending.length === 0) {
          broadcastLog(
            `${prefix}podcast: latest ${rssItems.length} episode(s) already in podcast-downloaded.txt; skip download\n`
          )
          console.info(LOG, 'podcast sync: all window episodes archived, skip yt-dlp', {
            folderId,
            window: rssItems.length
          })
          return
        }
        playlistItems = formatPlaylistItemsSpec(pending.map((i) => i.playlistIndex))
        broadcastLog(
          `${prefix}podcast: ${pending.length}/${rssItems.length} episode(s) not in archive (items ${playlistItems})\n`
        )
        console.info(LOG, 'podcast sync: downloading pending rss items', {
          folderId,
          playlistItems,
          pending: pending.length,
          window: rssItems.length
        })
      } else {
        console.warn(LOG, 'podcast sync: rss window empty; falling back to yt-dlp playlist-items', {
          folderId,
          playlistItems
        })
        broadcastLog(
          `${prefix}podcast: could not parse RSS guids; falling back to items ${playlistItems}\n`
        )
      }
      const args = [
        '--playlist-items',
        playlistItems,
        '--download-archive',
        tempArchive,
        '--ignore-errors',
        '--no-write-playlist-metafiles',
        '--remote-components',
        'ejs:github',
        '--write-info-json',
        '--embed-metadata',
        '--write-thumbnail',
        '-f',
        'bestaudio/best',
        '-o',
        outTemplate,
        '--restrict-filenames',
        ...ytDlpWindowsTempPathArgs(),
        feedUrl
      ]
      const { code } = await runYtDlp(args, dataRoot, { logPrefix: prefix })
      if (code !== 0) {
        broadcastLog(`${prefix}warning: exit code ${code} for podcast feed\n`)
        console.warn(LOG, 'podcast sync feed non-zero exit', { folderId, code })
      } else {
        console.info(LOG, 'podcast sync feed yt-dlp done', { folderId, code })
      }
      // Record stable RSS guids so a later library delete does not look like a new episode.
      if (pending.length > 0 && rssItems.length > 0) {
        const guidLines = pending.map((item) => `generic ${item.guid}`)
        const added = await appendArchiveRecords(tempArchive, guidLines)
        broadcastLog(`${prefix}podcast: recorded ${added} RSS guid(s) in archive\n`)
        console.info(LOG, 'podcast sync: wrote rss guid archive lines', {
          folderId,
          added,
          attempted: guidLines.length,
          ytDlpCode: code
        })
      }
    })
    const thumbRepair = await repairPodcastEpisodeThumbnailsInFolder(outDir, folderId)
    if (thumbRepair.sidecarsFixed > 0 || thumbRepair.embedded > 0) {
      broadcastLog(
        `${prefix}podcast: thumbnails repaired sidecars=${thumbRepair.sidecarsFixed} embedded=${thumbRepair.embedded} failed=${thumbRepair.failed}\n`
      )
    }
    const migrated = await migrateUuidPodcastFilesToReadable(outDir)
    if (migrated.length > 0) {
      broadcastLog(`${prefix}podcast: renamed ${migrated.length} file(s) to readable titles\n`)
    }
    const removedLegacy = await cleanupLegacyPodcastDuplicatesInFolder(outDir)
    if (removedLegacy.length > 0) {
      broadcastLog(`${prefix}podcast: removed ${removedLegacy.length} legacy duplicate file(s)\n`)
      console.info(LOG, 'podcast cleanup after feed', { folderId, removed: removedLegacy.length })
    }
    console.info(LOG, 'podcast sync feed finished', { folderId })
  })
  console.info(LOG, 'podcast sync finished', { count: lines.length })
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
    '--no-write-playlist-metafiles',
    '--write-info-json',
    '--embed-metadata',
    '-f',
    'bestvideo[height<=720]+bestaudio/best[height<=720]',
    '-o',
    ytdlpYtrecOutputTemplate(),
    '--restrict-filenames',
    ':ytrec'
  ]
  broadcastLog(`[ytdl] ytrec count=${count}\n`)
  const { code } = await runYtDlp(args, dataRoot)
  if (code !== 0) {
    broadcastLog(`[ytdl] warning: ytrec exit code ${code}\n`)
  }
}
