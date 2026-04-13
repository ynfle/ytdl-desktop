import { ipcMain } from 'electron'
import { extname, join, normalize } from 'path'
import { promises as fs } from 'fs'
import { getDataDir, isPathInsideRoot } from './config-store'
import { LIBRARY_MEDIA_EXT, LOG } from './constants'
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

/** Permanent delete of one scanned library media file (same path rules as `library:mediaUrl`). */
export function registerLibraryDeleteMediaIpc(): void {
  ipcMain.handle('library:deleteMedia', async (_e, relPath: unknown) => {
    try {
      if (typeof relPath !== 'string' || relPath.length === 0) {
        console.warn(LOG, 'library:deleteMedia invalid relPath')
        return { ok: false as const, error: 'invalid relPath' }
      }
      const root = getDataDir()
      const full = normalize(join(root, relPath))
      if (!isPathInsideRoot(root, full)) {
        console.warn(LOG, 'library:deleteMedia path outside data root', relPath)
        return { ok: false as const, error: 'path not allowed' }
      }
      const ext = extname(full).toLowerCase()
      if (!LIBRARY_MEDIA_EXT.has(ext)) {
        console.warn(LOG, 'library:deleteMedia extension not allowed', ext)
        return { ok: false as const, error: 'not a library media file' }
      }
      let st
      try {
        st = await fs.lstat(full)
      } catch (e) {
        console.warn(LOG, 'library:deleteMedia stat failed', full, e)
        return { ok: false as const, error: String(e) }
      }
      if (!st.isFile()) {
        console.warn(LOG, 'library:deleteMedia not a file', full)
        return { ok: false as const, error: 'not a file' }
      }
      let realFull: string
      try {
        realFull = await fs.realpath(full)
      } catch (e) {
        console.warn(LOG, 'library:deleteMedia realpath failed', full, e)
        return { ok: false as const, error: String(e) }
      }
      if (!isPathInsideRoot(root, realFull)) {
        console.warn(LOG, 'library:deleteMedia symlink escapes data root', full)
        return { ok: false as const, error: 'path not allowed' }
      }
      await fs.unlink(realFull)
      console.info(LOG, 'library:deleteMedia ok', relPath)
      return { ok: true as const }
    } catch (e) {
      console.error(LOG, 'library:deleteMedia', e)
      return { ok: false as const, error: String(e) }
    }
  })
}
