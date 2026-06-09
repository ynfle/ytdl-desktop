#!/usr/bin/env node
/** One-off: rename uuid-only podcast files to readable stems (matches ytdl-output-template). */
import fs from 'node:fs'
import path from 'node:path'

const TITLE_MAX = 50
const ID_SUFFIX = 8
const EP =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXTS = ['.mp3', '.png', '.jpg', '.jpeg', '.webp', '.info.json']

function truncateUtf8(s, max) {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= max) return s
  let end = max
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

function readableBasename(title, id) {
  let stem = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ /g, '_')
    .replace(/[^\w.\-+]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  stem = truncateUtf8(stem, TITLE_MAX)
  const tail = id.replace(/-/g, '').slice(0, ID_SUFFIX)
  return tail.length > 0 ? `${stem}_${tail}` : stem
}

const root = process.argv[2] ?? process.cwd()
const podcastsRoot = path.join(root, 'videos', 'podcasts')
if (!fs.existsSync(podcastsRoot)) {
  console.error('No videos/podcasts under', root)
  process.exit(1)
}

let renamed = 0
for (const folder of fs.readdirSync(podcastsRoot)) {
  const dir = path.join(podcastsRoot, folder)
  if (!fs.statSync(dir).isDirectory()) continue
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.mp3')) continue
    const stem = f.slice(0, -4)
    if (!EP.test(stem)) continue
    const infoPath = path.join(dir, `${stem}.info.json`)
    if (!fs.existsSync(infoPath)) continue
    const j = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
    const newStem = readableBasename(j.title, j.id)
    if (newStem === stem) continue
    for (const ext of EXTS) {
      const from = path.join(dir, `${stem}${ext}`)
      const to = path.join(dir, `${newStem}${ext}`)
      if (!fs.existsSync(from)) continue
      if (fs.existsSync(to)) {
        console.log('skip (target exists)', path.basename(to))
        continue
      }
      fs.renameSync(from, to)
      console.log(path.basename(from), '->', path.basename(to))
      renamed++
    }
  }
}
console.log('renamed file pairs:', renamed)
