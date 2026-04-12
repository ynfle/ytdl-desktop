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
import type {
  FloatingPlayerControlPayload,
  FloatingPlayerOpenPayload,
  FloatingPlayerSyncPayload
} from '../../shared/ytdl-api'
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
      state.floatingPlayerCloseReason = 'replace'
      state.floatingPlayerSkipNextClosedNotify = true
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
      const reason = state.floatingPlayerCloseReason
      const skipNotify = state.floatingPlayerSkipNextClosedNotify
      if (skipNotify) state.floatingPlayerSkipNextClosedNotify = false
      console.info(LOG, 'floating player closed', { reason, skipNotify })
      state.floatingPlayerWindow = null
      if (skipNotify) {
        state.floatingPlayerCloseReason = 'user'
        return
      }
      const wc = state.mainWindow?.webContents
      if (!wc || wc.isDestroyed()) {
        state.floatingPlayerCloseReason = 'user'
        return
      }
      if (reason === 'ended') {
        wc.send('playback:floatingPlayerEnded')
      } else if (reason === 'replace') {
        /* Should not happen without skipNotify; no renderer notify */
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

function isFloatingControlPayload(raw: unknown): raw is FloatingPlayerControlPayload {
  if (!raw || typeof raw !== 'object') return false
  const a = (raw as { action?: string }).action
  if (a === 'play' || a === 'pause' || a === 'togglePlay') return true
  if (a === 'seek') {
    const t = (raw as { currentTime?: unknown }).currentTime
    return typeof t === 'number' && Number.isFinite(t)
  }
  return false
}

async function handleControlFloatingPlayer(
  _event: IpcMainInvokeEvent,
  raw: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const win = state.floatingPlayerWindow
  if (!win || win.isDestroyed()) {
    console.info(LOG, 'playback:controlFloatingPlayer: no floating window')
    return { ok: false as const, error: 'no floating player' }
  }
  if (!isFloatingControlPayload(raw)) {
    console.warn(LOG, 'playback:controlFloatingPlayer: invalid payload', raw)
    return { ok: false as const, error: 'invalid payload' }
  }
  try {
    win.webContents.send('floating-player:control', raw)
    console.debug(LOG, 'playback:controlFloatingPlayer → child', raw)
    return { ok: true as const }
  } catch (e) {
    console.error(LOG, 'playback:controlFloatingPlayer', e)
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
    ipcMain.handle('playback:controlFloatingPlayer', handleControlFloatingPlayer)
    floatingPlayerIpcInstalled = true
    console.info(
      LOG,
      'registered playback:openFloatingPlayer / closeFloatingPlayer / controlFloatingPlayer IPC on ipcMain'
    )
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
    target.removeHandler('playback:controlFloatingPlayer')
    target.handle('playback:openFloatingPlayer', handleOpenFloatingPlayer)
    target.handle('playback:closeFloatingPlayer', handleCloseFloatingPlayer)
    target.handle('playback:controlFloatingPlayer', handleControlFloatingPlayer)
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
