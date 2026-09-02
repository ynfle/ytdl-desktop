import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LOG } from './constants'

/** Serialize async work so parallel yt-dlp workers do not interleave archive copy/merge. */
export type AsyncMutex = {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
}

/** FIFO mutex: each `runExclusive` waits for the previous one to settle (resolve or reject). */
export function createAsyncMutex(): AsyncMutex {
  let chain: Promise<void> = Promise.resolve()
  return {
    runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = chain.then(fn, fn)
      chain = run.then(
        () => undefined,
        () => undefined
      )
      return run
    }
  }
}

/** Split archive text into non-empty trimmed lines (yt-dlp `extractor id` records). */
export function parseArchiveLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

/**
 * Id after the extractor key on a yt-dlp archive line (`youtube VIDEOID`, `generic https://…`).
 * Skips `extractor playlist PLAYLISTID` rows so playlist ids are not treated as videos.
 */
export function archiveLineVideoId(line: string): string | null {
  const trimmed = line.trim()
  const sp = trimmed.indexOf(' ')
  if (sp < 0) return null
  const rest = trimmed.slice(sp + 1).trim()
  if (!rest || rest.startsWith('playlist ') || rest === 'playlist') return null
  return rest
}

/**
 * Video ids from `--download-archive` lines (`youtube VIDEOID`).
 * Skips `youtube playlist PLAYLISTID` rows so playlist ids are not treated as videos.
 */
export function videoIdsFromArchiveLines(lines: string[]): string[] {
  const ids: string[] = []
  for (const line of lines) {
    const id = archiveLineVideoId(line)
    // YouTube claiming only needs the first token (`VIDEOID`), not a URL with spaces.
    const first = id?.split(/\s+/)[0]
    if (first) ids.push(first)
  }
  return ids
}

/** Drop query/hash from http(s) ids so rotating CDN signatures do not look like new episodes. */
export function stripUrlQueryAndHash(id: string): string {
  const t = id.trim()
  if (!/^https?:\/\//i.test(t)) return t
  try {
    const u = new URL(t)
    u.search = ''
    u.hash = ''
    return u.href
  } catch {
    return t
  }
}

/**
 * Approximate yt-dlp `InfoExtractor._generic_id`: last path segment, strip extension, unquote.
 * Naive split (query stays on the filename) matches yt-dlp when the enclosure is a signed URL.
 */
export function genericIdFromUrl(url: string): string {
  const noHash = url.split('#')[0] ?? url
  const last = noHash.replace(/\/+$/, '').split('/').pop() ?? ''
  let decoded = last
  try {
    decoded = decodeURIComponent(last)
  } catch {
    /* keep raw */
  }
  const dot = decoded.lastIndexOf('.')
  const stem = dot > 0 ? decoded.slice(0, dot) : decoded
  const q = stem.indexOf('?')
  return (q >= 0 ? stem.slice(0, q) : stem).trim()
}

/**
 * Lookup keys for one RSS episode so we can match yt-dlp archive rows even when
 * the recorded id was a guid, enclosure URL, or `_generic_id` of a signed CDN URL.
 */
export function podcastArchiveLookupKeys(guid: string, enclosureUrl: string): string[] {
  const keys = new Set<string>()
  const add = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    keys.add(t)
    keys.add(t.toLowerCase())
    const stripped = stripUrlQueryAndHash(t)
    if (stripped) {
      keys.add(stripped)
      keys.add(stripped.toLowerCase())
    }
    const genericId = genericIdFromUrl(t)
    if (genericId) {
      keys.add(genericId)
      keys.add(genericId.toLowerCase())
    }
  }
  add(guid)
  add(enclosureUrl)
  return [...keys]
}

/** Flatten archive lines into a set of ids + normalized aliases for podcast skip checks. */
export function archiveLookupIdSet(lines: string[]): Set<string> {
  const set = new Set<string>()
  for (const line of lines) {
    const id = archiveLineVideoId(line)
    if (!id) continue
    for (const key of podcastArchiveLookupKeys(id, id)) {
      set.add(key)
    }
  }
  return set
}

/** True when any RSS guid / enclosure alias is already in `podcast-downloaded.txt`. */
export function podcastItemAlreadyArchived(archiveIds: Set<string>, keys: string[]): boolean {
  for (const key of keys) {
    if (archiveIds.has(key)) return true
  }
  return false
}

/**
 * Append yt-dlp-style archive records (`generic <guid>`) if they are not already present.
 * Used so the next sync can skip by RSS guid even when yt-dlp recorded a rotating CDN id.
 */
export async function appendArchiveRecords(archiveAbs: string, records: string[]): Promise<number> {
  const existing = await readArchiveLines(archiveAbs)
  const seen = new Set(existing)
  let added = 0
  for (const raw of records) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || seen.has(line)) continue
    seen.add(line)
    existing.push(line)
    added++
  }
  if (added === 0) {
    console.info(LOG, 'archive: append no new records', { archiveAbs })
    return 0
  }
  await fs.writeFile(archiveAbs, `${existing.join('\n')}\n`, 'utf-8')
  console.info(LOG, 'archive: appended records', { archiveAbs, added, total: existing.length })
  return added
}

