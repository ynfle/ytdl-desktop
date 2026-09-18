import { execFile as execFileCb } from 'child_process'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import type { IAudioMetadata } from 'music-metadata'
import { parseFile } from 'music-metadata'
import { humanizeRestrictFilename } from '../../shared/humanize-restrict-filename'
import { LOG } from './constants'

const execFile = promisify(execFileCb)

/** Normalize for comparing human title vs filesystem stem (underscores vs spaces, case). */
function normTitleKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\.(mp4|m4v|mkv|webm|m4a|mp3|opus|aac|ogg)$/i, '')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * True when `title` is obviously the download template / filename (not a separate metadata title).
 * yt-dlp often sets MP4 `handler_name` to the basename; we must not treat that as display title.
 */
function isLikelyFilesystemTemplateTitle(title: string, mediaAbsPath: string): boolean {
  const t = title.trim()
  if (t.length === 0) return true
  const fileBase = basename(mediaAbsPath)
  const stem = fileBase.replace(/\.[^/.]+$/, '')
  if (t === fileBase || t === stem) return true
  const nt = normTitleKey(t)
  const ns = normTitleKey(stem)
  if (nt.length >= 8 && ns.length >= 8 && nt === ns) return true
  return false
}

/** Sidecar paths yt-dlp uses for `--write-info-json` (often `Video.mp4.info.json`). */
export function ytDlpInfoJsonSidecarPaths(mediaAbsPath: string): string[] {
  const dir = dirname(mediaAbsPath)
  const base = basename(mediaAbsPath)
  const paths = [join(dir, `${base}.info.json`), join(dir, `${base.replace(/\.[^/.]+$/, '')}.info.json`)]
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/** Parse yt-dlp `YYYYMMDD` as a **local calendar date** (not UTC midnight).
 * UTC midnight of that day is the previous evening in US timezones, so the library
 * would show the wrong post date (e.g. Sep 15 instead of Sep 16).
 */
function parseYtDlpYyyymmddLocal(dateStr: string): number | null {
  if (!/^\d{8}$/.test(dateStr)) return null
  const y = Number(dateStr.slice(0, 4))
  const m = Number(dateStr.slice(4, 6)) - 1
  const d = Number(dateStr.slice(6, 8))
  const ms = new Date(y, m, d).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** ISO `YYYY-MM-DD` (optional time) used by some GenericIE / RSS-derived sidecars. */
function parseIsoDateToMs(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (/^\d{8}$/.test(t)) return parseYtDlpYyyymmddLocal(t)
  const ms = Date.parse(t)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/**
 * yt-dlp `timestamp` is unix **seconds**; some writers store milliseconds (13+ digits).
 */
function epochMsFromUnixish(ts: number): number | null {
  if (!Number.isFinite(ts) || ts <= 0) return null
  if (ts > 1e12) return Math.floor(ts)
  if (ts > 1e9) return Math.floor(ts) * 1000
  return null
}

/**
 * Upload / release time from a parsed yt-dlp `.info.json` object (epoch ms).
 * Prefers `timestamp` / `upload_date`; falls back to podcast-style `release_*`.
 * Does **not** use `epoch` (that's yt-dlp extraction time, not the post date).
 */
export function parseYtDlpUploadedAtMs(j: Record<string, unknown>): number | null {
  const ts = j.timestamp
  if (typeof ts === 'number') {
    const fromTs = epochMsFromUnixish(ts)
    if (fromTs != null) return fromTs
  } else if (typeof ts === 'string' && ts.trim()) {
    const n = Number(ts)
    const fromTs = epochMsFromUnixish(n)
    if (fromTs != null) return fromTs
    const fromIso = parseIsoDateToMs(ts)
    if (fromIso != null) return fromIso
  }
  if (typeof j.upload_date === 'string') {
    const fromUpload = parseIsoDateToMs(j.upload_date)
    if (fromUpload != null) return fromUpload
  }
  const rts = j.release_timestamp
  if (typeof rts === 'number') {
    const fromReleaseTs = epochMsFromUnixish(rts)
    if (fromReleaseTs != null) return fromReleaseTs
  } else if (typeof rts === 'string' && rts.trim()) {
    const fromReleaseTs = epochMsFromUnixish(Number(rts))
    if (fromReleaseTs != null) return fromReleaseTs
  }
  if (typeof j.release_date === 'string') {
    const fromRelease = parseIsoDateToMs(j.release_date)
    if (fromRelease != null) return fromRelease
  }
  return null
}

/** Clock `HH:MM:SS` / `MM:SS` or a numeric second count. */
function parseClockDurationSec(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const parts = t.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
  const sec =
    nums.length === 3 ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]! : nums[0]! * 60 + nums[1]!
  return sec > 0 ? sec : null
}

/**
 * Duration in seconds from yt-dlp sidecar fields.
 * Ignores JSON `null` (`Number(null) === 0` would otherwise show `0:00` in the library).
 */
export function parseInfoJsonDurationSec(j: Record<string, unknown>): number | null {
  if (typeof j.duration === 'number' && Number.isFinite(j.duration) && j.duration > 0) {
    return j.duration
  }
  if (typeof j.duration === 'string') {
    const fromStr = parseClockDurationSec(j.duration)
    if (fromStr != null) return fromStr
  }
  if (typeof j.duration_string === 'string') {
    const fromLabel = parseClockDurationSec(j.duration_string)
    if (fromLabel != null) return fromLabel
  }
  const approx = j.approx_duration
  if (typeof approx === 'number' && Number.isFinite(approx) && approx > 0) return approx
  return null
}

/** UTC `YYYYMMDD` for yt-dlp `upload_date` / `release_date`. */
function yyyymmddUtcFromMs(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export type YtDlpInfoJsonScanFields = {
  title: string | null
  /** Upload / release instant from sidecar when yt-dlp wrote it. */
  uploadedAtMs: number | null
  duration: number | null
}

/** Enclosure-URL downloads often set `title` to the CDN uuid (same as `id`); the library must not show that. */
const EXTRACTOR_UUID_TITLE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isPlaceholderExtractorTitle(title: string, json: Record<string, unknown>): boolean {
  const t = title.trim()
  if (!t) return true
  const id = typeof json.id === 'string' ? json.id.trim() : ''
  // GenericIE enclosure downloads set `title` to the CDN filename/`id` (not the RSS episode name).
  if (id.length > 0 && t === id) return true
  if (EXTRACTOR_UUID_TITLE_RE.test(t)) return true
  return false
}

/** Prefer `title`, then `fulltitle`, skipping GenericIE CDN/uuid placeholders. */
function humanTitleFromInfoJson(json: Record<string, unknown>): string | null {
  const candidates = [json.title, json.fulltitle]
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const t = raw.trim()
    if (t.length > 0 && !isPlaceholderExtractorTitle(t, json)) return t
  }
  return null
}

/** Read title + upload time from yt-dlp `.info.json` sidecars beside a media file. */
export async function readYtDlpInfoJsonScanFields(mediaAbsPath: string): Promise<YtDlpInfoJsonScanFields> {
  // Merge across `file.ext.info.json` and `file.info.json`; don't stop on a placeholder title
  // just because that sidecar already has duration / upload date.
  let best: YtDlpInfoJsonScanFields = { title: null, uploadedAtMs: null, duration: null }
  for (const p of ytDlpInfoJsonSidecarPaths(mediaAbsPath)) {
    try {
      const raw = await fs.readFile(p, 'utf8')
      const j = JSON.parse(raw) as Record<string, unknown>
      const title = humanTitleFromInfoJson(j)
      if (title && !best.title) best.title = title
      const uploadedAtMs = parseYtDlpUploadedAtMs(j)
      if (best.uploadedAtMs == null && uploadedAtMs != null) best.uploadedAtMs = uploadedAtMs
      const duration = parseInfoJsonDurationSec(j)
      if (best.duration == null && duration != null) best.duration = duration
      console.info(LOG, 'readYtDlpInfoJsonScanFields', {
        json: p.slice(-80),
        titleLen: title?.length ?? 0,
        uploadedAtMs,
        duration
      })
      if (best.title && best.uploadedAtMs != null && best.duration != null) return best
    } catch {
      /* missing or invalid */
    }
  }
  return best
}

/** Merge RSS title / duration / pubDate into a parsed yt-dlp info object. */
function applyRssEpisodePatchToJson(
  j: Record<string, unknown>,
  title: string,
  publishedAtMs: number | null,
  durationSec: number | null
): boolean {
  let changed = false
  const prevTitle = typeof j.title === 'string' ? j.title.trim() : ''
  const prevFull = typeof j.fulltitle === 'string' ? j.fulltitle.trim() : ''
  if (prevTitle !== title || prevFull !== title) {
    j.title = title
    j.fulltitle = title
    if (typeof j.track === 'string' && j.track.trim().length > 0) j.track = title
    changed = true
  }
  if (durationSec != null) {
    const rounded = Math.round(durationSec)
    const prevDuration = parseInfoJsonDurationSec(j)
    if (prevDuration == null || Math.abs(prevDuration - rounded) >= 0.5) {
      j.duration = rounded
      changed = true
    }
  }
  if (publishedAtMs != null) {
    const tsSec = Math.floor(publishedAtMs / 1000)
    const ymd = yyyymmddUtcFromMs(publishedAtMs)
    if (j.timestamp !== tsSec || j.upload_date !== ymd || j.release_date !== ymd) {
      j.timestamp = tsSec
      j.release_timestamp = tsSec
      j.upload_date = ymd
      j.release_date = ymd
      changed = true
    }
  }
  return changed
}

export type RssEpisodeInfoJsonPatch = {
  title: string
  publishedAtMs?: number | null
  durationSec?: number | null
}

function normalizeRssEpisodePatch(patch: RssEpisodeInfoJsonPatch): {
  title: string
  publishedAtMs: number | null
  durationSec: number | null
} | null {
  const title = patch.title.trim()
  if (!title) return null
  const publishedAtMs =
    typeof patch.publishedAtMs === 'number' && Number.isFinite(patch.publishedAtMs) && patch.publishedAtMs > 0
      ? patch.publishedAtMs
      : null
  const durationSec =
    typeof patch.durationSec === 'number' && Number.isFinite(patch.durationSec) && patch.durationSec > 0
      ? patch.durationSec
      : null
  return { title, publishedAtMs, durationSec }
}

/**
 * Write authoritative RSS metadata to the existing yt-dlp sidecar after download.
 * `runYtDlp` resolves only after the process exits, so no retry or guessed path is needed.
 */
export async function writeRssEpisodeIntoYtDlpInfoJson(
  mediaAbsPath: string,
  patch: RssEpisodeInfoJsonPatch
): Promise<boolean> {
  const norm = normalizeRssEpisodePatch(patch)
  if (!norm) return false
  for (const jsonAbsPath of ytDlpInfoJsonSidecarPaths(mediaAbsPath)) {
    try {
      const raw = await fs.readFile(jsonAbsPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(LOG, 'podcast info.json is not an object', { json: jsonAbsPath.slice(-80) })
        continue
      }
      const json = parsed as Record<string, unknown>
      if (!applyRssEpisodePatchToJson(json, norm.title, norm.publishedAtMs, norm.durationSec)) {
        console.info(LOG, 'podcast info.json already has RSS metadata', {
          json: jsonAbsPath.slice(-80)
        })
        return false
      }
      await fs.writeFile(jsonAbsPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
      console.info(LOG, 'podcast info.json RSS metadata written', {
        json: jsonAbsPath.slice(-80),
        titlePreview: norm.title.slice(0, 48),
        durationSec: norm.durationSec,
        publishedAtMs: norm.publishedAtMs
      })
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') continue
      console.warn(LOG, 'podcast info.json RSS metadata write failed', {
        json: jsonAbsPath.slice(-80),
        err: String(e).slice(0, 200)
      })
      return false
    }
  }
  console.warn(LOG, 'podcast info.json missing beside downloaded media', {
    media: mediaAbsPath.slice(-80)
  })
  return false
}

/** Probe container duration when `.info.json` omitted it (typical GenericIE enclosure MP3). */
export async function probeMediaDurationSec(absPath: string): Promise<number | null> {
  try {
    const meta = await parseFile(absPath, { skipCovers: true, duration: true })
    const d = meta.format.duration
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
      console.info(LOG, 'probeMediaDurationSec', { sample: absPath.slice(-64), duration: d })
      return d
    }
  } catch (e) {
    console.info(LOG, 'probeMediaDurationSec failed', { sample: absPath.slice(-64), err: String(e).slice(0, 160) })
  }
  return null
}

/** yt-dlp `--write-info-json` / default sidecar: `Video.mp4.info.json` (sometimes `Video.info.json`). */
export async function readYtDlpInfoJsonTitle(mediaAbsPath: string): Promise<string | null> {
  const { title } = await readYtDlpInfoJsonScanFields(mediaAbsPath)
  return title
}

/** Display title + optional upload time for library scan rows (single sidecar read). */
export async function resolveLibraryScanMetadata(mediaAbsPath: string): Promise<{
  displayTitle: string
  uploadedAtMs: number | null
  duration: number | null
}> {
  const { title, uploadedAtMs, duration: jsonDuration } = await readYtDlpInfoJsonScanFields(mediaAbsPath)
  const displayTitle = title ?? humanizeRestrictFilename(basename(mediaAbsPath))
  let duration = jsonDuration
  if (duration == null) {
    duration = await probeMediaDurationSec(mediaAbsPath)
    console.info(LOG, 'resolveLibraryScanMetadata probed duration', {
      sample: mediaAbsPath.slice(-64),
      duration
    })
  }
  return { displayTitle, uploadedAtMs, duration }
}

/**
 * Library list label: yt-dlp `.info.json` `title` when present, else humanized restrict-filename stem.
 */
export async function resolveLibraryDisplayTitle(mediaAbsPath: string): Promise<string> {
  const { displayTitle } = await resolveLibraryScanMetadata(mediaAbsPath)
  return displayTitle
}

/** Normalize tag values from music-metadata (string, buffer, nested). */
function coerceTagString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const t = value.trim()
    return t.length > 0 ? t : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const t = String(value).trim()
    return t.length > 0 ? t : null
  }
  if (value instanceof Uint8Array) {
    const t = Buffer.from(value).toString('utf8').replace(/\0/g, '').trim()
    return t.length > 0 ? t : null
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = coerceTagString(v)
      if (s) return s
    }
    return null
  }
  if (typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
    return coerceTagString((value as { text?: unknown }).text)
  }
  return null
}

