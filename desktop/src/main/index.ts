import { app } from 'electron'
import { createWindow } from './create-window'
import { LOG } from './constants'
import { loadConfig } from './config-store'
import { registerFloatingPlayerIpc } from './floating-player-ipc'
import { startMediaServer, stopMediaServer } from './media-server'
import { registerAppIpc } from './register-ipc'

/** Quit when the window is closed (including macOS; no dock "empty app" state). */
app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
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
