import { extname } from 'path'

export function mimeForFile(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.opus') return 'audio/opus'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.aac') return 'audio/aac'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}
