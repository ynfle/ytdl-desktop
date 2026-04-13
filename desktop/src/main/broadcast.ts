import type { ChannelInfoRow, PodcastInfoRow } from '../../shared/ytdl-api'
import { state } from './app-state'

type MainSend = (channel: string, ...args: unknown[]) => void

/** Single place for main-window IPC sends; avoids duplicate destroy checks. */
function sendMain(channel: string, ...args: unknown[]): void {
  const w = state.mainWindow
  if (w && !w.isDestroyed()) {
    ;(w.webContents.send as MainSend)(channel, ...args)
  }
}

export function broadcastLog(chunk: string): void {
  sendMain('sync:log', chunk)
}

export function broadcastDone(payload: { ok: boolean; error?: string }): void {
  sendMain('sync:done', payload)
}

/** New finished files under `videos/` during sync; renderer should rescan the library. */
export function broadcastLibraryStale(payload: { reason: 'watch' }): void {
  sendMain('sync:libraryStale', payload)
}

export function broadcastChannelProgress(payload: {
  index: number
  total: number
  identifier: string
}): void {
  sendMain('channels:resolveProgress', payload)
}

export function broadcastChannelRow(payload: { index: number; row: ChannelInfoRow }): void {
  sendMain('channels:resolveRow', payload)
}

export function broadcastChannelResolveDone(payload: {
  ok: boolean
  rows?: ChannelInfoRow[]
  error?: string
}): void {
  sendMain('channels:resolveDone', payload)
}

export function broadcastPodcastProgress(payload: {
  index: number
  total: number
  feedUrl: string
}): void {
  sendMain('podcasts:resolveProgress', payload)
}

export function broadcastPodcastRow(payload: { index: number; row: PodcastInfoRow }): void {
  sendMain('podcasts:resolveRow', payload)
}

export function broadcastPodcastResolveDone(payload: {
  ok: boolean
  rows?: PodcastInfoRow[]
  error?: string
}): void {
  sendMain('podcasts:resolveDone', payload)
}

export function broadcastPlaylistProgress(payload: {
  index: number
  total: number
  identifier: string
}): void {
  sendMain('playlists:resolveProgress', payload)
}

export function broadcastPlaylistRow(payload: { index: number; row: ChannelInfoRow }): void {
  sendMain('playlists:resolveRow', payload)
}

export function broadcastPlaylistResolveDone(payload: {
  ok: boolean
  rows?: ChannelInfoRow[]
  error?: string
}): void {
  sendMain('playlists:resolveDone', payload)
}
