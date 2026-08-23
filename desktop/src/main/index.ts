import { app } from 'electron'
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
  registerFloatingPlayerIpc()
})

void app.whenReady().then(async () => {
  await loadConfig()
  try {
    await startMediaServer()
  } catch (e) {
    console.error(LOG, 'failed to start loopback media server — video disabled', e)
  }

  registerAppIpc()
  createWindow()
})