/** Read shared archive lines; missing file is an empty archive. */
export async function readArchiveLines(archiveAbs: string): Promise<string[]> {
  try {
    const text = await fs.readFile(archiveAbs, 'utf-8')
    const lines = parseArchiveLines(text)
    console.info(LOG, 'archive: read', { archiveAbs, lineCount: lines.length })
    return lines
  } catch (e) {
    if (isEnoent(e)) {
      console.info(LOG, 'archive: missing (treat as empty)', archiveAbs)
      return []
    }
    throw e
  }
}

/** Video ids already recorded in the shared archive (for playlist claim seeding). */
export async function readArchiveVideoIds(archiveAbs: string): Promise<string[]> {
  const ids = videoIdsFromArchiveLines(await readArchiveLines(archiveAbs))
  console.info(LOG, 'archive: video ids for claim seed', { archiveAbs, count: ids.length })
  return ids
}

/** Copy shared archive to `tempAbs`, or write empty if the shared file does not exist yet. */
async function copySharedArchiveTo(sharedArchiveAbs: string, tempAbs: string): Promise<void> {
  try {
    await fs.copyFile(sharedArchiveAbs, tempAbs)
    console.info(LOG, 'archive: copied shared → temp', { sharedArchiveAbs, tempAbs })
  } catch (e) {
    if (!isEnoent(e)) throw e
    await fs.writeFile(tempAbs, '', 'utf-8')
    console.info(LOG, 'archive: shared missing; wrote empty temp', tempAbs)
  }
}

/**
 * Union temp archive lines into the shared file.
 * Preserves existing shared order; appends only lines not already present.
 */
async function mergeTempArchiveIntoShared(sharedArchiveAbs: string, tempAbs: string): Promise<void> {
  const existing = await readArchiveLines(sharedArchiveAbs)
  const seen = new Set(existing)
  let tempText = ''
  try {
    tempText = await fs.readFile(tempAbs, 'utf-8')
  } catch (e) {
    if (isEnoent(e)) {
      console.info(LOG, 'archive: temp missing at merge; skip', tempAbs)
      return
    }
    throw e
  }
  const incoming = parseArchiveLines(tempText)
  let added = 0
  for (const line of incoming) {
    if (seen.has(line)) continue
    seen.add(line)
    existing.push(line)
    added++
  }
  if (added === 0) {
    console.info(LOG, 'archive: merge no new lines', { sharedArchiveAbs, tempAbs })
    return
  }
  await fs.writeFile(sharedArchiveAbs, `${existing.join('\n')}\n`, 'utf-8')
  console.info(LOG, 'archive: merged new lines into shared', {
    sharedArchiveAbs,
    added,
    total: existing.length
  })
}

/**
 * Give one yt-dlp worker a private archive copy, then merge it back under `mutex`.
 * Always merges (even if `work` throws) so completed videos are not lost.
 */
export async function withTempDownloadArchive<T>(
  mutex: AsyncMutex,
  sharedArchiveAbs: string,
  work: (tempArchiveAbs: string) => Promise<T>
): Promise<T> {
  const tempAbs = join(tmpdir(), `ytdl-archive-${randomUUID()}.txt`)
  console.info(LOG, 'archive: worker temp path', { sharedArchiveAbs, tempAbs })
  await mutex.runExclusive(async () => {
    await copySharedArchiveTo(sharedArchiveAbs, tempAbs)
  })
  try {
    return await work(tempAbs)
  } finally {
    try {
      await mutex.runExclusive(async () => {
        await mergeTempArchiveIntoShared(sharedArchiveAbs, tempAbs)
      })
    } catch (e) {
      console.error(LOG, 'archive: merge failed', { sharedArchiveAbs, tempAbs, e })
    }
    try {
      await fs.unlink(tempAbs)
      console.info(LOG, 'archive: removed temp', tempAbs)
    } catch (e) {
      if (!isEnoent(e)) console.warn(LOG, 'archive: temp unlink failed', tempAbs, e)
    }
  }
}

/**
 * In-memory set of YouTube video ids already taken this job (archive seed + in-flight claims).
 * Prevents two playlist workers from downloading the same watch URL at once.
 */
export type YoutubeIdClaimSet = {
  /** Return ids not yet claimed and mark them owned by the caller. */
  claim: (ids: string[]) => Promise<string[]>
}

export function createYoutubeIdClaimSet(seedIds: Iterable<string>): YoutubeIdClaimSet {
  const claimed = new Set(seedIds)
  const mutex = createAsyncMutex()
  console.info(LOG, 'archive: claim set created', { seeded: claimed.size })
  return {
    claim(ids: string[]) {
      return mutex.runExclusive(async () => {
        const mine: string[] = []
        for (const id of ids) {
          if (claimed.has(id)) continue
          claimed.add(id)
          mine.push(id)
        }
        console.info(LOG, 'archive: claimed video ids', {
          requested: ids.length,
          granted: mine.length,
          totalClaimed: claimed.size
        })
        return mine
      })
    }
  }
}
