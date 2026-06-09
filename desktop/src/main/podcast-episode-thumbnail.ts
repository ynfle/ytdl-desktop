import { execFile as execFileCb } from 'child_process'
import { basename, extname, join, parse } from 'path'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { CHANNEL_LOGO_FETCH_HEADERS, LOG } from './constants'
import { extForImageMime, isValidImageFile, mimeFromImageBuffer } from './image-mime'
import { ytDlpInfoJsonSidecarPaths } from './media-embedded-title'

const execFile = promisify(execFileCb)

const SIDECAR_EXTS = ['.jpg', '.jpeg', '.png', '.webp'] as const

export type PodcastThumbnailRepairResult = {
  sidecarsFixed: number
  embedded: number
  failed: number
}

/** Collect unique thumbnail URLs from a yt-dlp `.info.json` object. */
function thumbnailUrlsFromInfoJson(j: Record<string, unknown>): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const add = (u: unknown) => {
    if (typeof u !== 'string') return
    const t = u.trim()
    if (!t.startsWith('http') || seen.has(t)) return
    seen.add(t)
    urls.push(t)
  }
  add(j.thumbnail)
  const thumbs = j.thumbnails
  if (Array.isArray(thumbs)) {
    for (const row of thumbs) {
      if (row && typeof row === 'object') add((row as Record<string, unknown>).url)
    }
  }
  return urls
}

/** Download image bytes; reject HTML / tiny error bodies masquerading as images. */
async function fetchValidImageBytes(url: string): Promise<{ buf: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { ...CHANNEL_LOGO_FETCH_HEADERS } })
    if (!res.ok) {
      console.warn(LOG, 'podcast thumb fetch HTTP', res.status, url.slice(0, 96))
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 64) {
      console.warn(LOG, 'podcast thumb fetch too small', buf.length, url.slice(0, 96))
      return null
    }
    const mime = mimeFromImageBuffer(buf)
    if (!mime) {
      const preview = buf.subarray(0, 24).toString('utf8').replace(/\s+/g, ' ')
      console.warn(LOG, 'podcast thumb fetch not an image', { url: url.slice(0, 96), preview })
      return null
    }
    console.info(LOG, 'podcast thumb fetch ok', { url: url.slice(0, 96), mime, bytes: buf.length })
    return { buf, mime }
  } catch (e) {
    console.warn(LOG, 'podcast thumb fetch failed', url.slice(0, 96), e)
    return null
  }
}

async function readInfoJsonBesideMp3(mp3Abs: string): Promise<Record<string, unknown> | null> {
  for (const p of ytDlpInfoJsonSidecarPaths(mp3Abs)) {
    try {
      return JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, unknown>
    } catch {
      /* try next */
    }
  }
  return null
}

/** Return path to an existing valid sidecar image beside `mp3Abs`, if any. */
async function findValidSidecarBesideMp3(mp3Abs: string): Promise<string | null> {
  const { dir, name } = parse(mp3Abs)
  for (const ext of SIDECAR_EXTS) {
    const candidate = join(dir, `${name}${ext}`)
    if (await isValidImageFile(candidate)) return candidate
  }
  return null
}

/** Remove bogus sidecar images (e.g. HTML saved as `.png` by yt-dlp). */
async function removeInvalidSidecarsBesideMp3(mp3Abs: string): Promise<void> {
  const { dir, name } = parse(mp3Abs)
  for (const ext of SIDECAR_EXTS) {
    const candidate = join(dir, `${name}${ext}`)
    try {
      await fs.access(candidate)
    } catch {
      continue
    }
    if (await isValidImageFile(candidate)) continue
    await fs.unlink(candidate)
    console.info(LOG, 'podcast thumb removed invalid sidecar', candidate)
  }
}

async function writeSidecarImage(mp3Abs: string, buf: Buffer, mime: string): Promise<string> {
  const { dir, name } = parse(mp3Abs)
  const ext = extForImageMime(mime)
  const dest = join(dir, `${name}${ext}`)
  await fs.writeFile(dest, buf)
  console.info(LOG, 'podcast thumb sidecar written', dest, 'bytes', buf.length)
  return dest
}

