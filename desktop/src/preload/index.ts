import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChannelInfoRow,
  FloatingPlayerClosedPayload,
  FloatingPlayerControlPayload,
  FloatingPlayerOpenPayload,
  FloatingPlayerSyncPayload,
  PodcastInfoRow,
  YtdlApi
} from '../../shared/ytdl-api'

/**
 * Typed bridge: renderer calls only these IPC methods (no raw Node in UI).
 */
const api: YtdlApi = {
  getDataDir: () => ipcRenderer.invoke('config:getDataDir'),
  setDataDir: (dir: string) => ipcRenderer.invoke('config:setDataDir', dir),
  pickDataDir: () => ipcRenderer.invoke('config:pickDataDir'),
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  mediaUrl: (relPath: string) => ipcRenderer.invoke('library:mediaUrl', relPath),
  syncChannels: () => ipcRenderer.invoke('sync:channels'),
  syncYtrec: (count: number) => ipcRenderer.invoke('sync:ytrec', count),
  syncPodcasts: () => ipcRenderer.invoke('sync:podcasts'),
  readChannelIdentifiers: () => ipcRenderer.invoke('channels:readIdentifiers'),
  hydrateChannelRowsFromCache: () => ipcRenderer.invoke('channels:hydrateFromCache'),
  resolveChannelInfo: (opts?: { force?: boolean }) =>
    ipcRenderer.invoke('channels:resolveInfo', opts ?? {}),
  previewChannel: (raw: string) => ipcRenderer.invoke('channels:previewChannel', raw),
  addChannel: (identifier: string) => ipcRenderer.invoke('channels:addChannel', identifier),
  searchApplePodcasts: (term: string) => ipcRenderer.invoke('podcasts:searchApplePodcasts', term),
  previewPodcast: (raw: string, opts?: { artworkUrl?: string | null }) =>
    ipcRenderer.invoke('podcasts:previewPodcast', raw, opts ?? {}),
  addPodcast: (feedUrl: string) => ipcRenderer.invoke('podcasts:addPodcast', feedUrl),
  removePodcast: (feedUrl: string) => ipcRenderer.invoke('podcasts:removePodcast', feedUrl),
  readPodcastFeeds: () => ipcRenderer.invoke('podcasts:readFeeds'),
  hydratePodcastRowsFromCache: () => ipcRenderer.invoke('podcasts:hydrateFromCache'),
  resolvePodcastInfo: (opts?: { force?: boolean }) =>
    ipcRenderer.invoke('podcasts:resolveInfo', opts ?? {}),
  onPodcastResolveProgress: (cb) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { index: number; total: number; feedUrl: string }
    ) => cb(payload)
    ipcRenderer.on('podcasts:resolveProgress', listener)
    return () => ipcRenderer.removeListener('podcasts:resolveProgress', listener)
  },
  onPodcastResolveRow: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { index: number; row: PodcastInfoRow }) =>
      cb(payload)
    ipcRenderer.on('podcasts:resolveRow', listener)
    return () => ipcRenderer.removeListener('podcasts:resolveRow', listener)
  },
  onPodcastResolveDone: (cb) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { ok: boolean; rows?: PodcastInfoRow[]; error?: string }
    ) => cb(payload)
    ipcRenderer.on('podcasts:resolveDone', listener)
    return () => ipcRenderer.removeListener('podcasts:resolveDone', listener)
  },
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  loadPlaybackSpot: () => ipcRenderer.invoke('playback:loadSpot'),
  patchPlaybackSpot: (patch) => ipcRenderer.invoke('playback:patchSpot', patch),
  onSyncLog: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, chunk: string) => cb(chunk)
    ipcRenderer.on('sync:log', listener)
    return () => ipcRenderer.removeListener('sync:log', listener)
  },
  onSyncDone: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { ok: boolean; error?: string }) =>
      cb(payload)
    ipcRenderer.on('sync:done', listener)
    return () => ipcRenderer.removeListener('sync:done', listener)
  },
  onSyncLibraryStale: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { reason: 'watch' }) => cb(payload)
    ipcRenderer.on('sync:libraryStale', listener)
    return () => ipcRenderer.removeListener('sync:libraryStale', listener)
  },
  onChannelResolveProgress: (cb) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { index: number; total: number; identifier: string }
    ) => cb(payload)
    ipcRenderer.on('channels:resolveProgress', listener)
    return () => ipcRenderer.removeListener('channels:resolveProgress', listener)
  },
  onChannelResolveRow: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { index: number; row: ChannelInfoRow }) =>
      cb(payload)
    ipcRenderer.on('channels:resolveRow', listener)
    return () => ipcRenderer.removeListener('channels:resolveRow', listener)
  },
  onChannelResolveDone: (cb) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { ok: boolean; rows?: ChannelInfoRow[]; error?: string }
    ) => cb(payload)
    ipcRenderer.on('channels:resolveDone', listener)
    return () => ipcRenderer.removeListener('channels:resolveDone', listener)
  },

  openFloatingPlayer: (payload: FloatingPlayerOpenPayload) =>
    ipcRenderer.invoke('playback:openFloatingPlayer', payload),
  closeFloatingPlayer: () => ipcRenderer.invoke('playback:closeFloatingPlayer'),
  controlFloatingPlayer: (payload: FloatingPlayerControlPayload) =>
    ipcRenderer.invoke('playback:controlFloatingPlayer', payload),
  onFloatingPlayerClosed: (cb: (p: FloatingPlayerClosedPayload) => void) => {
    const listener = (_: Electron.IpcRendererEvent, p: FloatingPlayerClosedPayload) => cb(p)
    ipcRenderer.on('playback:floatingPlayerClosed', listener)
    return () => ipcRenderer.removeListener('playback:floatingPlayerClosed', listener)
  },
  onFloatingPlayerEnded: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('playback:floatingPlayerEnded', listener)
    return () => ipcRenderer.removeListener('playback:floatingPlayerEnded', listener)
  },
  onFloatingPlayerError: (cb: (p: { message: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, p: { message: string }) => cb(p)
    ipcRenderer.on('playback:floatingPlayerError', listener)
    return () => ipcRenderer.removeListener('playback:floatingPlayerError', listener)
  },
  onFloatingPlayerSync: (cb: (p: FloatingPlayerSyncPayload) => void) => {
    const listener = (_: Electron.IpcRendererEvent, p: FloatingPlayerSyncPayload) => cb(p)
    ipcRenderer.on('playback:floatingPlayerSync', listener)
    return () => ipcRenderer.removeListener('playback:floatingPlayerSync', listener)
  }
}

contextBridge.exposeInMainWorld('ytdl', api)
