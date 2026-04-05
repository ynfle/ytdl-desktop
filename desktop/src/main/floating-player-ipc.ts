import { existsSync } from 'fs'
import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import type { FloatingPlayerOpenPayload, FloatingPlayerSyncPayload } from '../../shared/ytdl-api'
import { state } from './app-state'
import { LOG } from './constants'
import { getMediaAuth, isAllowedFloatingMediaUrl } from './media-server'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Preload bundle for the floating player child window (must exist beside main in out/preload). */
export const FLOATING_PLAYER_PRELOAD = join(__dirname, '../preload/floatingPlayer.js')

/** Stable refs so we can `ipcMain.off` without `removeAllListeners` (safer on Electron 39 ipcMain). */
function onFloatingClosing(_e: IpcMainEvent, t: unknown): void {
  const n = typeof t === 'number' ? t : Number(t)
  state.lastFloatingPlayerReportedTime = Number.isFinite(n) ? n : 0
  console.info(LOG, 'floating-player:closing', { t: state.lastFloatingPlayerReportedTime })
}

function onFloatingEnded(): void {
  console.info(LOG, 'floating-player:ended')
  state.floatingPlayerCloseReason = 'ended'
  if (state.floatingPlayerWindow && !state.floatingPlayerWindow.isDestroyed()) {
    state.floatingPlayerWindow.close()
  }
}

function onFloatingError(_e: IpcMainEvent, payload: { message?: string }): void {
  const message = payload?.message ?? 'unknown'
  console.error(LOG, 'floating-player:error', message)
  state.mainWindow?.webContents?.send('playback:floatingPlayerError', { message })
}

/** Keep last known time + play state so `closed` is accurate even if `closing` IPC is missed. */
function onFloatingSync(_e: IpcMainEvent, raw: unknown): void {
  const p = raw as Partial<FloatingPlayerSyncPayload>
  const t = typeof p.currentTime === 'number' && Number.isFinite(p.currentTime) ? p.currentTime : 0
  const d = typeof p.duration === 'number' && Number.isFinite(p.duration) ? p.duration : 0
  const playing = Boolean(p.playing)
  if (t >= 0) state.lastFloatingPlayerReportedTime = t
  state.floatingPlayerResumePlaying = playing
  const wc = state.mainWindow?.webContents
  if (!wc || wc.isDestroyed()) return
  const payload: FloatingPlayerSyncPayload = {
    currentTime: Math.max(0, t),
    duration: Math.max(0, d),
    playing
  }
  wc.send('playback:floatingPlayerSync', payload)
  console.debug(LOG, 'floating-player:sync', {
    t: payload.currentTime,
    d: payload.duration,
    playing: payload.playing
  })
}

async function handleOpenFloatingPlayer(
  _event: IpcMainInvokeEvent,
  opts: FloatingPlayerOpenPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!state.mainWindow) {
      return { ok: false as const, error: 'main window not ready' }
    }
    if (!existsSync(FLOATING_PLAYER_PRELOAD)) {
      return {
        ok: false as const,
        error: `missing preload (run build): ${FLOATING_PLAYER_PRELOAD}`
      }
    }
    if (!opts?.url || typeof opts.url !== 'string') {
      return { ok: false as const, error: 'missing url' }
    }
    if (!isAllowedFloatingMediaUrl(opts.url)) {
      const auth = getMediaAuth()
      console.warn(LOG, 'openFloatingPlayer rejected url', {
        sample: opts.url.slice(0, 120),
        mediaPort: auth?.port,
        parsed: (() => {
          try {
            const u = new URL(opts.url)
            return { host: u.hostname, port: u.port || '(default)' }
          } catch {
            return null
          }
        })()
      })
      return { ok: false as const, error: 'url not allowed (expected loopback media server URL)' }
    }
    if (state.floatingPlayerWindow && !state.floatingPlayerWindow.isDestroyed()) {
      state.floatingPlayerWindow.close()
      state.floatingPlayerWindow = null
    }
    state.floatingPlayerResumePlaying = Boolean(opts.playing)
    state.lastFloatingPlayerReportedTime =
      typeof opts.currentTime === 'number' && Number.isFinite(opts.currentTime) ? opts.currentTime : 0
    state.floatingPlayerCloseReason = 'user'

    const devBase = process.env['ELECTRON_RENDERER_URL']
    const floatingHtmlPath = join(__dirname, '../renderer/floating-player.html')
    state.floatingPlayerWindow = new BrowserWindow({
      width: 560,
      height: 400,
      title: 'Picture in picture',
      alwaysOnTop: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: FLOATING_PLAYER_PRELOAD,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false
      }
    })

    state.floatingPlayerWindow.on('closed', () => {
      console.info(LOG, 'floating player closed', { reason: state.floatingPlayerCloseReason })
      state.floatingPlayerWindow = null
      const wc = state.mainWindow?.webContents
      if (!wc || wc.isDestroyed()) return
      if (state.floatingPlayerCloseReason === 'ended') {
        wc.send('playback:floatingPlayerEnded')
      } else {
        wc.send('playback:floatingPlayerClosed', {
          currentTime: state.lastFloatingPlayerReportedTime,
          resumePlaying: state.floatingPlayerResumePlaying
        })
      }
      state.floatingPlayerCloseReason = 'user'
    })

    if (existsSync(floatingHtmlPath)) {
      await state.floatingPlayerWindow.loadFile(floatingHtmlPath)
      console.info(LOG, 'floating player loadFile', floatingHtmlPath)
    } else if (devBase) {
      const u = `${devBase.replace(/\/$/, '')}/floating-player.html`
      console.info(LOG, 'floating player loadURL', u)
      await state.floatingPlayerWindow.loadURL(u)
    } else {
      throw new Error(`floating-player.html not found at ${floatingHtmlPath}`)
    }
    state.floatingPlayerWindow.webContents.send('floating-player:init', opts)
    state.floatingPlayerWindow.show()
    console.info(LOG, 'floating player opened')
    return { ok: true as const }
  } catch (e) {
    console.error(LOG, 'playback:openFloatingPlayer', e)
    state.floatingPlayerWindow?.destroy()
    state.floatingPlayerWindow = null
    return { ok: false as const, error: String(e) }
  }
}

