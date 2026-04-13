import {
  registerConfigIpc,
  registerPlaybackIpc,
  registerShellIpc
} from './register-config-playback-shell-ipc'
import { registerChannelsIpc } from './register-channels-ipc'
import { registerPlaylistsIpc } from './register-playlists-ipc'
import {
  registerLibraryDeleteMediaIpc,
  registerLibraryMediaUrlIpc,
  registerLibraryScanIpc
} from './register-library-ipc'
import { registerPodcastsIpc } from './register-podcasts-ipc'
import { registerSyncChannelsYtrecIpc, registerSyncPodcastsIpc } from './register-sync-ipc'

/**
 * Register every ipcMain.handle before loading the renderer so early invoke() (e.g. hydrate)
 * never hits "No handler registered" on a fast Vite dev load.
 *
 * Order matches historical registration: library scan, channels, playlists, shell, media URLs,
 * YouTube sync, podcasts, then podcast sync last.
 */
export function registerAppIpc(): void {
  registerConfigIpc()
  registerPlaybackIpc()
  registerLibraryScanIpc()
  registerChannelsIpc()
  registerPlaylistsIpc()
  registerShellIpc()
  registerLibraryMediaUrlIpc()
  registerLibraryDeleteMediaIpc()
  registerSyncChannelsYtrecIpc()
  registerPodcastsIpc()
  registerSyncPodcastsIpc()
}
