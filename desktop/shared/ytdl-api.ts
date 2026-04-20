/** Video entry returned from main-process library scan (path relative to data dir). */
export type LibraryVideo = {
  relPath: string
  mtimeMs: number
  size: number
  /** yt-dlp sidecar image next to the media file, when present (e.g. same title, .jpg). */
  thumbRelPath: string | null
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

/** One subscribed podcast (line in podcasts.txt) with metadata from cache / yt-dlp. */
export type PodcastInfoRow = {
  /** Canonical feed URL as stored in podcasts.txt. */
  feedUrl: string
  /** Stable folder segment under videos/podcasts/<folderId>/ (hash of feed URL). */
  folderId: string
  displayName: string | null
  /** Apple / publisher page when known (optional). */
  feedPageUrl: string | null
  error: string | null
  /** Loopback URL to downloaded cover art in userData, when present. */
  logoUrl: string | null
}

/** One hit from the iTunes Search API (podcast entity). */
export type ApplePodcastSearchResult = {
  collectionId: number
  title: string
  artistName: string | null
  feedUrl: string
  artworkUrl: string | null
}

/** Persisted playback resume + session (one bucket per resolved data dir in userData). */
export type PlaybackSpotSession = {
  /** Legacy: explicit-queue tail only for older readers; renderer restores from `playlist` + `explicitStartIndex`. */
  queue: string[]
  playlist: string[]
  cursor: number
  currentRel: string | null
  playing: boolean
  /** First index in `playlist` of user-queued items (library “Up next” is `cursor+1..explicitStartIndex-1`). Omitted on old files → treat as `playlist.length`. */
  explicitStartIndex?: number
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
  /** Episode sidecar or podcast show cover (loopback URLs); shown when audio has no video track. */
  artworkUrl?: string | null
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

/** Main window → floating window: drive the PiP `<video>` (main element stays paused). */
export type FloatingPlayerControlPayload =
  | { action: 'seek'; currentTime: number }
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'togglePlay' }

/** Preload API exposed as `window.ytdl`. */
export type YtdlApi = {
  getDataDir: () => Promise<string>
  setDataDir: (dir: string) => Promise<{ ok: boolean; error?: string }>
  pickDataDir: () => Promise<string | null>
  scanLibrary: () => Promise<{ ok: boolean; videos?: LibraryVideo[]; error?: string }>
  mediaUrl: (relPath: string) => Promise<{ ok: boolean; url?: string; error?: string }>
  /** Remove one library media file under the data root (permanent delete). */
  deleteLibraryMedia: (relPath: string) => Promise<{ ok: boolean; error?: string }>
  syncChannels: () => Promise<{ ok: boolean; error?: string }>
  /** playlists.txt only; same archive as channel sync. */
  syncPlaylists: () => Promise<{ ok: boolean; error?: string }>
  syncYtrec: (count: number) => Promise<{ ok: boolean; error?: string }>
  syncPodcasts: () => Promise<{ ok: boolean; error?: string }>
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
  /** Remove one line from channels.txt (exact stored identifier). */
  removeChannel: (identifier: string) => Promise<{ ok: boolean; error?: string; notFound?: boolean }>
  /** Lines from playlists.txt (no network). */
  readPlaylistUrls: () => Promise<{ ok: boolean; urls?: string[]; error?: string }>
  /** playlists.txt rows merged with channel-display cache (same bucket as channels). */
  hydratePlaylistRowsFromCache: () => Promise<{ ok: boolean; rows?: ChannelInfoRow[]; error?: string }>
  /**
   * Starts playlist title/thumbnail resolution; streams on `onPlaylistResolveRow`, done on `onPlaylistResolveDone`.
   */
  resolvePlaylistInfo: (opts?: { force?: boolean }) => Promise<{
    ok: boolean
    started?: boolean
    error?: string
  }>
  previewPlaylist: (raw: string) => Promise<{
    ok: boolean
    playlistUrl?: string
    row?: ChannelInfoRow
    error?: string
  }>
  addPlaylist: (playlistUrl: string) => Promise<{ ok: boolean; error?: string; duplicate?: boolean }>
  /** Remove one line from playlists.txt (exact stored URL). */
  removePlaylist: (playlistUrl: string) => Promise<{ ok: boolean; error?: string; notFound?: boolean }>
  onPlaylistResolveProgress: (
    cb: (p: { index: number; total: number; identifier: string }) => void
  ) => () => void
  onPlaylistResolveRow: (cb: (p: { index: number; row: ChannelInfoRow }) => void) => () => void
  onPlaylistResolveDone: (
    cb: (p: { ok: boolean; rows?: ChannelInfoRow[]; error?: string }) => void
  ) => () => void
  /** iTunes Search API; no yt-dlp. */
  searchApplePodcasts: (term: string) => Promise<{
    ok: boolean
    results?: ApplePodcastSearchResult[]
    error?: string
  }>
  /** Resolve Apple Podcasts link or RSS URL; yt-dlp + optional artwork (e.g. from Apple search hit). */
  previewPodcast: (
    raw: string,
    opts?: { artworkUrl?: string | null }
  ) => Promise<{
    ok: boolean
    feedUrl?: string
    row?: PodcastInfoRow
    error?: string
  }>
  addPodcast: (feedUrl: string) => Promise<{ ok: boolean; error?: string; duplicate?: boolean }>
  removePodcast: (feedUrl: string) => Promise<{ ok: boolean; error?: string; notFound?: boolean }>
  readPodcastFeeds: () => Promise<{ ok: boolean; feeds?: string[]; error?: string }>
  hydratePodcastRowsFromCache: () => Promise<{ ok: boolean; rows?: PodcastInfoRow[]; error?: string }>
  /**
   * Refresh podcast metadata via yt-dlp; returns immediately. Rows stream on `onPodcastResolveRow`,
   * finish on `onPodcastResolveDone`.
   */
  resolvePodcastInfo: (opts?: { force?: boolean }) => Promise<{
    ok: boolean
    started?: boolean
    error?: string
  }>
  onPodcastResolveProgress: (
    cb: (p: { index: number; total: number; feedUrl: string }) => void
  ) => () => void
  onPodcastResolveRow: (cb: (p: { index: number; row: PodcastInfoRow }) => void) => () => void
  onPodcastResolveDone: (
    cb: (p: { ok: boolean; rows?: PodcastInfoRow[]; error?: string }) => void
  ) => () => void
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>
  /** Load resume positions + last session for the current data directory. */
  loadPlaybackSpot: () => Promise<{ ok: boolean; snapshot?: PlaybackSpotSnapshot; error?: string }>
  /** Merge patch into disk cache (main read-modify-write, serialized). */
  patchPlaybackSpot: (patch: PlaybackSpotPatch) => Promise<{ ok: boolean; error?: string }>
  onSyncLog: (cb: (chunk: string) => void) => () => void
  onSyncDone: (cb: (payload: { ok: boolean; error?: string }) => void) => () => void
  /** Fires while sync runs when `videos/` changes (debounced); same rescan path as `sync:done`. */
  onSyncLibraryStale: (cb: (payload: { reason: 'watch' }) => void) => () => void
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
  /** Forward play/pause/seek to the floating PiP `<video>` (no-op if no window). */
  controlFloatingPlayer: (payload: FloatingPlayerControlPayload) => Promise<{ ok: boolean; error?: string }>
  onFloatingPlayerClosed: (cb: (p: FloatingPlayerClosedPayload) => void) => () => void
  onFloatingPlayerEnded: (cb: () => void) => () => void
  onFloatingPlayerError: (cb: (p: { message: string }) => void) => () => void
  /** Live position from floating PiP (main `<video>` is paused while it runs). */
  onFloatingPlayerSync: (cb: (p: FloatingPlayerSyncPayload) => void) => () => void
}
