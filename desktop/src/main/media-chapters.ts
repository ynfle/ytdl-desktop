import { execFile as execFileCb } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import type { IChapter } from 'music-metadata'
import { parseFile } from 'music-metadata'
import type { MediaChapter } from '../../shared/ytdl-api'
import { LOG } from './constants'
import { ytDlpInfoJsonSidecarPaths } from './media-embedded-title'
import { buildChildProcessEnv } from './yt-dlp-runner'

const execFile = promisify(execFileCb)

/** Ignore chapter starts past this; timescale mix-ups show up as multi-day offsets. */
const MAX_CHAPTER_START_SEC = 48 * 60 * 60
/** Cap so a corrupt chapter list cannot flood the transport menu. */
const MAX_CHAPTERS = 500

/** ffprobe `-show_chapters` JSON (only the fields we read). */
type FfprobeChaptersJson = {
  chapters?: Array<{
    start_time?: string | number
    end_time?: string | number
    tags?: Record<string, string>
  }>
}

/** One chapter before titles are filled in and duplicates are dropped. */
type RawChapter = {
  startSec: number
  endSec: number | null
  title: string
}

/**
 * Finite, non-negative seconds from a JSON number or ffprobe's decimal string.
 * `0` is valid (a chapter that starts at the beginning of the file).
 */
function finiteNonNegative(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return null
}

/** Collapse whitespace and cap length so a bad tag cannot blow up the menu. */
function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** True for titles we invented when the container had times but no name. */
function isPlaceholderTitle(title: string): boolean {
  return /^chapter \d+$/i.test(title.trim())
}

/**
 * Sort, drop invalid rows, and fill missing titles.
 * Chapters that start at the same instant collapse to one row (prefer a real title).
 */
export function normalizeMediaChapters(raw: readonly RawChapter[]): MediaChapter[] {
  const cleaned: RawChapter[] = []
  for (const ch of raw) {
    if (!Number.isFinite(ch.startSec) || ch.startSec < 0 || ch.startSec > MAX_CHAPTER_START_SEC) continue
    let endSec: number | null = null
    if (
      typeof ch.endSec === 'number' &&
      Number.isFinite(ch.endSec) &&
      ch.endSec > ch.startSec &&
      ch.endSec <= MAX_CHAPTER_START_SEC
    ) {
      endSec = ch.endSec
    }
    cleaned.push({ startSec: ch.startSec, endSec, title: cleanTitle(ch.title) })
  }
  cleaned.sort((a, b) => a.startSec - b.startSec)

  const deduped: RawChapter[] = []
  for (const ch of cleaned) {
    const prev = deduped[deduped.length - 1]
    // Same instant (ffprobe + sidecar sometimes disagree by a few milliseconds).
    if (prev && Math.abs(prev.startSec - ch.startSec) < 0.05) {
      if (!prev.title && ch.title) deduped[deduped.length - 1] = ch
      continue
    }
    deduped.push(ch)
  }

  return deduped.slice(0, MAX_CHAPTERS).map((ch, i) => ({
    startSec: ch.startSec,
    endSec: ch.endSec,
    title: ch.title.length > 0 ? ch.title : `Chapter ${i + 1}`
  }))
}

/** music-metadata stores MP4 chapter times as ticks; ID3 chapters are already seconds. */
function chapterSeconds(value: number, timeScale: number | undefined): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  // `timeScale` is units per second. ID3 mapping leaves it unset and `start` is already seconds.
  if (typeof timeScale === 'number' && timeScale > 1) return value / timeScale
  return value
}

/** Chapter title from ffprobe's tag map (`title` / `TITLE`). */
function titleFromFfprobeTags(tags: Record<string, string> | undefined): string {
  if (!tags || typeof tags !== 'object') return ''
  for (const [key, value] of Object.entries(tags)) {
    if (key.toLowerCase() !== 'title' || typeof value !== 'string') continue
    return cleanTitle(value)
  }
  return ''
}

/** yt-dlp `.info.json` `chapters` array (`start_time` / `end_time` / `title`). */
export function chaptersFromInfoJsonObject(j: Record<string, unknown>): MediaChapter[] {
  const list = j.chapters
  if (!Array.isArray(list)) return []
  const raw: RawChapter[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const startSec = finiteNonNegative(rec.start_time)
    if (startSec == null) continue
    const title = typeof rec.title === 'string' ? rec.title : ''
    raw.push({ startSec, endSec: finiteNonNegative(rec.end_time), title })
  }
  return normalizeMediaChapters(raw)
}

