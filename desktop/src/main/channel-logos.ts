import { app } from 'electron'
import { createHash } from 'node:crypto'
import { join, resolve, sep } from 'path'
import { promises as fs } from 'fs'
import { CHANNEL_LOGO_FETCH_HEADERS, LOG } from './constants'

/** Directory for downloaded channel avatars (under Electron userData). */
export function channelLogosDir(): string {
  return join(app.getPath('userData'), 'channel-logos')
}

/** Stable filename for a channel line + data root (avoids unsafe path chars in identifier). */
export function channelLogoFilePath(dataRootResolved: string, identifier: string): string {
  const h = createHash('sha256').update(`${dataRootResolved}\0${identifier}`).digest('hex').slice(0, 32)
  return join(channelLogosDir(), `${h}.avatar`)
}

/** Set `Content-Type` from file magic (avatars may be jpeg, webp, or png). */
export async function peekImageMime(filePath: string): Promise<string> {
  const fh = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(16)
    const { bytesRead } = await fh.read(buf, 0, 16, 0)
    const b = buf.subarray(0, bytesRead)
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  } finally {
    await fh.close()
  }
  return 'application/octet-stream'
}

export function isPathInsideChannelLogos(absFile: string): boolean {
  const base = resolve(channelLogosDir()) + sep
  return resolve(absFile).startsWith(base)
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/** Fetch avatar bytes from yt3 / CDN and write next to other userData caches. */
export async function downloadChannelLogo(remoteUrl: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(remoteUrl, {
      redirect: 'follow',
      headers: { ...CHANNEL_LOGO_FETCH_HEADERS }
    })
    if (!res.ok) {
      console.warn(LOG, 'channel logo HTTP status', res.status, remoteUrl.slice(0, 80))
      return false
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 64) {
      console.warn(LOG, 'channel logo too small', buf.length)
      return false
    }
    await fs.mkdir(channelLogosDir(), { recursive: true })
    await fs.writeFile(dest, buf)
    console.info(LOG, 'channel logo saved', dest, 'bytes', buf.length)
    return true
  } catch (e) {
    console.warn(LOG, 'channel logo download failed', e)
    return false
  }
}