function pickFirstNonEmptyString(...candidates: Array<string | undefined | null>): string | null {
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    const t = c.trim()
    if (t.length > 0) return t
  }
  return null
}

/** Handler / stream names that are never user-facing titles (FFmpeg / QuickTime defaults). */
function isBoringStreamHandlerName(name: string): boolean {
  const t = name.trim()
  if (t.length < 2) return true
  if (/^VideoHandler$/i.test(t)) return true
  if (/^SoundHandler$/i.test(t)) return true
  if (/^SubtitleHandler$/i.test(t)) return true
  if (/^Timed\s*Text/i.test(t)) return true
  if (/^Data\s*Handler$/i.test(t)) return true
  if (/^ISO Media file produced by Google/i.test(t)) return true
  if (/^Google\s+Stream$/i.test(t)) return true
  if (/^Lavf[\d.]+$/i.test(t)) return true
  if (/^B\s*\d+\s*C\s*B\s*R\s*128k$/i.test(t)) return true
  return false
}

/** YouTube / ffmpeg often put the *filename* in `handler_name`; reject if it matches the file stem. */
function titleFromTrackInfo(
  trackInfo: Array<{ name?: string }> | undefined,
  mediaAbsPath: string
): string | null {
  if (!Array.isArray(trackInfo) || trackInfo.length === 0) return null
  for (const ti of trackInfo) {
    const n = typeof ti.name === 'string' ? ti.name.trim() : ''
    if (n.length === 0 || isBoringStreamHandlerName(n)) continue
    if (isLikelyFilesystemTemplateTitle(n, mediaAbsPath)) continue
    return n
  }
  return null
}

