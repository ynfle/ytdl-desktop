import { ipcMain } from 'electron'
import { resolve } from 'path'
import type { ChannelInfoRow } from '../../shared/ytdl-api'
import {
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
import { getDataDir } from './config-store'
import {
  broadcastChannelProgress,
  broadcastChannelResolveDone,
  broadcastChannelRow
} from './broadcast'
import { isChannelRowValidForAdd, normalizeChannelInput } from './channel-input'
import { appendChannelLine, readChannelsLinesOrEmpty, removeChannelLine } from './library-scan'
import { runWithConcurrency } from './yt-dlp-runner'
import { DISPLAY_META_TTL_MS } from './constants'

export function registerChannelsIpc(): void {
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
          const hit = getCachedEntry(cache, root, identifier, DISPLAY_META_TTL_MS, false)
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
    if (state.playlistMetaRunning) {
      return {
        ok: false as const,
        error: 'Playlist metadata refresh is running; wait for it to finish.'
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
    if (state.playlistMetaRunning) {
      return {
        ok: false as const,
        error: 'Playlist metadata refresh is running; wait for it to finish.'
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

    const hit = getCachedEntry(cache, root, identifier, DISPLAY_META_TTL_MS, false)
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

  ipcMain.handle('channels:removeChannel', async (_e, identifierParam: unknown) => {
    /** Match {@link podcasts:removePodcast}: only block active media sync (yt-dlp download). */
    if (state.syncRunning) {
      return {
        ok: false as const,
        error: 'A download is in progress; try again when it finishes.'
      }
    }
    if (typeof identifierParam !== 'string' || !identifierParam.trim()) {
      return { ok: false as const, error: 'Invalid channel identifier.' }
    }
    const root = resolve(getDataDir())
    const needle = identifierParam.trim()
    const r = await removeChannelLine(root, needle)
    if (r.ok) {
      console.info(LOG, 'channels:removeChannel', needle)
      return { ok: true as const }
    }
    if ('notFound' in r && r.notFound) {
      return { ok: false as const, notFound: true as const }
    }
    return { ok: false as const, error: 'error' in r ? r.error : 'Remove failed.' }
  })

  ipcMain.handle('channels:resolveInfo', (_e, opts?: { force?: boolean }) => {
    if (state.syncRunning) {
      return { ok: false as const, error: 'A download is in progress; try again when it finishes.' }
    }
    if (state.podcastMetaRunning) {
      return { ok: false as const, error: 'Podcast metadata refresh is running.' }
    }
    if (state.playlistMetaRunning) {
      return { ok: false as const, error: 'Playlist metadata refresh is running.' }
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
            const hit = getCachedEntry(cache, root, identifier, DISPLAY_META_TTL_MS, forceRefresh)
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
}
