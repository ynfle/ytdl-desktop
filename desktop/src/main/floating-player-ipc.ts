import { existsSync } from 'fs'
import {
  BrowserWindow,
  ipcMain,
  screen,
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

const FLOATING_DEFAULT_WIDTH = 560
const FLOATING_DEFAULT_HEIGHT = 428
const FLOATING_MIN_WIDTH = 200
const FLOATING_MIN_HEIGHT = 150
const FLOATING_BOUNDS_DEBOUNCE_MS = 120
/** Inset from screen edges for first PiP each session — bottom-right-ish, not flush to the pixel. */
const FLOATING_CORNER_MARGIN = 24

let floatingBoundsDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * First PiP open in a session (no remembered position): toward the bottom-right of the display
 * that holds the main window (else primary), inset from `workArea` so Dock / menu bar stay clear.
 */
function getFloatingPlayerDefaultBottomRightishOrigin(winWidth: number, winHeight: number): {
  x: number
  y: number
} {
  let display = screen.getPrimaryDisplay()
  const main = state.mainWindow
  if (main && !main.isDestroyed()) {
    try {
      display = screen.getDisplayMatching(main.getBounds())
    } catch {
      /* keep primary */
    }
  }
  const wa = display.workArea
  const m = FLOATING_CORNER_MARGIN
  let x = wa.x + wa.width - winWidth - m
  let y = wa.y + wa.height - winHeight - m
  if (x < wa.x + m) {
    x = wa.x + m
  }
  if (y < wa.y + m) {
    y = wa.y + m
  }
  return { x: Math.round(x), y: Math.round(y) }
}

/** Save PiP window bounds into process memory only (cleared when the app exits). */
function persistFloatingPlayerBoundsFromWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  try {
    const b = win.getBounds()
    if (b.width >= FLOATING_MIN_WIDTH && b.height >= FLOATING_MIN_HEIGHT) {
      state.floatingPlayerBoundsSession = {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height
      }
      console.debug(LOG, 'floating player session bounds', state.floatingPlayerBoundsSession)
    }
  } catch (e) {
    console.warn(LOG, 'persistFloatingPlayerBoundsFromWindow', e)
  }
}

function scheduleFloatingPlayerBoundsSave(win: BrowserWindow): void {
  if (floatingBoundsDebounceTimer) clearTimeout(floatingBoundsDebounceTimer)
  floatingBoundsDebounceTimer = setTimeout(() => {
    floatingBoundsDebounceTimer = null
    persistFloatingPlayerBoundsFromWindow(win)
  }, FLOATING_BOUNDS_DEBOUNCE_MS)
}

/** Apply last in-session bounds when creating a new floating window (cold open / replace). */
function getFloatingPlayerWindowCreateOptions(): {
  width: number
  height: number
  x: number
  y: number
} {
  const b = state.floatingPlayerBoundsSession
  const width =
    b && Number.isFinite(b.width) && b.width >= FLOATING_MIN_WIDTH
      ? Math.round(b.width)
      : FLOATING_DEFAULT_WIDTH
  const height =
    b && Number.isFinite(b.height) && b.height >= FLOATING_MIN_HEIGHT
      ? Math.round(b.height)
      : FLOATING_DEFAULT_HEIGHT
  if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
    return { width, height, x: Math.round(b.x), y: Math.round(b.y) }
  }
  const corner = getFloatingPlayerDefaultBottomRightishOrigin(width, height)
  return { width, height, x: corner.x, y: corner.y }
}

function bindFloatingPlayerBoundsTracking(win: BrowserWindow): void {
  const onMoveResize = (): void => {
    scheduleFloatingPlayerBoundsSave(win)
  }
  win.on('move', onMoveResize)
  win.on('resize', onMoveResize)
  win.once('close', () => {
    if (floatingBoundsDebounceTimer) {
      clearTimeout(floatingBoundsDebounceTimer)
      floatingBoundsDebounceTimer = null
    }
    persistFloatingPlayerBoundsFromWindow(win)
  })
}

/** Stable refs so we can `ipcMain.off` without `removeAllListeners` (safer on Electron 39 ipcMain). */
function onFloatingClosing(_e: IpcMainEvent, t: unknown): void {
  const n = typeof t === 'number' ? t : Number(t)
  state.lastFloatingPlayerReportedTime = Number.isFinite(n) ? n : 0
  console.info(LOG, 'floating-player:closing', { t: state.lastFloatingPlayerReportedTime })
}

function onFloatingEnded(): void {
  console.info(LOG, 'floating-player:ended (notify main; keep window for hot-swap)')
  const wc = state.mainWindow?.webContents
  if (wc && !wc.isDestroyed()) {
    wc.send('playback:floatingPlayerEnded')
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
    const win = state.floatingPlayerWindow
    if (win && !win.isDestroyed() && opts.reuseExisting) {
      state.floatingPlayerResumePlaying = Boolean(opts.playing)
      const ct = opts.currentTime
      state.lastFloatingPlayerReportedTime =
        typeof ct === 'number' && Number.isFinite(ct) ? ct : 0
      const payload: FloatingPlayerOpenPayload = {
        url: opts.url,
        currentTime: opts.currentTime,
        volume: opts.volume,
        playing: opts.playing,
        artworkUrl: opts.artworkUrl
      }
      win.webContents.send('floating-player:init', payload)
      win.show()
      console.info(LOG, 'openFloatingPlayer: hot-swap (reuse existing window)', {
        urlSample: opts.url.slice(0, 80)
      })
      return { ok: true as const }
    }
    if (win && !win.isDestroyed()) {
      state.floatingPlayerCloseReason = 'replace'
      state.floatingPlayerSkipNextClosedNotify = true
      persistFloatingPlayerBoundsFromWindow(state.floatingPlayerWindow)
      state.floatingPlayerWindow.close()
      state.floatingPlayerWindow = null
    }
    state.floatingPlayerResumePlaying = Boolean(opts.playing)
    state.lastFloatingPlayerReportedTime =
      typeof opts.currentTime === 'number' && Number.isFinite(opts.currentTime) ? opts.currentTime : 0
    state.floatingPlayerCloseReason = 'user'

    const devBase = process.env['ELECTRON_RENDERER_URL']
    const floatingHtmlPath = join(__dirname, '../renderer/floating-player.html')
    const geom = getFloatingPlayerWindowCreateOptions()
    state.floatingPlayerWindow = new BrowserWindow({
      ...geom,
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
    bindFloatingPlayerBoundsTracking(state.floatingPlayerWindow)
    console.info(LOG, 'floating player window geometry', geom)

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

    // Dev must use the Vite origin first: a leftover `out/renderer/floating-player.html` from an old build
    // would otherwise win via loadFile and hide in-editor HTML changes (e.g. PiP timeline).
    if (devBase) {
      const u = `${devBase.replace(/\/$/, '')}/floating-player.html`
      console.info(LOG, 'floating player loadURL (dev)', u)
      await state.floatingPlayerWindow.loadURL(u)
    } else if (existsSync(floatingHtmlPath)) {
      await state.floatingPlayerWindow.loadFile(floatingHtmlPath)
      console.info(LOG, 'floating player loadFile', floatingHtmlPath)
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
    persistFloatingPlayerBoundsFromWindow(state.floatingPlayerWindow)
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
