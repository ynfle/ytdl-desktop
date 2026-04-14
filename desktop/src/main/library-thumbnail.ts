import { join, normalize, parse, relative, sep } from 'path'
import { promises as fs } from 'fs'
import { isPathInsideRoot } from './config-store'
import { LOG } from './constants'

/** Sidecar extensions yt-dlp may leave next to the media file (jpg after --convert-thumbnails). */
const THUMB_EXT_ORDER = ['.jpg', '.jpeg', '.webp', '.png'] as const

/**
 * If a thumbnail image exists beside the library media file (same stem), return its path relative to dataRoot.
 */
export async function resolveSidecarThumbnailRelPath(
  dataRoot: string,
  mediaAbsPath: string
): Promise<string | null> {
  const { dir, name } = parse(mediaAbsPath)
  for (const ext of THUMB_EXT_ORDER) {
    const thumbFull = join(dir, `${name}${ext}`)
    try {
      const st = await fs.stat(thumbFull)
      if (st.isFile()) {
        const rel = relative(dataRoot, thumbFull).split(sep).join('/')
        console.info(LOG, 'library thumb sidecar ok', rel)
        return rel
      }
    } catch {
      // ENOENT or unreadable — try next extension
    }
  }
  return null
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Remove sidecar thumbnail images next to a library media file (same stem as `resolveSidecarThumbnailRelPath`).
 * Best-effort: logs failures but does not throw (primary media delete already succeeded).
 */
export async function unlinkSidecarThumbnailsBesideMedia(
  dataRoot: string,
  mediaRealPath: string
): Promise<void> {
  const { dir, name } = parse(mediaRealPath)
  for (const ext of THUMB_EXT_ORDER) {
    const thumbFull = normalize(join(dir, `${name}${ext}`))
    if (!isPathInsideRoot(dataRoot, thumbFull)) {
      console.warn(LOG, 'library thumb sidecar delete skipped (outside root)', thumbFull)
      continue
    }
    try {
      const st = await fs.lstat(thumbFull)
      if (!st.isFile()) {
        continue
      }
      const realThumb = await fs.realpath(thumbFull)
      if (!isPathInsideRoot(dataRoot, realThumb)) {
        console.warn(LOG, 'library thumb sidecar delete skipped (symlink escapes root)', realThumb)
        continue
      }
      await fs.unlink(realThumb)
      console.info(LOG, 'library thumb sidecar deleted', relative(dataRoot, realThumb).split(sep).join('/'))
    } catch (e) {
      if (isEnoent(e)) {
        continue
      }
      console.warn(LOG, 'library thumb sidecar delete failed', thumbFull, e)
    }
  }
}
