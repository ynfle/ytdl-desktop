import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { LOG } from './constants'
import { state } from './app-state'
import {
  bindFloatingPlayerInvokeToWebContents,
  closeFloatingPlayerBecauseMainWindowClosed
} from './floating-player-ipc'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export function createWindow(): void {
  state.mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Allow file:// and dev origins to load loopback video + channel avatars without Chromium blocking.
      webSecurity: false
    }
  })

  state.mainWindow.on('ready-to-show', () => {
    state.mainWindow?.show()
  })

  // Destroy PiP during `close` (window still alive). Doing this from `closed` is too late on
  // Windows: sibling `close()` can no-op, and PiP `beforeunload` can cancel `app.quit()`.
  state.mainWindow.on('close', () => {
    console.info(LOG, 'main window close: destroy floating PiP')
    state.isShuttingDown = true
    closeFloatingPlayerBecauseMainWindowClosed()
  })

  state.mainWindow.on('closed', () => {
    console.info(LOG, 'main window closed: quit so the process cannot outlive the UI')
    state.mainWindow = null
    app.quit()
  })

  state.mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const wc = state.mainWindow.webContents

  // Frame-scoped invoke is checked before ipcMain; re-bind after each load so Vite HMR / navigations keep handlers.
  bindFloatingPlayerInvokeToWebContents(wc)
  wc.on('did-finish-load', () => {
    console.info(LOG, 'main window did-finish-load: rebind floating-player invoke')
    bindFloatingPlayerInvokeToWebContents(wc)
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void state.mainWindow.loadURL(devServerUrl)
  } else {
    void state.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
