import { extname, join, relative, sep } from 'path'
import { promises as fs } from 'fs'
import { LOG, VIDEO_EXT } from './constants'

export async function scanLibraryVideos(dataRoot: string): Promise<
  { relPath: string; mtimeMs: number; size: number }[]
> {
  const out: { relPath: string; mtimeMs: number; size: number }[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (e) {
      console.warn(LOG, 'readdir skip', dir, e)
      return
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === 'out' || ent.name.startsWith('.')) continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (full === join(dataRoot, 'desktop')) {
          console.info(LOG, 'skip nested desktop/ app folder')
          continue
        }
        await walk(full)
      } else if (ent.isFile()) {
        const ext = extname(ent.name).toLowerCase()
        if (!VIDEO_EXT.has(ext)) continue
        const st = await fs.stat(full)
        const rel = relative(dataRoot, full)
        out.push({
          relPath: rel.split(sep).join('/'),
          mtimeMs: st.mtimeMs,
          size: st.size
        })
      }
    }
  }

  await walk(dataRoot)
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  console.info(LOG, 'scanLibrary count=', out.length)
  return out
}

export async function readChannelsFile(dataRoot: string): Promise<string[]> {
  const p = join(dataRoot, 'channels.txt')
  const text = await fs.readFile(p, 'utf-8')
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}
