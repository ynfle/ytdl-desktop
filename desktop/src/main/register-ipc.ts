import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, normalize, resolve } from 'path'
import { promises as fs } from 'fs'
import type { ChannelInfoRow, PlaybackSpotPatch, PodcastInfoRow } from '../../shared/ytdl-api'
import {
  CHANNEL_META_TTL_MS,
  getCachedEntry,
  loadChannelMetaCache,
  saveChannelMetaCache,
  storedToRow,
  upsertChannelMeta
} from './channel-meta-cache'
import { state } from './app-state'
import {
  channelVideosUrl,
  enrichChannelRowWithLogo,
  resolveChannelRow
} from './channel-yt-dlp'
import { CHANNEL_RESOLVE_CONCURRENCY, LOG } from './constants'
import { getDataDir, isPathInsideRoot, saveConfig } from './config-store'
import {
  broadcastChannelProgress,
  broadcastChannelResolveDone,
  broadcastChannelRow,
  broadcastDone,
  broadcastPodcastProgress,
  broadcastPodcastResolveDone,
  broadcastPodcastRow
} from './broadcast'
import { getMediaAuth } from './media-server'
import { isChannelRowValidForAdd, normalizeChannelInput } from './channel-input'
import {
  appendChannelLine,
  appendPodcastLine,
  readChannelsLinesOrEmpty,
  readPodcastsLinesOrEmpty,
  removePodcastLine,
  scanLibraryVideos
} from './library-scan'
import {
  extractApplePodcastCollectionId,
  folderIdFromFeedUrl,
  isPodcastRowValidForAdd,
  normalizePodcastFeedUrl
} from './podcast-input'
import { searchApplePodcastsItunes, lookupApplePodcastFeed } from './podcast-itunes'
import {
  getPodcastCachedEntry,
  loadPodcastMetaCache,
  podcastStoredToRow,
  savePodcastMetaCache,
  upsertPodcastMeta
} from './podcast-meta-cache'
import { enrichPodcastRowWithLogo, resolvePodcastRowFromFeed } from './podcast-yt-dlp'
import { loadPlaybackSpotForRoot, patchPlaybackSpot } from './playback-spot-cache'
import { syncChannelsJob, syncPodcastsJob, syncYtrecJob } from './sync-jobs'
import { runWithConcurrency } from './yt-dlp-runner'

/**
 * Register every ipcMain.handle before loading the renderer so early invoke() (e.g. hydrate)
 * never hits "No handler registered" on a fast Vite dev load.
 */
