import type { ChannelInfoRow, PodcastInfoRow } from '../../shared/ytdl-api'
import { state } from './app-state'

export function broadcastLog(chunk: string): void {
  state.mainWindow?.webContents.send('sync:log', chunk)
}

export function broadcastDone(payload: { ok: boolean; error?: string }): void {
  state.mainWindow?.webContents.send('sync:done', payload)
}

/** New finished files under `videos/` during sync; renderer should rescan the library. */
export function broadcastLibraryStale(payload: { reason: 'watch' }): void {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('sync:libraryStale', payload)
  }
}

export function broadcastChannelProgress(payload: {
  index: number
  total: number
  identifier: string
}): void {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('channels:resolveProgress', payload)
  }
}

export function broadcastChannelRow(payload: { index: number; row: ChannelInfoRow }): void {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('channels:resolveRow', payload)
  }
}

export function broadcastChannelResolveDone(payload: {
  ok: boolean
  rows?: ChannelInfoRow[]
  error?: string
}): void {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('channels:resolveDone', payload)
  }
}

export function broadcastPodcastProgress(payload: {
  index: number
  total: number
  feedUrl: string
}): void {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('podcasts:resolveProgress', payload)
  }
}

export function broadcastPodcastRow(payload: { index: number; row: PodcastInfoRow }): void {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('podcasts:resolveRow', payload)
  }
}

export function broadcastPodcastResolveDone(payload: {
  ok: boolean
  rows?: PodcastInfoRow[]
  error?: string
}): void {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('podcasts:resolveDone', payload)
  }
}