/** Unmapped or extra native tags (e.g. odd iTunes freeform keys) may still carry TITLE. */
function titleFromNative(meta: IAudioMetadata, mediaAbsPath: string): string | null {
  const native = meta.native
  if (!native || typeof native !== 'object') return null
  for (const tagList of Object.values(native)) {
    if (!Array.isArray(tagList)) continue
    for (const tag of tagList) {
      if (!tag || typeof tag.id !== 'string') continue
      const id = tag.id
      const idl = id.toLowerCase()
      const looksTitle =
        idl === 'title' ||
        idl === 'tit2' ||
        idl === '©nam' ||
        idl === '\xa9nam' ||
        idl === 'wm/title' ||
        idl.endsWith(':title') ||
        idl.includes('tracktitle')
      if (!looksTitle) continue
      const s = coerceTagString(tag.value)
      if (s && !isLikelyFilesystemTemplateTitle(s, mediaAbsPath)) return s
    }
  }
  return null
}

function pickTitleFromCommon(meta: IAudioMetadata, mediaAbsPath: string): string | null {
  const c = meta.common
  const raw = pickFirstNonEmptyString(
    typeof c.title === 'string' ? c.title : undefined,
    typeof c.work === 'string' ? c.work : undefined,
    Array.isArray(c.subtitle) && c.subtitle.length > 0 ? String(c.subtitle[0]) : undefined,
    typeof c.titlesort === 'string' ? c.titlesort : undefined
  )
  if (raw && !isLikelyFilesystemTemplateTitle(raw, mediaAbsPath)) return raw
  return null
}

