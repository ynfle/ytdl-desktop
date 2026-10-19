import { app } from 'electron'
import { applyOsAppIdentity } from './app-icon'
import { createWindow } from './create-window'
import { LOG } from './constants'
import { loadConfig } from './config-store'
import { state } from './app-state'
import {
  closeFloatingPlayerBecauseMainWindowClosed,
  registerFloatingPlayerIpc
} from './floating-player-ipc'
import { startMediaServer, stopMediaServer } from './media-server'
import { registerAppIpc } from './register-ipc'

/**
 * Ensure only a single instance of YTDL Desktop runs at a time.
 * Re-launching via a Desktop / Start Menu shortcut focuses the existing window.
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  console.warn(LOG, 'second instance detected; delegating focus to primary instance and quitting')
  app.quit()
} else {
  app.on('second-instance', () => {
    console.info(LOG, 'second-instance event received; restoring and focusing main window')
    const main = state.mainWindow
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore()
      main.show()
      main.focus()
    }
  })

  /** Quit when the window is closed (including macOS; no dock "empty app" state). */
  app.on('window-all-closed', () => {
    console.info(LOG, 'window-all-closed: quitting')
    app.quit()
  })

  app.on('before-quit', () => {
    console.info(LOG, 'before-quit: destroy floating PiP and stop media server')
    state.isShuttingDown = true
    closeFloatingPlayerBecauseMainWindowClosed()
    stopMediaServer()
  })

  /** Sync `whenReady` callback runs before the async bootstrap chain — guarantees invoke handlers exist before any `await`. */
  app.whenReady().then(() => {
    applyOsAppIdentity()
    registerFloatingPlayerIpc()
  })

  void app.whenReady().then(async () => {
    console.info(LOG, 'bootstrap starting', {
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      version: app.getVersion()
    })
    await loadConfig()
    try {
      await startMediaServer()
    } catch (e) {
      console.error(LOG, 'failed to start loopback media server — video disabled', e)
    }

    registerAppIpc()
    createWindow()
  })
}
