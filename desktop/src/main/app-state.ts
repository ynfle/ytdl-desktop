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
  floatingPlayerCloseReason: 'user' as 'user' | 'ended',
  lastFloatingPlayerReportedTime: 0,
  floatingPlayerResumePlaying: false,
  syncRunning: false,
  channelMetaRunning: false
}