/** Ensure a valid episode sidecar exists (re-fetch from feed URLs only; no show-cover copy). */
async function ensureEpisodeSidecar(mp3Abs: string): Promise<string | null> {
  await removeInvalidSidecarsBesideMp3(mp3Abs)

  const existing = await findValidSidecarBesideMp3(mp3Abs)
  if (existing) return existing

  const info = await readInfoJsonBesideMp3(mp3Abs)
  if (!info) return null
  for (const url of thumbnailUrlsFromInfoJson(info)) {
    const fetched = await fetchValidImageBytes(url)
    if (fetched) return writeSidecarImage(mp3Abs, fetched.buf, fetched.mime)
  }
  return null
}

/** True when the MP3 already has an attached-picture video stream. */
async function mp3HasEmbeddedCover(mp3Abs: string): Promise<boolean> {
  try {
    const { stdout } = await execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', mp3Abs],
      { timeout: 15_000 }
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Embed cover art into an MP3 via ffmpeg (MJPEG attached picture for ID3v2). */
async function embedCoverInMp3(mp3Abs: string, imageAbs: string): Promise<boolean> {
  if (await mp3HasEmbeddedCover(mp3Abs)) {
    console.info(LOG, 'podcast thumb embed skip (already has cover)', basename(mp3Abs))
    return true
  }
  const { dir } = parse(mp3Abs)
  const outPath = join(dir, `.embed-${basename(mp3Abs)}`)
  try {
    await fs.unlink(outPath)
  } catch {
    /* ok */
  }
  try {
    console.info(LOG, 'podcast thumb embed starting', { mp3: basename(mp3Abs), image: basename(imageAbs) })
    await execFile(
      'ffmpeg',
      [
        '-y',
        '-i',
        mp3Abs,
        '-i',
        imageAbs,
        '-map',
        '0:a',
        '-map',
        '1:v',
        '-c:a',
        'copy',
        '-c:v',
        'mjpeg',
        '-disposition:v:0',
        'attached_pic',
        '-id3v2_version',
        '3',
        '-metadata:s:v',
        'title=Cover',
        '-metadata:s:v',
        'comment=Cover (front)',
        outPath
      ],
      { timeout: 120_000 }
    )
    await fs.unlink(mp3Abs)
    await fs.rename(outPath, mp3Abs)
    console.info(LOG, 'podcast thumb embed ok', mp3Abs)
    return true
  } catch (e) {
    console.warn(LOG, 'podcast thumb embed failed', mp3Abs, e)
    try {
      await fs.unlink(outPath)
    } catch {
      /* ok */
    }
    return false
  }
}

/**
 * Remove bogus sidecars, re-fetch episode art when possible, embed into MP3 when a real sidecar exists.
 * No show-cover sidecar copy — the UI falls back to `podcast-logos/<folderId>.cover`.
 */
export async function repairPodcastEpisodeThumbnailsInFolder(
  folderAbs: string,
  folderId: string
): Promise<PodcastThumbnailRepairResult> {
  const result: PodcastThumbnailRepairResult = { sidecarsFixed: 0, embedded: 0, failed: 0 }

  let entries: string[]
  try {
    entries = await fs.readdir(folderAbs)
  } catch (e) {
    console.warn(LOG, 'podcast thumb repair readdir failed', folderAbs, e)
    return result
  }

  for (const fileName of entries) {
    if (extname(fileName).toLowerCase() !== '.mp3') continue
    const mp3Abs = join(folderAbs, fileName)
    const hadValidBefore = (await findValidSidecarBesideMp3(mp3Abs)) !== null
    const sidecar = await ensureEpisodeSidecar(mp3Abs)
    if (!sidecar) {
      console.info(LOG, 'podcast thumb repair: no episode sidecar; UI uses show logo', fileName)
      continue
    }
    if (!hadValidBefore) result.sidecarsFixed++

    const embedded = await embedCoverInMp3(mp3Abs, sidecar)
    if (embedded) result.embedded++
    else result.failed++
  }

  console.info(LOG, 'podcast thumb repair done', { folderId, ...result })
  return result
}
