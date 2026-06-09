import { promises as fs } from 'fs'

/** Detect image MIME from the first bytes (PNG / JPEG / WebP). */
export function mimeFromImageBuffer(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return 'image/webp'
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  return null
}

/** File extension for a detected image MIME type. */
export function extForImageMime(mime: string): '.jpg' | '.jpeg' | '.png' | '.webp' {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  return '.jpg'
}

/** True when the path points at a real image file (not HTML error pages saved as `.png`). */
export async function isValidImageFile(filePath: string): Promise<boolean> {
  try {
    const fh = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(16)
      const { bytesRead } = await fh.read(buf, 0, 16, 0)
      return mimeFromImageBuffer(buf.subarray(0, bytesRead)) !== null
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}
