import { ipcMain } from 'electron'
import { resolve } from 'path'
import type { PodcastInfoRow } from '../../shared/ytdl-api'
import { state } from './app-state'
import { CHANNEL_RESOLVE_CONCURRENCY, LOG } from './constants'
import { getDataDir } from './config-store'
import {
  broadcastPodcastProgress,
  broadcastPodcastResolveDone,
  broadcastPodcastRow
} from './broadcast'
import {
  appendPodcastLine,
  readPodcastsLinesOrEmpty,
  removePodcastLine
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
import { runWithConcurrency } from './yt-dlp-runner'
import { DISPLAY_META_TTL_MS } from './constants'

export function registerPodcastsIpc(): void {
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

    const hit = getPodcastCachedEntry(cache, root, feedUrl, DISPLAY_META_TTL_MS, false)
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
          const hit = getPodcastCachedEntry(cache, root, feedUrl, DISPLAY_META_TTL_MS, false)
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
            const hit = getPodcastCachedEntry(cache, root, feedUrl, DISPLAY_META_TTL_MS, forceRefresh)
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
}
