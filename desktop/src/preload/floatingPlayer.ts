import { contextBridge, ipcRenderer } from 'electron'
import type {
  FloatingPlayerControlPayload,
  FloatingPlayerOpenPayload,
  FloatingPlayerSyncPayload
} from '../../shared/ytdl-api'

/**
 * Minimal bridge for the floating-player.html window only (separate preload bundle).
 */
contextBridge.exposeInMainWorld('floatingPlayer', {
  /** First open and each hot-swap re-send the same `floating-player:init` channel. */
  onInit: (cb: (p: FloatingPlayerOpenPayload) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, p: FloatingPlayerOpenPayload): void => {
      cb(p)
    }
    ipcRenderer.on('floating-player:init', listener)
    return () => ipcRenderer.removeListener('floating-player:init', listener)
  },
  /** Main window transport bar → floating `<video>` (seek / play / pause). */
  onControl: (cb: (p: FloatingPlayerControlPayload) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, p: FloatingPlayerControlPayload): void => cb(p)
    ipcRenderer.on('floating-player:control', listener)
    return () => ipcRenderer.removeListener('floating-player:control', listener)
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