function pickBestTitleFromMeta(meta: IAudioMetadata, mediaAbsPath: string): string | null {
  return (
    pickTitleFromCommon(meta, mediaAbsPath) ??
    titleFromNative(meta, mediaAbsPath) ??
    titleFromTrackInfo(meta.format.trackInfo, mediaAbsPath)
  )
}

type FfprobeJson = {
  format?: { tags?: Record<string, string> }
  streams?: Array<{ codec_type?: string; tags?: Record<string, string> }>
}

/** Any tag whose key suggests a title (ffprobe exposes mixed-case / vendor-prefixed keys). */
function titleFromAnyFfprobeTags(tags: Record<string, string> | undefined, mediaAbsPath: string): string | null {
  if (!tags || typeof tags !== 'object') return null
  const entries = Object.entries(tags)
  for (const [k, v] of entries) {
    if (typeof v !== 'string') continue
    const kl = k.toLowerCase()
    if (kl !== 'title' && !kl.includes('title')) continue
    const t = v.trim()
    if (t.length === 0 || isLikelyFilesystemTemplateTitle(t, mediaAbsPath)) continue
    return t
  }
  return null
}

/**
 * ffprobe reads the same tag surface as ffmpeg writes; PATH is augmented so GUI-launched Electron
 * still finds Homebrew binaries on macOS.
 */
