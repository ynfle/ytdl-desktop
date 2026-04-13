import { join, parse, relative, sep } from 'path'
import { promises as fs } from 'fs'
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
