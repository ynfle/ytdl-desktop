import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { LOG } from './constants'
import { state } from './app-state'
import { bindFloatingPlayerInvokeToWebContents } from './floating-player-ipc'

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
