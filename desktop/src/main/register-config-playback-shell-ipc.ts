import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { resolve } from 'path'
import { promises as fs } from 'fs'
import type { PlaybackSpotPatch } from '../../shared/ytdl-api'
import { state } from './app-state'
import { getDataDir, saveConfig } from './config-store'
import { LOG } from './constants'
import { loadPlaybackSpotForRoot, patchPlaybackSpot } from './playback-spot-cache'

/** Data dir get/set and folder picker. */
export function registerConfigIpc(): void {
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
}

export function registerPlaybackIpc(): void {
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
}

export function registerShellIpc(): void {
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
}
