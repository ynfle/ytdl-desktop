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
import { enrichChannelRowWithLogo } from './channel-yt-dlp'
import { state } from './app-state'
import { CHANNEL_RESOLVE_CONCURRENCY, DISPLAY_META_TTL_MS, LOG } from './constants'
import { getDataDir } from './config-store'
import {
  broadcastPlaylistProgress,
  broadcastPlaylistResolveDone,
  broadcastPlaylistRow
} from './broadcast'
import { isPlaylistRowValidForAdd, normalizePlaylistInput } from './playlist-input'
import { resolvePlaylistRow } from './playlist-yt-dlp'
import { appendPlaylistLine, readPlaylistsLinesOrEmpty, removePlaylistLine } from './library-scan'
import { runWithConcurrency } from './yt-dlp-runner'

export function registerPlaylistsIpc(): void {
  ipcMain.handle('playlists:readUrls', async () => {
    try {
      const root = getDataDir()
      const urls = await readPlaylistsLinesOrEmpty(root)
      return { ok: true as const, urls }
    } catch (e) {
      console.error(LOG, 'playlists:readUrls', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('playlists:hydrateFromCache', async () => {
    try {
      const root = resolve(getDataDir())
      const lines = await readPlaylistsLinesOrEmpty(root)
      const cache = await loadChannelMetaCache()
      let cacheHits = 0
      const rows: ChannelInfoRow[] = await Promise.all(
        lines.map(async (playlistUrl) => {
          const hit = getCachedEntry(cache, root, playlistUrl, DISPLAY_META_TTL_MS, false)
          if (hit) {
            cacheHits++
            const base = storedToRow(playlistUrl, hit)
            return enrichChannelRowWithLogo(root, playlistUrl, base, hit.logoSourceUrl)
          }
          return {
            identifier: playlistUrl,
            videosUrl: playlistUrl,
            displayName: null,
            channelPageUrl: null,
            error: null,
            logoUrl: null
          }
        })
      )
      console.info(LOG, 'playlists:hydrateFromCache', { lines: rows.length, cacheHits })
      return { ok: true as const, rows }
    } catch (e) {
      console.error(LOG, 'playlists:hydrateFromCache', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('playlists:preview', async (_e, raw: unknown) => {
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
    if (state.playlistMetaRunning) {
      return {
        ok: false as const,
        error: 'Playlist lookup is already running; wait for it to finish.'
      }
    }
    if (typeof raw !== 'string') {
      return { ok: false as const, error: 'Invalid input.' }
    }
    const playlistUrl = normalizePlaylistInput(raw)
    if (!playlistUrl) {
      return {
        ok: false as const,
        error: 'Enter a YouTube playlist URL, a watch URL with list=…, or a playlist id (e.g. PL…).'
      }
    }
    const root = resolve(getDataDir())
    try {
      const lines = await readPlaylistsLinesOrEmpty(root)
      if (lines.includes(playlistUrl)) {
        return { ok: false as const, error: 'This playlist is already in playlists.txt.' }
      }
    } catch (e) {
      console.error(LOG, 'playlists:preview read list', e)
      return { ok: false as const, error: String(e) }
    }

    try {
      const { row, logoSourceUrl } = await resolvePlaylistRow(root, playlistUrl)
      if (!isPlaylistRowValidForAdd(row)) {
        console.warn(LOG, 'playlists:preview row failed validation', playlistUrl.slice(0, 48), {
          hasName: Boolean(row.displayName?.trim()),
          hasLogo: Boolean(row.logoUrl),
          rowError: row.error
        })
        return {
          ok: false as const,
          error:
            'Could not resolve this playlist’s title and thumbnail. Check the URL or try again later.'
        }
      }
      const cache = await loadChannelMetaCache()
      upsertChannelMeta(cache, root, playlistUrl, row, logoSourceUrl)
      await saveChannelMetaCache(cache)
      console.info(LOG, 'playlists:preview ok', { urlPreview: playlistUrl.slice(0, 48), title: row.displayName })
      return { ok: true as const, playlistUrl, row }
    } catch (e) {
      console.error(LOG, 'playlists:preview', e)
      return { ok: false as const, error: String(e) }
    }
  })

  ipcMain.handle('playlists:add', async (_e, urlParam: unknown) => {
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
    if (state.playlistMetaRunning) {
      return {
        ok: false as const,
        error: 'Playlist metadata refresh is running; wait for it to finish.'
      }
    }
    if (typeof urlParam !== 'string') {
      return { ok: false as const, error: 'Invalid playlist URL.' }
    }
    const playlistUrl = normalizePlaylistInput(urlParam)
    if (!playlistUrl) {
      return { ok: false as const, error: 'Invalid playlist URL.' }
    }
    const root = resolve(getDataDir())
    try {
      const lines = await readPlaylistsLinesOrEmpty(root)
      if (lines.includes(playlistUrl)) {
        return { ok: false as const, duplicate: true as const }
      }
    } catch (e) {
      console.error(LOG, 'playlists:add read list', e)
      return { ok: false as const, error: String(e) }
    }

    const cache = await loadChannelMetaCache()
    let rowForAppend: ChannelInfoRow | null = null

    const hit = getCachedEntry(cache, root, playlistUrl, DISPLAY_META_TTL_MS, false)
    if (hit) {
      const base = storedToRow(playlistUrl, hit)
      const row = await enrichChannelRowWithLogo(root, playlistUrl, base, hit.logoSourceUrl)
      if (isPlaylistRowValidForAdd(row)) {
        rowForAppend = row
        console.info(LOG, 'playlists:add using cached meta', playlistUrl.slice(0, 48))
      }
    }

    if (!rowForAppend) {
      try {
        const { row, logoSourceUrl } = await resolvePlaylistRow(root, playlistUrl)
        if (!isPlaylistRowValidForAdd(row)) {
          console.warn(LOG, 'playlists:add re-resolve invalid', playlistUrl.slice(0, 48))
          return {
            ok: false as const,
            error:
              'Could not verify playlist (title and thumbnail required). Use Look up again, then Add.'
          }
        }
        upsertChannelMeta(cache, root, playlistUrl, row, logoSourceUrl)
        await saveChannelMetaCache(cache)
        rowForAppend = row
        console.info(LOG, 'playlists:add resolved fresh', playlistUrl.slice(0, 48))
      } catch (e) {
        console.error(LOG, 'playlists:add resolve', e)
        return { ok: false as const, error: String(e) }
      }
    }

    const append = await appendPlaylistLine(root, playlistUrl)
    if (append.ok) {
      console.info(LOG, 'playlists:add appended', playlistUrl.slice(0, 48))
      return { ok: true as const }
    }
    if ('duplicate' in append && append.duplicate) {
      return { ok: false as const, duplicate: true as const }
    }
    return { ok: false as const, error: 'error' in append ? append.error : 'Could not write playlists.txt.' }
  })

  ipcMain.handle('playlists:removePlaylist', async (_e, urlParam: unknown) => {
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
    if (state.playlistMetaRunning) {
      return {
        ok: false as const,
        error: 'Playlist metadata refresh is running; wait for it to finish.'
      }
    }
    if (typeof urlParam !== 'string' || !urlParam.trim()) {
      return { ok: false as const, error: 'Invalid playlist URL.' }
    }
    const root = resolve(getDataDir())
    const needle = urlParam.trim()
    const r = await removePlaylistLine(root, needle)
    if (r.ok) {
      console.info(LOG, 'playlists:removePlaylist', needle.slice(0, 72))
      return { ok: true as const }
    }
    if ('notFound' in r && r.notFound) {
      return { ok: false as const, notFound: true as const }
    }
    return { ok: false as const, error: 'error' in r ? r.error : 'Remove failed.' }
  })

  ipcMain.handle('playlists:resolveInfo', (_e, opts?: { force?: boolean }) => {
    if (state.syncRunning) {
      return { ok: false as const, error: 'A download is in progress; try again when it finishes.' }
    }
    if (state.channelMetaRunning) {
      return { ok: false as const, error: 'Channel name lookup is already running.' }
    }
    if (state.podcastMetaRunning) {
      return { ok: false as const, error: 'Podcast metadata refresh is running.' }
    }
    if (state.playlistMetaRunning) {
      return { ok: false as const, error: 'Playlist lookup is already running.' }
    }
    state.playlistMetaRunning = true
    const forceRefresh = Boolean(opts?.force)

    setImmediate(() => {
      void (async () => {
        const cache = await loadChannelMetaCache()
        try {
          const root = resolve(getDataDir())
          const lines = await readPlaylistsLinesOrEmpty(root)
          const total = lines.length
          const rows: (ChannelInfoRow | undefined)[] = new Array(total)
          let progressCounter = 0

          const toFetch: { index: number; playlistUrl: string }[] = []
          for (let i = 0; i < total; i++) {
            const playlistUrl = lines[i]!
            const hit = getCachedEntry(cache, root, playlistUrl, DISPLAY_META_TTL_MS, forceRefresh)
            if (hit) {
              const base = storedToRow(playlistUrl, hit)
              const row = await enrichChannelRowWithLogo(root, playlistUrl, base, hit.logoSourceUrl)
              rows[i] = row
              broadcastPlaylistRow({ index: i, row })
              progressCounter++
              broadcastPlaylistProgress({ index: progressCounter, total, identifier: playlistUrl.slice(0, 48) })
            } else {
              toFetch.push({ index: i, playlistUrl })
            }
          }

          await runWithConcurrency(toFetch, CHANNEL_RESOLVE_CONCURRENCY, async ({ index, playlistUrl }) => {
            const { row, logoSourceUrl } = await resolvePlaylistRow(root, playlistUrl)
            rows[index] = row
            upsertChannelMeta(cache, root, playlistUrl, row, logoSourceUrl)
            broadcastPlaylistRow({ index, row })
            progressCounter++
            broadcastPlaylistProgress({
              index: progressCounter,
              total,
              identifier: playlistUrl.slice(0, 48)
            })
          })

          await saveChannelMetaCache(cache)
          const finalRows = lines.map((playlistUrl, i) =>
            rows[i] ?? {
              identifier: playlistUrl,
              videosUrl: playlistUrl,
              displayName: null,
              channelPageUrl: null,
              error: 'internal: row missing',
              logoUrl: null
            }
          )
          console.info(LOG, 'playlists:resolveInfo done', {
            total,
            network: toFetch.length,
            cacheHits: total - toFetch.length
          })
          broadcastPlaylistResolveDone({ ok: true, rows: finalRows })
        } catch (e) {
          console.error(LOG, 'playlists:resolveInfo', e)
          try {
            await saveChannelMetaCache(cache)
          } catch (saveErr) {
            console.warn(LOG, 'playlist cache save after error', saveErr)
          }
          broadcastPlaylistResolveDone({ ok: false, error: String(e) })
        } finally {
          state.playlistMetaRunning = false
        }
      })()
    })

    return { ok: true as const, started: true as const }
  })
}
