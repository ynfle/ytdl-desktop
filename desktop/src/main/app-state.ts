import type { BrowserWindow } from 'electron'

/** Config persisted under userData. */
export type AppConfig = {
  dataDir: string | null
}

/**
 * Mutable process-wide handles and flags for the main process (single window, sync locks, etc.).
 */
export const state = {
  config: { dataDir: null } as AppConfig,
  mainWindow: null as BrowserWindow | null,
  floatingPlayerWindow: null as BrowserWindow | null,
  /** Next `closed` event should not emit `playback:floatingPlayerClosed` (programmatic replace for next track). */
  floatingPlayerSkipNextClosedNotify: false,
  floatingPlayerCloseReason: 'user' as 'user' | 'ended' | 'replace',
  lastFloatingPlayerReportedTime: 0,
  floatingPlayerResumePlaying: false,
  syncRunning: false,
  channelMetaRunning: false,
  /** Bulk podcast metadata resolve (yt-dlp) in progress. */
  podcastMetaRunning: false
}
