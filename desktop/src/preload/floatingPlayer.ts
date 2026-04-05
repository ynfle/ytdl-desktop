import { contextBridge, ipcRenderer } from 'electron'
import type { FloatingPlayerOpenPayload, FloatingPlayerSyncPayload } from '../../shared/ytdl-api'

/**
 * Minimal bridge for the floating-player.html window only (separate preload bundle).
 */
contextBridge.exposeInMainWorld('floatingPlayer', {
  onInit: (cb: (p: FloatingPlayerOpenPayload) => void): void => {
    ipcRenderer.once('floating-player:init', (_e, p: FloatingPlayerOpenPayload) => {
      cb(p)
    })
  },
  /** Throttled playback progress → main window transport + disk resume. */
  syncProgress: (p: FloatingPlayerSyncPayload): void => {
    ipcRenderer.send('floating-player:sync', p)
  },
  closing: (currentTime: number): void => {
    ipcRenderer.send('floating-player:closing', currentTime)
  },
  ended: (): void => {
    ipcRenderer.send('floating-player:ended')
  },
  error: (message: string): void => {
    ipcRenderer.send('floating-player:error', { message })
  }
})
