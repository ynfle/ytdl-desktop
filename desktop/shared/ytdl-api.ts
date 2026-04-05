/** Video entry returned from main-process library scan (path relative to data dir). */
export type LibraryVideo = {
  relPath: string
  mtimeMs: number
  size: number
}

/** One row from channels.txt with optional title resolved via yt-dlp (no download). */
export type ChannelInfoRow = {
  /** Line from channels.txt (e.g. @handle, channel/UC…, c/name). */
  identifier: string
  /** Same URL used for downloads: …/IDENT/videos */
  videosUrl: string
  /** YouTube channel / uploader display name when yt-dlp could read it. */
  displayName: string | null
  /** Link to channel page when yt-dlp provides it. */
  channelPageUrl: string | null
  error: string | null
  /**
   * Loopback URL to a **downloaded** avatar on disk (main process fetches yt3 → userData, then serves here).
   * Null until a file exists; the renderer never loads CDN URLs directly.
   */
  logoUrl: string | null
}

/** Persisted playback resume + session (one bucket per resolved data dir in userData). */
export type PlaybackSpotSession = {
  queue: string[]
  playlist: string[]
  cursor: number
  currentRel: string | null
  playing: boolean
}

export type PlaybackSpotPositionEntry = {
  currentTime: number
  updatedAt: number
}

export type PlaybackSpotSnapshot = {
  positions: Record<string, PlaybackSpotPositionEntry>
  session: PlaybackSpotSession
}

/** Partial merge: `positionUpdates[rel]=null` removes that resume point. */
export type PlaybackSpotPatch = {
  positionUpdates?: Record<string, { currentTime: number } | null>
  session?: PlaybackSpotSession
}

/** Opens the always-on-top floating player (Electron only): same loopback URL as the main `<video>`. */
export type FloatingPlayerOpenPayload = {
  url: string
  currentTime: number
  volume: number
  playing: boolean
}

/** Main window receives this when the user closes the floating player (not when the track ends). */
export type FloatingPlayerClosedPayload = {
  currentTime: number
  resumePlaying: boolean
}

/** Throttled progress from the floating `<video>` so the main transport bar and resume saves stay in sync. */
export type FloatingPlayerSyncPayload = {
  currentTime: number
  duration: number
  playing: boolean
}

/** Preload API exposed as `window.ytdl`. */
export type YtdlApi = {
  getDataDir: () => Promise<string>
  setDataDir: (dir: string) => Promise<{ ok: boolean; error?: string }>
  pickDataDir: () => Promise<string | null>
  scanLibrary: () => Promise<{ ok: boolean; videos?: LibraryVideo[]; error?: string }>
  mediaUrl: (relPath: string) => Promise<{ ok: boolean; url?: string; error?: string }>
  syncChannels: () => Promise<{ ok: boolean; error?: string }>
  syncYtrec: (count: number) => Promise<{ ok: boolean; error?: string }>
  /** Lines from channels.txt (no network). */
  readChannelIdentifiers: () => Promise<{ ok: boolean; identifiers?: string[]; error?: string }>
  /** channels.txt rows merged with disk cache only (no yt-dlp). Use on startup / reload list. */
  hydrateChannelRowsFromCache: () => Promise<{ ok: boolean; rows?: ChannelInfoRow[]; error?: string }>
  /**
   * Starts channel name resolution; returns immediately with `{ started: true }`.
   * Rows stream via `onChannelResolveRow`; finish via `onChannelResolveDone` (do not await full resolve on invoke).
   * `force: true` skips on-disk cache (still writes fresh entries).
   */
  resolveChannelInfo: (opts?: { force?: boolean }) => Promise<{
    ok: boolean
    started?: boolean
    rows?: ChannelInfoRow[]
    error?: string
  }>
  /**
   * Resolve one channel via yt-dlp (name + avatar on loopback). Writes display cache on success.
   * Fails if the row is not fully valid for add or the channel is already in channels.txt.
   */
  previewChannel: (raw: string) => Promise<{
    ok: boolean
    identifier?: string
    row?: ChannelInfoRow
    error?: string
  }>
  /**
   * Append normalized identifier to channels.txt after re-validating metadata (cache or re-resolve).
   */
  addChannel: (identifier: string) => Promise<{ ok: boolean; error?: string; duplicate?: boolean }>
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>
  /** Load resume positions + last session for the current data directory. */
  loadPlaybackSpot: () => Promise<{ ok: boolean; snapshot?: PlaybackSpotSnapshot; error?: string }>
  /** Merge patch into disk cache (main read-modify-write, serialized). */
  patchPlaybackSpot: (patch: PlaybackSpotPatch) => Promise<{ ok: boolean; error?: string }>
  onSyncLog: (cb: (chunk: string) => void) => () => void
  onSyncDone: (cb: (payload: { ok: boolean; error?: string }) => void) => () => void
  onChannelResolveProgress: (
    cb: (p: { index: number; total: number; identifier: string }) => void
  ) => () => void
  /** Fires after each channel row is resolved (so the UI can update without waiting for the full batch). */
  onChannelResolveRow: (cb: (p: { index: number; row: ChannelInfoRow }) => void) => () => void
  /** Fires when the async resolve job finishes (success or error). */
  onChannelResolveDone: (
    cb: (p: { ok: boolean; rows?: ChannelInfoRow[]; error?: string }) => void
  ) => () => void

  /**
   * Always-on-top mini window with seek controls (Electron). URL must be the app loopback media URL.
   * Native OS video PiP cannot show custom buttons; this replaces PiP on Electron.
   */
  openFloatingPlayer: (payload: FloatingPlayerOpenPayload) => Promise<{ ok: boolean; error?: string }>
  closeFloatingPlayer: () => Promise<void>
  onFloatingPlayerClosed: (cb: (p: FloatingPlayerClosedPayload) => void) => () => void
  onFloatingPlayerEnded: (cb: () => void) => () => void
  onFloatingPlayerError: (cb: (p: { message: string }) => void) => () => void
  /** Live position from floating PiP (main `<video>` is paused while it runs). */
  onFloatingPlayerSync: (cb: (p: FloatingPlayerSyncPayload) => void) => () => void
}