async function readTitleViaFfprobe(absPath: string): Promise<string | null> {
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`
  }
  let stdout: string
  try {
    const r = await execFile(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', absPath],
      { env, timeout: 20_000, maxBuffer: 12 * 1024 * 1024 }
    )
    stdout = String(r.stdout)
  } catch (e) {
    console.info(LOG, 'readTitleViaFfprobe: not available or failed', { err: String(e).slice(0, 160) })
    return null
  }
  try {
    const j = JSON.parse(stdout) as FfprobeJson
    const fromFmt = titleFromAnyFfprobeTags(j.format?.tags, absPath)
    if (fromFmt) {
      console.info(LOG, 'readTitleViaFfprobe: format tags', { sample: absPath.slice(-64) })
      return fromFmt
    }
    const streams = j.streams
    if (Array.isArray(streams)) {
      for (const s of streams) {
        if (s.codec_type !== 'video') continue
        const hn = s.tags?.handler_name
        if (typeof hn !== 'string') continue
        const t = hn.trim()
        if (
          t.length > 0 &&
          !isBoringStreamHandlerName(t) &&
          !isLikelyFilesystemTemplateTitle(t, absPath)
        ) {
          console.info(LOG, 'readTitleViaFfprobe: stream handler_name', { sample: absPath.slice(-64) })
          return t
        }
      }
      for (const s of streams) {
        const st = titleFromAnyFfprobeTags(s.tags, absPath)
        if (st) return st
      }
    }
  } catch (e) {
    console.warn(LOG, 'readTitleViaFfprobe: json parse', String(e))
  }
  return null
}

/**
 * Best-effort display title: yt-dlp sidecar JSON (authoritative for many archives), then tags in the
 * media file (rejecting filename-like handler_name / ©nam copies).
 */
export async function readEmbeddedMediaTitle(absPath: string): Promise<string | null> {
  const fromJson = await readYtDlpInfoJsonTitle(absPath)
  if (fromJson) return fromJson

  try {
    const meta = await parseFile(absPath, { skipCovers: true })
    const fromMm = pickBestTitleFromMeta(meta, absPath)
    if (fromMm) {
      console.info(LOG, 'readEmbeddedMediaTitle (music-metadata)', {
        sample: absPath.slice(-64),
        titleLen: fromMm.length
      })
      return fromMm
    }
    console.info(LOG, 'readEmbeddedMediaTitle: music-metadata had no usable title', {
      sample: absPath.slice(-64)
    })
  } catch (e) {
    console.warn(LOG, 'readEmbeddedMediaTitle music-metadata failed', {
      sample: absPath.slice(-64),
      err: String(e)
    })
  }

  const fromFf = await readTitleViaFfprobe(absPath)
  if (fromFf) return fromFf
  return null
}