/** First sidecar that actually contains a chapter list. */
async function readInfoJsonChapters(mediaAbsPath: string): Promise<MediaChapter[]> {
  for (const jsonPath of ytDlpInfoJsonSidecarPaths(mediaAbsPath)) {
    try {
      const raw = await fs.readFile(jsonPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const chapters = chaptersFromInfoJsonObject(parsed as Record<string, unknown>)
      console.info(LOG, 'readInfoJsonChapters', {
        json: jsonPath.slice(-80),
        count: chapters.length
      })
      if (chapters.length > 0) return chapters
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') continue
      console.info(LOG, 'readInfoJsonChapters skipped', {
        json: jsonPath.slice(-80),
        err: String(e).slice(0, 160)
      })
    }
  }
  return []
}

/**
 * Container chapters via ffprobe (`chpl`, Matroska chapters, ID3 CHAP, ffmpeg chapter tracks).
 * `available` is false when ffprobe is missing or its JSON could not be read.
 */
async function readChaptersViaFfprobe(
  absPath: string
): Promise<{ available: boolean; chapters: MediaChapter[] }> {
  let stdout: string
  try {
    const r = await execFile(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_chapters', absPath],
      { env: buildChildProcessEnv(), timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }
    )
    stdout = String(r.stdout)
  } catch (e) {
    console.info(LOG, 'readChaptersViaFfprobe failed', {
      sample: absPath.slice(-64),
      err: String(e).slice(0, 180)
    })
    return { available: false, chapters: [] }
  }
  try {
    const j = JSON.parse(stdout) as FfprobeChaptersJson
    const list = Array.isArray(j.chapters) ? j.chapters : []
    const raw: RawChapter[] = []
    for (const ch of list) {
      const startSec = finiteNonNegative(ch.start_time)
      if (startSec == null) continue
      raw.push({
        startSec,
        endSec: finiteNonNegative(ch.end_time),
        title: titleFromFfprobeTags(ch.tags)
      })
    }
    const chapters = normalizeMediaChapters(raw)
    console.info(LOG, 'readChaptersViaFfprobe', {
      sample: absPath.slice(-64),
      count: chapters.length
    })
    return { available: true, chapters }
  } catch (e) {
    console.warn(LOG, 'readChaptersViaFfprobe json parse', String(e).slice(0, 180))
    return { available: false, chapters: [] }
  }
}

/** ID3 CHAP (parsed by default) and QuickTime chapter tracks (`includeChapters`). */
async function readChaptersViaMusicMetadata(absPath: string): Promise<MediaChapter[]> {
  try {
    const meta = await parseFile(absPath, { skipCovers: true, includeChapters: true })
    const list = meta.format.chapters
    if (!Array.isArray(list) || list.length === 0) {
      console.info(LOG, 'readChaptersViaMusicMetadata none', { sample: absPath.slice(-64) })
      return []
    }
    const raw: RawChapter[] = []
    for (const ch of list as IChapter[]) {
      const startSec = chapterSeconds(ch.start, ch.timeScale)
      if (startSec == null) continue
      const endSec =
        typeof ch.end === 'number' ? chapterSeconds(ch.end, ch.timeScale) : null
      raw.push({
        startSec,
        endSec,
        title: typeof ch.title === 'string' ? ch.title : ''
      })
    }
    const chapters = normalizeMediaChapters(raw)
    console.info(LOG, 'readChaptersViaMusicMetadata', {
      sample: absPath.slice(-64),
      count: chapters.length
    })
    return chapters
  } catch (e) {
    console.info(LOG, 'readChaptersViaMusicMetadata failed', {
      sample: absPath.slice(-64),
      err: String(e).slice(0, 180)
    })
    return []
  }
}

/**
 * When the container has times but no names, copy titles from the sidecar
 * whose start is within 1.5s (or the same index).
 */
function applySidecarTitles(embedded: MediaChapter[], sidecar: MediaChapter[]): MediaChapter[] {
  if (sidecar.length === 0) return embedded
  return embedded.map((ch, i) => {
    if (!isPlaceholderTitle(ch.title)) return ch
    const near = sidecar.find((s) => Math.abs(s.startSec - ch.startSec) < 1.5)
    const match = near ?? sidecar[i]
    if (match && match.title && !isPlaceholderTitle(match.title)) {
      return { ...ch, title: match.title }
    }
    return ch
  })
}

/**
 * Chapters for one library file.
 * Prefers markers embedded in the container (ffprobe, then music-metadata).
 * If the file has none, uses the yt-dlp `.info.json` `chapters` array — that is
 * where YouTube/RSS chapters land when the download did not embed them.
 */
export async function readMediaChapters(absPath: string): Promise<MediaChapter[]> {
  const sidecar = await readInfoJsonChapters(absPath)
  const probed = await readChaptersViaFfprobe(absPath)
  let embedded = probed.chapters
  // music-metadata walks the file. Skip it when ffprobe already confirmed a video has no chapters.
  const audioExt = /\.(mp3|m4a|aac|ogg|opus|flac|wav)$/i.test(absPath)
  if (embedded.length === 0 && (!probed.available || audioExt)) {
    console.info(LOG, 'readMediaChapters trying music-metadata', {
      sample: absPath.slice(-64),
      ffprobeAvailable: probed.available,
      audioExt
    })
    embedded = await readChaptersViaMusicMetadata(absPath)
  }
  if (embedded.length > 0) {
    const merged = applySidecarTitles(embedded, sidecar)
    console.info(LOG, 'readMediaChapters embedded', {
      sample: absPath.slice(-64),
      count: merged.length,
      sidecarCount: sidecar.length,
      firstStart: merged[0]?.startSec ?? null,
      firstTitle: merged[0]?.title.slice(0, 48) ?? null
    })
    return merged
  }
  if (sidecar.length > 0) {
    console.info(LOG, 'readMediaChapters from info.json', {
      sample: absPath.slice(-64),
      count: sidecar.length,
      firstTitle: sidecar[0]?.title.slice(0, 48) ?? null
    })
    return sidecar
  }
  console.info(LOG, 'readMediaChapters none', { sample: absPath.slice(-64) })
  return []
}
