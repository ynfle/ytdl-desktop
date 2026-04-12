import { ipcMain } from 'electron'
import { join, normalize } from 'path'
import { promises as fs } from 'fs'
import { getDataDir, isPathInsideRoot } from './config-store'
import { LOG } from './constants'
import { getMediaAuth } from './media-server'
import { scanLibraryVideos } from './library-scan'

/** `library:scan` — keep registration order: called before channels IPC in bootstrap. */
export function registerLibraryScanIpc(): void {
  ipcMain.handle('library:scan', async () => {
    try {
      const root = getDataDir()
      const videos = await scanLibraryVideos(root)
      return { ok: true as const, videos }
    } catch (e) {
      console.error(LOG, 'library:scan', e)
      return { ok: false as const, error: String(e) }
    }
  })
}

/** `library:mediaUrl` — after shell:openExternal in bootstrap order. */
export function registerLibraryMediaUrlIpc(): void {
  ipcMain.handle('library:mediaUrl', async (_e, relPath: string) => {
    try {
      const auth = getMediaAuth()
      if (!auth) {
        return { ok: false as const, error: 'loopback media server not ready' }
      }
      const root = getDataDir()
      const full = normalize(join(root, relPath))
      if (!isPathInsideRoot(root, full)) {
        return { ok: false as const, error: 'path not allowed' }
      }
      await fs.access(full)
      const token = Buffer.from(relPath, 'utf8').toString('base64url')
      const url = `http://127.0.0.1:${auth.port}/${auth.secret}/${token}`
      return { ok: true as const, url }
    } catch (e) {
      return { ok: false as const, error: String(e) }
    }
  })
}
