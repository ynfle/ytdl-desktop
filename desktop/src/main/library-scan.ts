import { extname, join, relative, sep } from 'path'
import { promises as fs } from 'fs'
import { LIBRARY_MEDIA_EXT, LOG } from './constants'
import { resolveSidecarThumbnailRelPath } from './library-thumbnail'

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
  { relPath: string; mtimeMs: number; size: number; thumbRelPath: string | null }[]
> {
  const out: { relPath: string; mtimeMs: number; size: number; thumbRelPath: string | null }[] = []

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
        const thumbRelPath = await resolveSidecarThumbnailRelPath(dataRoot, full)
        out.push({
          relPath: rel.split(sep).join('/'),
          mtimeMs: st.mtimeMs,
          size: st.size,
          thumbRelPath
        })
      }
    }
  }

  await walk(dataRoot)
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const withThumb = out.filter((v) => v.thumbRelPath !== null).length
  console.info(LOG, 'scanLibrary count=', out.length, 'with sidecar thumb=', withThumb)
  return out
}

/** channels.txt / podcasts.txt line normalization (trim, drop blanks and # comments). */
function parseSubscriptionLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

async function readDataRootLinesFile(dataRoot: string, fileName: string): Promise<string[]> {
  const p = join(dataRoot, fileName)
  const text = await fs.readFile(p, 'utf-8')
  return parseSubscriptionLines(text)
}

export async function readChannelsFile(dataRoot: string): Promise<string[]> {
  return readDataRootLinesFile(dataRoot, 'channels.txt')
}

/**
 * Append one normalized identifier as a new line in channels.txt.
 * Creates the file if needed. Caller must pass an already-normalized identifier.
 */
const PODCASTS_FILE = 'podcasts.txt' as const
const PLAYLISTS_FILE = 'playlists.txt' as const

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
  return readDataRootLinesFile(dataRoot, PODCASTS_FILE)
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

/** Same line rules as channels.txt; returns [] when playlists.txt is missing. */
export async function readPlaylistsLinesOrEmpty(dataRoot: string): Promise<string[]> {
  try {
    return await readPlaylistsFile(dataRoot)
  } catch (e) {
    if (isEnoent(e)) return []
    throw e
  }
}

export async function readPlaylistsFile(dataRoot: string): Promise<string[]> {
  return readDataRootLinesFile(dataRoot, PLAYLISTS_FILE)
}

/**
 * Append one canonical playlist URL to playlists.txt (caller passes normalized URL).
 */
export async function appendPlaylistLine(dataRoot: string, playlistUrl: string): Promise<AppendChannelResult> {
  const p = join(dataRoot, PLAYLISTS_FILE)
  let existing: string[]
  try {
    existing = await readPlaylistsFile(dataRoot)
  } catch (e) {
    if (!isEnoent(e)) {
      console.error(LOG, 'appendPlaylistLine read failed', e)
      return { ok: false, error: String(e) }
    }
    existing = []
  }
  if (existing.includes(playlistUrl)) {
    console.info(LOG, 'appendPlaylistLine duplicate skip', playlistUrl.slice(0, 72))
    return { ok: false, duplicate: true }
  }
  try {
    let toWrite = `${playlistUrl}\n`
    try {
      const prev = await fs.readFile(p, 'utf-8')
      if (prev.length > 0 && !prev.endsWith('\n')) {
        toWrite = `\n${toWrite}`
      }
    } catch (e) {
      if (!isEnoent(e)) throw e
    }
    await fs.appendFile(p, toWrite, 'utf-8')
    console.info(LOG, 'appendPlaylistLine ok', { dataRoot, urlPreview: playlistUrl.slice(0, 64) })
    return { ok: true }
  } catch (e) {
    console.error(LOG, 'appendPlaylistLine write failed', e)
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
