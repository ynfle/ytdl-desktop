import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, normalize, resolve } from 'path'
import { promises as fs } from 'fs'
import type { ChannelInfoRow, PlaybackSpotPatch } from '../../shared/ytdl-api'
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
  broadcastDone
} from './broadcast'
import { getMediaAuth } from './media-server'
import { isChannelRowValidForAdd, normalizeChannelInput } from './channel-input'
import {
  appendChannelLine,
  readChannelsLinesOrEmpty,
  scanLibraryVideos
} from './library-scan'
import { loadPlaybackSpotForRoot, patchPlaybackSpot } from './playback-spot-cache'
import { syncChannelsJob, syncYtrecJob } from './sync-jobs'
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
}
