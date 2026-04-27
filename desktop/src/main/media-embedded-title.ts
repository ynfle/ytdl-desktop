import { execFile as execFileCb } from 'child_process'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import type { IAudioMetadata } from 'music-metadata'
import { parseFile } from 'music-metadata'
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

/** yt-dlp `--write-info-json` / default sidecar: `Video.mp4.info.json` (sometimes `Video.info.json`). */
async function readTitleFromYtDlpInfoJson(mediaAbsPath: string): Promise<string | null> {
  for (const p of ytDlpInfoJsonSidecarPaths(mediaAbsPath)) {
    try {
      const raw = await fs.readFile(p, 'utf8')
      const j = JSON.parse(raw) as { title?: unknown }
      if (typeof j.title !== 'string') continue
      const t = j.title.trim()
      if (t.length === 0) continue
      if (isLikelyFilesystemTemplateTitle(t, mediaAbsPath)) continue
      console.info(LOG, 'readTitleFromYtDlpInfoJson', { json: p.slice(-80), titleLen: t.length })
      return t
    } catch {
      /* missing or invalid */
    }
  }
  return null
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
  const fromJson = await readTitleFromYtDlpInfoJson(absPath)
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