async function handleCloseFloatingPlayer(): Promise<void> {
  state.floatingPlayerCloseReason = 'user'
  if (state.floatingPlayerWindow && !state.floatingPlayerWindow.isDestroyed()) {
    try {
      const t = await state.floatingPlayerWindow.webContents.executeJavaScript(
        `(() => { const v = document.querySelector('video'); return v && typeof v.currentTime === 'number' ? v.currentTime : 0 })()`,
        true
      )
      if (typeof t === 'number' && Number.isFinite(t)) state.lastFloatingPlayerReportedTime = t
    } catch {
      /* ignore */
    }
    state.floatingPlayerWindow.close()
  }
}

/**
 * True only after `ipcMain.handle` for floating player succeeded. Setting this before `handle()` could strand
 * the app with no handler if `handle` throws (then the guard blocks retries).
 */
let floatingPlayerIpcInstalled = false

/**
 * Event channels from the floating child window (always on `ipcMain`).
 * Invoke handlers: registered on both `ipcMain` (early) and `webContents.mainFrame.ipc` (before loadURL) because
 * Electron resolves renderer `invoke` in order `mainFrame.ipc` → `webContents.ipc` → `ipcMain`; some setups were
 * hitting “No handler registered” with `ipcMain` alone (Electron 39).
 */
export function registerFloatingPlayerIpc(): void {
  if (floatingPlayerIpcInstalled) {
    console.info(LOG, 'registerFloatingPlayerIpc: already installed, skipping')
    return
  }

  if (!existsSync(FLOATING_PLAYER_PRELOAD)) {
    console.error(LOG, 'floating player preload not found (run build / dev once):', FLOATING_PLAYER_PRELOAD)
  }

  ipcMain.on('floating-player:closing', onFloatingClosing)
  ipcMain.on('floating-player:ended', onFloatingEnded)
  ipcMain.on('floating-player:error', onFloatingError)
  ipcMain.on('floating-player:sync', onFloatingSync)

  try {
    ipcMain.handle('playback:openFloatingPlayer', handleOpenFloatingPlayer)
    ipcMain.handle('playback:closeFloatingPlayer', handleCloseFloatingPlayer)
    floatingPlayerIpcInstalled = true
    console.info(LOG, 'registered playback:openFloatingPlayer / closeFloatingPlayer IPC on ipcMain')
  } catch (e) {
    console.error(LOG, 'ipcMain.handle (floating player) failed', e)
    throw e
  }
}

type IpcBindTarget = Pick<typeof ipcMain, 'removeHandler' | 'handle'>

function bindFloatingInvokeOnTarget(target: IpcBindTarget, label: string): void {
  try {
    target.removeHandler('playback:openFloatingPlayer')
    target.removeHandler('playback:closeFloatingPlayer')
    target.handle('playback:openFloatingPlayer', handleOpenFloatingPlayer)
    target.handle('playback:closeFloatingPlayer', handleCloseFloatingPlayer)
    console.info(LOG, 'floating-player invoke bound on', label)
  } catch (e) {
    console.error(LOG, 'floating-player bind failed on', label, e)
  }
}

/**
 * Electron resolves renderer `invoke` as: `mainFrame.ipc` → `webContents.ipc` → `ipcMain`.
 * After Vite full-reload / navigations the frame can be replaced and frame-level handlers disappear; `did-finish-load` must re-bind.
 */
export function bindFloatingPlayerInvokeToWebContents(webContents: WebContents): void {
  bindFloatingInvokeOnTarget(webContents.mainFrame.ipc, 'mainFrame.ipc')
  bindFloatingInvokeOnTarget(webContents.ipc, 'webContents.ipc')
}