export function registerAppIpc(): void {
  ipcMain.handle('config:getDataDir', () => getDataDir())

  ipcMain.handle('config:setDataDir', async (_e, dir: string) => {
    try {
      const resolved = resolve(dir)
      await fs.access(resolved)
      state.config.dataDir = resolved
      await saveConfig()
      return { ok: true as const }
    } catch (err) {
      console.error(LOG, 'setDataDir failed', err)
      return { ok: false as const, error: String(err) }
    }
  })

  ipcMain.handle('config:pickDataDir', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? state.mainWindow
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const r = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]!
  })

  ipcMain.handle('playback:loadSpot', async () => {
    try {
      const root = resolve(getDataDir())
      const snapshot = await loadPlaybackSpotForRoot(root)
      console.info(LOG, 'playback:loadSpot', { root, keys: Object.keys(snapshot.positions).length })
      return { ok: true as const, snapshot }
    } catch (e) {
      console.error(LOG, 'playback:loadSpot', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('playback:patchSpot', async (_e, patch: PlaybackSpotPatch) => {
    try {
      if (!patch || typeof patch !== 'object') {
        return { ok: false as const, error: 'invalid patch' }
      }
      const root = resolve(getDataDir())
      await patchPlaybackSpot(root, patch)
      return { ok: true as const }
    } catch (e) {
      console.error(LOG, 'playback:patchSpot', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('library:scan', async () => {
    try {
      const root = getDataDir()
      const videos = await scanLibraryVideos(root)
      return { ok: true as const, videos }
    } catch (e) {
      console.error(LOG, 'library:scan', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('channels:readIdentifiers', async () => {
    try {
      const root = getDataDir()
      const identifiers = await readChannelsLinesOrEmpty(root)
      return { ok: true as const, identifiers }
    } catch (e) {
      console.error(LOG, 'channels:readIdentifiers', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('channels:hydrateFromCache', async () => {
    try {
      const root = resolve(getDataDir())
      const lines = await readChannelsLinesOrEmpty(root)
      const cache = await loadChannelMetaCache()
      let cacheHits = 0
      const rows: ChannelInfoRow[] = await Promise.all(
        lines.map(async (identifier) => {
          const hit = getCachedEntry(cache, root, identifier, CHANNEL_META_TTL_MS, false)
          if (hit) {
            cacheHits++
            const base = storedToRow(identifier, hit)
            return enrichChannelRowWithLogo(root, identifier, base, hit.logoSourceUrl)
          }
          return {
            identifier,
            videosUrl: channelVideosUrl(identifier),
            displayName: null,
            channelPageUrl: null,
            error: null,
            logoUrl: null
          }
        })
      )
      console.info(LOG, 'channels:hydrateFromCache', { lines: rows.length, cacheHits })
      return { ok: true as const, rows }
    } catch (e) {
      console.error(LOG, 'channels:hydrateFromCache', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('channels:previewChannel', async (_e, raw: unknown) => {
    if (state.syncRunning) {
      return {
        ok: false as const,
        error: 'A download is in progress; try again when it finishes.'
      }
    }
    if (state.podcastMetaRunning) {
      return {
        ok: false as const,
        error: 'Podcast metadata refresh is running; wait for it to finish.'
      }
    }
    if (state.channelMetaRunning) {
      return {
        ok: false as const,
        error: 'Channel lookup is already running; wait for it to finish.'
      }
    }
    if (typeof raw !== 'string') {
      return { ok: false as const, error: 'Invalid input.' }
    }
    const identifier = normalizeChannelInput(raw)
    if (!identifier) {
      return {
        ok: false as const,
        error: 'Enter a YouTube channel URL or slug (@handle, c/name, channel/UC…).'
      }
    }
    const root = resolve(getDataDir())
    try {
      const lines = await readChannelsLinesOrEmpty(root)
      if (lines.includes(identifier)) {
        return { ok: false as const, error: 'This channel is already in channels.txt.' }
      }
    } catch (e) {
      console.error(LOG, 'channels:previewChannel read list', e)
      return { ok: false as const, error: String(e) }
    }

    try {
      const { row, logoSourceUrl } = await resolveChannelRow(root, identifier)
      if (!isChannelRowValidForAdd(row)) {
        console.warn(LOG, 'channels:previewChannel row failed validation', identifier, {
          hasName: Boolean(row.displayName?.trim()),
          hasLogo: Boolean(row.logoUrl),
          rowError: row.error
        })
        return {
          ok: false as const,
          error:
            'Could not resolve this channel’s name and profile picture. Check the URL or slug and try again.'
        }
      }
      const cache = await loadChannelMetaCache()
      upsertChannelMeta(cache, root, identifier, row, logoSourceUrl)
      await saveChannelMetaCache(cache)
      console.info(LOG, 'channels:previewChannel ok', { identifier, displayName: row.displayName })
      return { ok: true as const, identifier, row }
    } catch (e) {
      console.error(LOG, 'channels:previewChannel', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('channels:addChannel', async (_e, identifierParam: unknown) => {
    if (state.syncRunning) {
      return {
        ok: false as const,
        error: 'A download is in progress; try again when it finishes.'
      }
    }
    if (state.podcastMetaRunning) {
      return {
        ok: false as const,
        error: 'Podcast metadata refresh is running; wait for it to finish.'
      }
    }
    if (typeof identifierParam !== 'string') {
      return { ok: false as const, error: 'Invalid identifier.' }
    }
    const identifier = normalizeChannelInput(identifierParam)
    if (!identifier) {
      return { ok: false as const, error: 'Invalid channel identifier.' }
    }
    const root = resolve(getDataDir())
    try {
      const lines = await readChannelsLinesOrEmpty(root)
      if (lines.includes(identifier)) {
        return { ok: false as const, duplicate: true as const }
      }
    } catch (e) {
      console.error(LOG, 'channels:addChannel read list', e)
      return { ok: false as const, error: String(e) }
    }

    const cache = await loadChannelMetaCache()
    let rowForAppend: ChannelInfoRow | null = null

    const hit = getCachedEntry(cache, root, identifier, CHANNEL_META_TTL_MS, false)
    if (hit) {
      const base = storedToRow(identifier, hit)
      const row = await enrichChannelRowWithLogo(root, identifier, base, hit.logoSourceUrl)
      if (isChannelRowValidForAdd(row)) {
        rowForAppend = row
        console.info(LOG, 'channels:addChannel using cached meta', identifier)
      }
    }

    if (!rowForAppend) {
      try {
        const { row, logoSourceUrl } = await resolveChannelRow(root, identifier)
        if (!isChannelRowValidForAdd(row)) {
          console.warn(LOG, 'channels:addChannel re-resolve invalid', identifier)
          return {
            ok: false as const,
            error:
              'Could not verify channel (name and profile picture required). Use Look up again, then Add.'
          }
        }
        upsertChannelMeta(cache, root, identifier, row, logoSourceUrl)
        await saveChannelMetaCache(cache)
        rowForAppend = row
        console.info(LOG, 'channels:addChannel resolved fresh', identifier)
      } catch (e) {
        console.error(LOG, 'channels:addChannel resolve', e)
        return { ok: false as const, error: String(e) }
      }
    }

    const append = await appendChannelLine(root, identifier)
    if (append.ok) {
      console.info(LOG, 'channels:addChannel appended', identifier)
      return { ok: true as const }
    }
    if ('duplicate' in append && append.duplicate) {
      return { ok: false as const, duplicate: true as const }
    }
    return { ok: false as const, error: 'error' in append ? append.error : 'Could not write channels.txt.' }
  })

  ipcMain.handle('channels:resolveInfo', (_e, opts?: { force?: boolean }) => {
    if (state.syncRunning) {
      return { ok: false as const, error: 'A download is in progress; try again when it finishes.' }
    }
    if (state.podcastMetaRunning) {
      return { ok: false as const, error: 'Podcast metadata refresh is running.' }
    }
    if (state.channelMetaRunning) {
      return { ok: false as const, error: 'Channel lookup is already running.' }
    }
    state.channelMetaRunning = true
    const forceRefresh = Boolean(opts?.force)

    /**
     * Run after invoke reply is sent. If the loop lived inside this handler, the renderer would stay
     * blocked on `invoke()` and Chromium would not deliver `channels:resolveRow` until the handler returned.
     */
    setImmediate(() => {
      void (async () => {
        const cache = await loadChannelMetaCache()
        try {
          const root = resolve(getDataDir())
          const lines = await readChannelsLinesOrEmpty(root)
          const total = lines.length
          const rows: (ChannelInfoRow | undefined)[] = new Array(total)
          let progressCounter = 0

          const toFetch: { index: number; identifier: string }[] = []
          for (let i = 0; i < total; i++) {
            const identifier = lines[i]!
            const hit = getCachedEntry(cache, root, identifier, CHANNEL_META_TTL_MS, forceRefresh)
            if (hit) {
              const base = storedToRow(identifier, hit)
              const row = await enrichChannelRowWithLogo(root, identifier, base, hit.logoSourceUrl)
              rows[i] = row
              broadcastChannelRow({ index: i, row })
              progressCounter++
              broadcastChannelProgress({ index: progressCounter, total, identifier })
            } else {
              toFetch.push({ index: i, identifier })
            }
          }

          await runWithConcurrency(toFetch, CHANNEL_RESOLVE_CONCURRENCY, async ({ index, identifier }) => {
            const { row, logoSourceUrl } = await resolveChannelRow(root, identifier)
            rows[index] = row
            upsertChannelMeta(cache, root, identifier, row, logoSourceUrl)
            broadcastChannelRow({ index, row })
            progressCounter++
            broadcastChannelProgress({ index: progressCounter, total, identifier: row.identifier })
          })

          await saveChannelMetaCache(cache)
          const finalRows = lines.map((identifier, i) =>
            rows[i] ?? {
              identifier,
              videosUrl: channelVideosUrl(identifier),
              displayName: null,
              channelPageUrl: null,
              error: 'internal: row missing',
              logoUrl: null
            }
          )
          console.info(LOG, 'channels:resolveInfo done', {
            total,
            network: toFetch.length,
            cacheHits: total - toFetch.length,
            parallel: CHANNEL_RESOLVE_CONCURRENCY
          })
          broadcastChannelResolveDone({ ok: true, rows: finalRows })
        } catch (e) {
          console.error(LOG, 'channels:resolveInfo', e)
          try {
            await saveChannelMetaCache(cache)
          } catch (saveErr) {
            console.warn(LOG, 'channel cache save after error', saveErr)
          }
          broadcastChannelResolveDone({ ok: false, error: String(e) })
        } finally {
          state.channelMetaRunning = false
        }
      })()
    })

    return { ok: true as const, started: true as const }
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      return { ok: false as const, error: 'Only https:// URLs are allowed' }
    }
    try {
      await shell.openExternal(url)
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('library:mediaUrl', async (_e, relPath: string) => {
    try {
      const auth = getMediaAuth()
      if (!auth) {
        return { ok: false as const, error: 'loopback media server not ready' }
      }
      const root = getDataDir()
      const full = normalize(join(root, relPath))
      if (!isPathInsideRoot(root, full)) {
        return { ok: false as const, error: 'path not allowed' }
      }
      await fs.access(full)
      const token = Buffer.from(relPath, 'utf8').toString('base64url')
      const url = `http://127.0.0.1:${auth.port}/${auth.secret}/${token}`
      return { ok: true as const, url }
    } catch (e) {
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('sync:channels', async () => {
    if (state.channelMetaRunning) {
      return { ok: false as const, error: 'Channel name lookup in progress' }
    }
    if (state.podcastMetaRunning) {
      return { ok: false as const, error: 'Podcast metadata refresh in progress' }
    }
    if (state.syncRunning) {
      return { ok: false as const, error: 'Sync already running' }
    }
    state.syncRunning = true
    const root = getDataDir()
    try {
      await syncChannelsJob(root)
      broadcastDone({ ok: true })
      return { ok: true as const }
    } catch (e) {
      const msg = String(e)
      console.error(LOG, 'sync:channels', e)
      broadcastDone({ ok: false, error: msg })
      return { ok: false as const, error: msg }
    } finally {
      state.syncRunning = false
    }
  })

  ipcMain.handle('sync:ytrec', async (_e, count: number) => {
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false as const, error: 'count must be a positive integer' }
    }
    if (state.channelMetaRunning) {
      return { ok: false as const, error: 'Channel name lookup in progress' }
    }
    if (state.podcastMetaRunning) {
      return { ok: false as const, error: 'Podcast metadata refresh in progress' }
    }
    if (state.syncRunning) {
      return { ok: false as const, error: 'Sync already running' }
    }
    state.syncRunning = true
    const root = getDataDir()
    try {
      await syncYtrecJob(root, count)
      broadcastDone({ ok: true })
      return { ok: true as const }
    } catch (e) {
      const msg = String(e)
      console.error(LOG, 'sync:ytrec', e)
      broadcastDone({ ok: false, error: msg })
      return { ok: false as const, error: msg }
    } finally {
      state.syncRunning = false
    }
  })

  ipcMain.handle('podcasts:searchApplePodcasts', async (_e, term: unknown) => {
    if (typeof term !== 'string' || !term.trim()) {
      return { ok: false as const, error: 'Enter a search term.' }
    }
    try {
      const results = await searchApplePodcastsItunes(term)
      return { ok: true as const, results }
    } catch (e) {
      console.error(LOG, 'podcasts:searchApplePodcasts', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('podcasts:previewPodcast', async (_e, raw: unknown, invOpts: unknown) => {
    if (state.syncRunning) {
      return {
        ok: false as const,
        error: 'A download is in progress; try again when it finishes.'
      }
    }
    if (state.channelMetaRunning) {
      return {
        ok: false as const,
        error: 'Channel name lookup is running; wait for it to finish.'
      }
    }
    if (state.podcastMetaRunning) {
      return {
        ok: false as const,
        error: 'Podcast metadata refresh is running; wait for it to finish.'
      }
    }
    if (typeof raw !== 'string') {
      return { ok: false as const, error: 'Invalid input.' }
    }
    const artworkFromOpts =
      typeof invOpts === 'object' &&
      invOpts !== null &&
      'artworkUrl' in invOpts &&
      typeof (invOpts as { artworkUrl?: unknown }).artworkUrl === 'string'
        ? (invOpts as { artworkUrl: string }).artworkUrl
        : null

    const root = resolve(getDataDir())
    let feedUrl: string | null = null
    let prefetchedArtwork: string | null = artworkFromOpts
    let feedPageUrl: string | null = null

    const trimmed = raw.trim()
    const normalizedDirect = normalizePodcastFeedUrl(trimmed)
    const appleId = extractApplePodcastCollectionId(trimmed)
    const looksApple = /podcasts\.apple\.com/i.test(trimmed) || /itunes\.apple\.com/i.test(trimmed)

    if (appleId && looksApple) {
      try {
        const lu = await lookupApplePodcastFeed(appleId)
        if (!lu.feedUrl) {
          return {
            ok: false as const,
            error: 'Could not resolve this Apple Podcasts link to an RSS feed.'
          }
        }
        const canon = normalizePodcastFeedUrl(lu.feedUrl)
        if (!canon) {
          return { ok: false as const, error: 'Feed URL from Apple was not a valid https URL.' }
        }
        feedUrl = canon
        if (!prefetchedArtwork && lu.artworkUrl) prefetchedArtwork = lu.artworkUrl
        const pageCanon = normalizePodcastFeedUrl(trimmed)
        feedPageUrl = pageCanon ?? (trimmed.startsWith('https://') ? trimmed : null)
      } catch (e) {
        console.error(LOG, 'podcasts:previewPodcast apple lookup', e)
        return { ok: false as const, error: String(e) }
      }
    } else if (normalizedDirect) {
      feedUrl = normalizedDirect
    } else {
      return {
        ok: false as const,
        error: 'Enter an https:// RSS feed URL or a podcasts.apple.com show link.'
      }
    }

    try {
      const existing = await readPodcastsLinesOrEmpty(root)
      if (existing.includes(feedUrl)) {
        return { ok: false as const, error: 'This podcast is already in podcasts.txt.' }
      }
    } catch (e) {
      console.error(LOG, 'podcasts:previewPodcast read list', e)
      return { ok: false as const, error: String(e) }
    }

    try {
      const { row, logoSourceUrl } = await resolvePodcastRowFromFeed(root, feedUrl, {
        prefetchedArtworkUrl: prefetchedArtwork,
        feedPageUrl
      })
      if (!isPodcastRowValidForAdd(row)) {
        console.warn(LOG, 'podcasts:previewPodcast validation failed', feedUrl.slice(0, 60), row)
        return {
          ok: false as const,
          error:
            row.error ??
            'Could not resolve this podcast’s title. Check the feed URL and try again.'
        }
      }
      const cache = await loadPodcastMetaCache()
      upsertPodcastMeta(cache, root, feedUrl, row, logoSourceUrl)
      await savePodcastMetaCache(cache)
      console.info(LOG, 'podcasts:previewPodcast ok', {
        feedPreview: feedUrl.slice(0, 48),
        name: row.displayName
      })
      return { ok: true as const, feedUrl, row }
    } catch (e) {
      console.error(LOG, 'podcasts:previewPodcast', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('podcasts:addPodcast', async (_e, feedUrlParam: unknown) => {
    if (state.syncRunning) {
      return {
        ok: false as const,
        error: 'A download is in progress; try again when it finishes.'
      }
    }
    if (state.channelMetaRunning) {
      return {
        ok: false as const,
        error: 'Channel name lookup is running; wait for it to finish.'
      }
    }
    if (state.podcastMetaRunning) {
      return {
        ok: false as const,
        error: 'Podcast metadata refresh is running; wait for it to finish.'
      }
    }
    if (typeof feedUrlParam !== 'string') {
      return { ok: false as const, error: 'Invalid feed URL.' }
    }
    const feedUrl = normalizePodcastFeedUrl(feedUrlParam)
    if (!feedUrl) {
      return { ok: false as const, error: 'Invalid feed URL.' }
    }
    const root = resolve(getDataDir())
    try {
      const lines = await readPodcastsLinesOrEmpty(root)
      if (lines.includes(feedUrl)) {
        return { ok: false as const, duplicate: true as const }
      }
    } catch (e) {
      return { ok: false as const, error: String(e) }
    }

    const cache = await loadPodcastMetaCache()
    let rowForAppend: PodcastInfoRow | null = null

    const hit = getPodcastCachedEntry(cache, root, feedUrl, CHANNEL_META_TTL_MS, false)
    if (hit) {
      const base = podcastStoredToRow(feedUrl, hit)
      const row = await enrichPodcastRowWithLogo(base.folderId, base, hit.logoSourceUrl)
      if (isPodcastRowValidForAdd(row)) {
        rowForAppend = row
        console.info(LOG, 'podcasts:addPodcast using cached meta', feedUrl.slice(0, 48))
      }
    }

    if (!rowForAppend) {
      try {
        const { row, logoSourceUrl } = await resolvePodcastRowFromFeed(root, feedUrl, {})
        if (!isPodcastRowValidForAdd(row)) {
          return {
            ok: false as const,
            error:
              'Could not verify podcast (title required). Use Look up again, then Add.'
          }
        }
        upsertPodcastMeta(cache, root, feedUrl, row, logoSourceUrl)
        await savePodcastMetaCache(cache)
        rowForAppend = row
        console.info(LOG, 'podcasts:addPodcast resolved fresh', feedUrl.slice(0, 48))
      } catch (e) {
        console.error(LOG, 'podcasts:addPodcast resolve', e)
        return { ok: false as const, error: String(e) }
      }
    }

    const append = await appendPodcastLine(root, feedUrl)
    if (append.ok) {
      console.info(LOG, 'podcasts:addPodcast appended', feedUrl.slice(0, 48))
      return { ok: true as const }
    }
    if ('duplicate' in append && append.duplicate) {
      return { ok: false as const, duplicate: true as const }
    }
    return {
      ok: false as const,
      error: 'error' in append ? append.error : 'Could not write podcasts.txt.'
    }
  })

  ipcMain.handle('podcasts:removePodcast', async (_e, feedUrlParam: unknown) => {
    if (state.syncRunning) {
      return {
        ok: false as const,
        error: 'A download is in progress; try again when it finishes.'
      }
    }
    if (typeof feedUrlParam !== 'string' || !feedUrlParam.trim()) {
      return { ok: false as const, error: 'Invalid feed URL.' }
    }
    const root = resolve(getDataDir())
    const normalized = normalizePodcastFeedUrl(feedUrlParam)
    const lines = await readPodcastsLinesOrEmpty(root)
    const match =
      lines.find((l) => l === feedUrlParam.trim()) ??
      (normalized ? lines.find((l) => normalizePodcastFeedUrl(l) === normalized) : undefined)
    if (!match) {
      return { ok: false as const, notFound: true as const }
    }
    const r = await removePodcastLine(root, match)
    if (r.ok) {
      console.info(LOG, 'podcasts:removePodcast', match.slice(0, 48))
      return { ok: true as const }
    }
    if ('notFound' in r && r.notFound) {
      return { ok: false as const, notFound: true as const }
    }
    return { ok: false as const, error: 'error' in r ? r.error : 'Remove failed.' }
  })

  ipcMain.handle('podcasts:readFeeds', async () => {
    try {
      const root = getDataDir()
      const feeds = await readPodcastsLinesOrEmpty(root)
      return { ok: true as const, feeds }
    } catch (e) {
      console.error(LOG, 'podcasts:readFeeds', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('podcasts:hydrateFromCache', async () => {
    try {
      const root = resolve(getDataDir())
      const lines = await readPodcastsLinesOrEmpty(root)
      const cache = await loadPodcastMetaCache()
      const rows: PodcastInfoRow[] = await Promise.all(
        lines.map(async (feedUrl) => {
          const hit = getPodcastCachedEntry(cache, root, feedUrl, CHANNEL_META_TTL_MS, false)
          if (hit) {
            const base = podcastStoredToRow(feedUrl, hit)
            return enrichPodcastRowWithLogo(base.folderId, base, hit.logoSourceUrl)
          }
          const folderId = folderIdFromFeedUrl(feedUrl)
          return {
            feedUrl,
            folderId,
            displayName: null,
            feedPageUrl: null,
            error: null,
            logoUrl: null
          }
        })
      )
      console.info(LOG, 'podcasts:hydrateFromCache', { lines: rows.length })
      return { ok: true as const, rows }
    } catch (e) {
      console.error(LOG, 'podcasts:hydrateFromCache', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('podcasts:resolveInfo', (_e, opts?: { force?: boolean }) => {
    if (state.syncRunning) {
      return { ok: false as const, error: 'A download is in progress; try again when it finishes.' }
    }
    if (state.channelMetaRunning) {
      return { ok: false as const, error: 'Channel name lookup is already running.' }
    }
    if (state.podcastMetaRunning) {
      return { ok: false as const, error: 'Podcast metadata refresh is already running.' }
    }
    state.podcastMetaRunning = true
    const forceRefresh = Boolean(opts?.force)

    setImmediate(() => {
      void (async () => {
        const cache = await loadPodcastMetaCache()
        try {
          const root = resolve(getDataDir())
          const lines = await readPodcastsLinesOrEmpty(root)
          const total = lines.length
          const rows: (PodcastInfoRow | undefined)[] = new Array(total)
          let progressCounter = 0

          const toFetch: { index: number; feedUrl: string }[] = []
          for (let i = 0; i < total; i++) {
            const feedUrl = lines[i]!
            const hit = getPodcastCachedEntry(cache, root, feedUrl, CHANNEL_META_TTL_MS, forceRefresh)
            if (hit) {
              const base = podcastStoredToRow(feedUrl, hit)
              const row = await enrichPodcastRowWithLogo(base.folderId, base, hit.logoSourceUrl)
              rows[i] = row
              broadcastPodcastRow({ index: i, row })
              progressCounter++
              broadcastPodcastProgress({ index: progressCounter, total, feedUrl })
            } else {
              toFetch.push({ index: i, feedUrl })
            }
          }

          await runWithConcurrency(toFetch, CHANNEL_RESOLVE_CONCURRENCY, async ({ index, feedUrl }) => {
            const { row, logoSourceUrl } = await resolvePodcastRowFromFeed(root, feedUrl, {})
            rows[index] = row
            upsertPodcastMeta(cache, root, feedUrl, row, logoSourceUrl)
            broadcastPodcastRow({ index, row })
            progressCounter++
            broadcastPodcastProgress({ index: progressCounter, total, feedUrl })
          })

          await savePodcastMetaCache(cache)
          const finalRows = lines.map((feedUrl, i) => {
            return (
              rows[i] ?? {
                feedUrl,
                folderId: folderIdFromFeedUrl(feedUrl),
                displayName: null,
                feedPageUrl: null,
                error: 'internal: row missing',
                logoUrl: null
              }
            )
          })
          console.info(LOG, 'podcasts:resolveInfo done', {
            total,
            network: toFetch.length,
            cacheHits: total - toFetch.length
          })
          broadcastPodcastResolveDone({ ok: true, rows: finalRows })
        } catch (e) {
          console.error(LOG, 'podcasts:resolveInfo', e)
          try {
            await savePodcastMetaCache(cache)
          } catch (saveErr) {
            console.warn(LOG, 'podcast cache save after error', saveErr)
          }
          broadcastPodcastResolveDone({ ok: false, error: String(e) })
        } finally {
          state.podcastMetaRunning = false
        }
      })()
    })

    return { ok: true as const, started: true as const }
  })

  ipcMain.handle('sync:podcasts', async () => {
    if (state.channelMetaRunning) {
      return { ok: false as const, error: 'Channel name lookup in progress' }
    }
    if (state.podcastMetaRunning) {
      return { ok: false as const, error: 'Podcast metadata refresh in progress' }
    }
    if (state.syncRunning) {
      return { ok: false as const, error: 'Sync already running' }
    }
    state.syncRunning = true
    const root = getDataDir()
    try {
      await syncPodcastsJob(root)
      broadcastDone({ ok: true })
      return { ok: true as const }
    } catch (e) {
      const msg = String(e)
      console.error(LOG, 'sync:podcasts', e)
      broadcastDone({ ok: false, error: msg })
      return { ok: false as const, error: msg }
    } finally {
      state.syncRunning = false
    }
  })
}
