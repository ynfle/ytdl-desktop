import { extname, join, relative, sep } from 'path'
import { promises as fs } from 'fs'
import { LIBRARY_MEDIA_EXT, LOG } from './constants'

export type AppendChannelResult =
  | { ok: true }
  | { ok: false; duplicate: true }
  | { ok: false; error: string }

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
}

/** Same as readChannelsFile but returns [] when channels.txt is missing. */
export async function readChannelsLinesOrEmpty(dataRoot: string): Promise<string[]> {
  try {
    return await readChannelsFile(dataRoot)
  } catch (e) {
    if (isEnoent(e)) return []
    throw e
  }
}

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
        if (!LIBRARY_MEDIA_EXT.has(ext)) continue
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

/**
 * Append one normalized identifier as a new line in channels.txt.
 * Creates the file if needed. Caller must pass an already-normalized identifier.
 */
const PODCASTS_FILE = 'podcasts.txt' as const

/** Same line rules as channels.txt; returns [] when podcasts.txt is missing. */
export async function readPodcastsLinesOrEmpty(dataRoot: string): Promise<string[]> {
  try {
    return await readPodcastsFile(dataRoot)
  } catch (e) {
    if (isEnoent(e)) return []
    throw e
  }
}

export async function readPodcastsFile(dataRoot: string): Promise<string[]> {
  const p = join(dataRoot, PODCASTS_FILE)
  const text = await fs.readFile(p, 'utf-8')
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

/**
 * Append one feed URL to podcasts.txt (caller passes canonical https URL).
 */
export async function appendPodcastLine(dataRoot: string, feedUrl: string): Promise<AppendChannelResult> {
  const p = join(dataRoot, PODCASTS_FILE)
  let existing: string[]
  try {
    existing = await readPodcastsFile(dataRoot)
  } catch (e) {
    if (!isEnoent(e)) {
      console.error(LOG, 'appendPodcastLine read failed', e)
      return { ok: false, error: String(e) }
    }
    existing = []
  }
  if (existing.includes(feedUrl)) {
    console.info(LOG, 'appendPodcastLine duplicate skip', feedUrl.slice(0, 60))
    return { ok: false, duplicate: true }
  }
  try {
    let toWrite = `${feedUrl}\n`
    try {
      const prev = await fs.readFile(p, 'utf-8')
      if (prev.length > 0 && !prev.endsWith('\n')) {
        toWrite = `\n${toWrite}`
      }
    } catch (e) {
      if (!isEnoent(e)) throw e
    }
    await fs.appendFile(p, toWrite, 'utf-8')
    console.info(LOG, 'appendPodcastLine ok', { dataRoot, feedPreview: feedUrl.slice(0, 48) })
    return { ok: true }
  } catch (e) {
    console.error(LOG, 'appendPodcastLine write failed', e)
    return { ok: false, error: String(e) }
  }
}

/** Remove exact feed URL line from podcasts.txt. */
export async function removePodcastLine(
  dataRoot: string,
  feedUrl: string
): Promise<{ ok: true } | { ok: false; notFound: true } | { ok: false; error: string }> {
  const p = join(dataRoot, PODCASTS_FILE)
  let lines: string[]
  try {
    lines = await readPodcastsFile(dataRoot)
  } catch (e) {
    if (isEnoent(e)) return { ok: false, notFound: true }
    console.error(LOG, 'removePodcastLine read failed', e)
    return { ok: false, error: String(e) }
  }
  if (!lines.includes(feedUrl)) {
    return { ok: false, notFound: true }
  }
  const next = lines.filter((l) => l !== feedUrl)
  try {
    const body = next.length > 0 ? `${next.join('\n')}\n` : ''
    await fs.writeFile(p, body, 'utf-8')
    console.info(LOG, 'removePodcastLine ok', feedUrl.slice(0, 48))
    return { ok: true }
  } catch (e) {
    console.error(LOG, 'removePodcastLine write failed', e)
    return { ok: false, error: String(e) }
  }
}

export async function appendChannelLine(dataRoot: string, identifier: string): Promise<AppendChannelResult> {
  const p = join(dataRoot, 'channels.txt')
  let existing: string[]
  try {
    existing = await readChannelsFile(dataRoot)
  } catch (e) {
    if (!isEnoent(e)) {
      console.error(LOG, 'appendChannelLine read failed', e)
      return { ok: false, error: String(e) }
    }
    existing = []
  }
  if (existing.includes(identifier)) {
    console.info(LOG, 'appendChannelLine duplicate skip', identifier)
    return { ok: false, duplicate: true }
  }

  try {
    let toWrite = `${identifier}\n`
    try {
      const prev = await fs.readFile(p, 'utf-8')
      if (prev.length > 0 && !prev.endsWith('\n')) {
        toWrite = `\n${toWrite}`
      }
    } catch (e) {
      if (!isEnoent(e)) throw e
    }
    await fs.appendFile(p, toWrite, 'utf-8')
    console.info(LOG, 'appendChannelLine ok', { dataRoot, identifier })
    return { ok: true }
  } catch (e) {
    console.error(LOG, 'appendChannelLine write failed', e)
    return { ok: false, error: String(e) }
  }
}
