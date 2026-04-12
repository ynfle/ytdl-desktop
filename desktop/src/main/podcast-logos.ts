import { app } from 'electron'
import { join, resolve, sep } from 'path'
import { promises as fs } from 'fs'
import { CHANNEL_LOGO_FETCH_HEADERS, LOG } from './constants'

/** Directory for downloaded podcast cover art (under Electron userData). */
export function podcastLogosDir(): string {
  return join(app.getPath('userData'), 'podcast-logos')
}

/** One file per show folder id (matches videos/podcasts/<folderId>/). */
export function podcastLogoFilePath(folderId: string): string {
  return join(podcastLogosDir(), `${folderId}.cover`)
}

export function isPathInsidePodcastLogos(absFile: string): boolean {
  const base = resolve(podcastLogosDir()) + sep
  return resolve(absFile).startsWith(base)
}

export async function pathExistsPodcastLogo(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/** Fetch cover image bytes and write beside other userData caches. */
export async function downloadPodcastCover(remoteUrl: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(remoteUrl, {
      redirect: 'follow',
      headers: { ...CHANNEL_LOGO_FETCH_HEADERS }
    })
    if (!res.ok) {
      console.warn(LOG, 'podcast cover HTTP status', res.status, remoteUrl.slice(0, 80))
      return false
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 64) {
      console.warn(LOG, 'podcast cover too small', buf.length)
      return false
    }
    await fs.mkdir(podcastLogosDir(), { recursive: true })
    await fs.writeFile(dest, buf)
    console.info(LOG, 'podcast cover saved', dest, 'bytes', buf.length)
    return true
  } catch (e) {
    console.warn(LOG, 'podcast cover download failed', e)
    return false
  }
}
