#!/usr/bin/env node
/**
 * Remove invalid episode sidecars and re-fetch from .info.json URLs (no show-cover copy).
 * Usage: node scripts/repair-podcast-thumbs.mjs [dataRoot] [folderId]
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const exec = promisify(execFile)
const dataRoot = process.argv[2] ?? process.cwd()
const folderId = process.argv[3] ?? '3042c5963ad773aa'
const folderAbs = path.join(dataRoot, 'videos', 'podcasts', folderId)

function mime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  return null
}

async function hasCover(mp3) {
  try {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', mp3
    ], { timeout: 15000 })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function embed(mp3, image) {
  if (await hasCover(mp3)) {
    console.log('skip embed (has cover)', path.basename(mp3))
    return
  }
  const out = path.join(path.dirname(mp3), `.embed-${path.basename(mp3)}`)
  try { await fs.promises.unlink(out) } catch {}
  await exec('ffmpeg', [
    '-y', '-i', mp3, '-i', image,
    '-map', '0:a', '-map', '1:v',
    '-c:a', 'copy', '-c:v', 'mjpeg',
    '-disposition:v:0', 'attached_pic',
    '-id3v2_version', '3',
    '-metadata:s:v', 'title=Cover',
    '-metadata:s:v', 'comment=Cover (front)',
    out
  ], { timeout: 120_000 })
  await fs.promises.unlink(mp3)
  await fs.promises.rename(out, mp3)
}

let cleaned = 0
let embedded = 0
for (const f of await fs.promises.readdir(folderAbs)) {
  if (!f.endsWith('.mp3')) continue
  const mp3 = path.join(folderAbs, f)
  const stem = f.slice(0, -4)
  let sidecar = null
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const p = path.join(folderAbs, stem + ext)
    try {
      const b = await fs.promises.readFile(p)
      if (!mime(b)) {
        await fs.promises.unlink(p)
        console.log('removed invalid', stem + ext)
        cleaned++
      } else if (!sidecar) {
        sidecar = p
      }
    } catch {}
  }
  if (sidecar) {
    await embed(mp3, sidecar)
    embedded++
  } else {
    console.log('no episode sidecar; UI uses show logo for', f)
  }
}
console.log('done', { cleaned, embedded })
