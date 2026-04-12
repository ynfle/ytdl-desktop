import { ipcMain } from 'electron'
import { state } from './app-state'
import { broadcastDone } from './broadcast'
import { getDataDir } from './config-store'
import { LOG } from './constants'
import { syncChannelsJob, syncPodcastsJob, syncYtrecJob } from './sync-jobs'

/** YouTube channel + ytrec downloads — registered after `library:mediaUrl` in bootstrap. */
export function registerSyncChannelsYtrecIpc(): void {
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
}

/** Podcast RSS sync — registered last so it stays after all `podcasts:*` handlers. */
export function registerSyncPodcastsIpc(): void {
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
