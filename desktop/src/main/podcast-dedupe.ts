import { basename, dirname, extname, join, parse } from 'path'
import { promises as fs } from 'fs'
import { podcastReadableBasename } from '../../shared/ytdl-output-template'
import { LOG } from './constants'
import { ytDlpInfoJsonSidecarPaths } from './media-embedded-title'

/** Stem is only a full episode UUID (legacy id-only download template). */
const EPISODE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuidEpisodeBasename(fileName: string): boolean {
  const stem = fileName.replace(/\.[^/.]+$/, '')
  return EPISODE_UUID_RE.test(stem)
}

type ScanRow = {
  relPath: string
  mtimeMs: number
  size: number
  thumbRelPath: string | null
  displayTitle: string
  uploadedAtMs: number | null
}

type EpisodeSidecar = { title: string; id: string }

/** Read episode `id` + `title` from the `.info.json` beside a library media file. */
async function readEpisodeMetaBesideMedia(mediaAbsPath: string): Promise<EpisodeSidecar | null> {
  for (const p of ytDlpInfoJsonSidecarPaths(mediaAbsPath)) {
    try {
      const raw = await fs.readFile(p, 'utf8')
      const j = JSON.parse(raw) as Record<string, unknown>
      const id = typeof j.id === 'string' ? j.id.trim() : ''
      const title = typeof j.title === 'string' ? j.title.trim() : ''
      if (id.length > 0 && title.length > 0) return { id, title }
    } catch {
      /* missing or invalid */
    }
  }
  return null
}

export async function readEpisodeIdBesideMedia(mediaAbsPath: string): Promise<string | null> {
  const meta = await readEpisodeMetaBesideMedia(mediaAbsPath)
  return meta?.id ?? null
}

/**
 * Drop duplicate podcast rows for the same episode id in one feed folder.
 * Prefers readable title stems over legacy pure-uuid filenames.
 */
export async function dedupeLibraryScanByEpisodeId(
  dataRoot: string,
  rows: ScanRow[]
): Promise<ScanRow[]> {
  const podcastPrefix = 'videos/podcasts/'
  const byKey = new Map<string, ScanRow[]>()

  for (const row of rows) {
    if (!row.relPath.startsWith(podcastPrefix)) {
      byKey.set(`__other__\0${row.relPath}`, [row])
      continue
    }
    const abs = join(dataRoot, ...row.relPath.split('/'))
    const episodeId = await readEpisodeIdBesideMedia(abs)
    const folder = dirname(row.relPath)
    const key = episodeId ? `${folder}\0${episodeId}` : `__unique__\0${row.relPath}`
    const bucket = byKey.get(key) ?? []
    bucket.push(row)
    byKey.set(key, bucket)
  }

  const kept: ScanRow[] = []
  let dropped = 0
  for (const [, bucket] of byKey) {
    if (bucket.length === 1) {
      kept.push(bucket[0]!)
      continue
    }
    const readableRow = bucket.find((r) => !isUuidEpisodeBasename(basename(r.relPath)))
    const pick = readableRow ?? bucket.reduce((a, b) => (a.mtimeMs >= b.mtimeMs ? a : b))
    kept.push(pick)
    dropped += bucket.length - 1
    console.info(LOG, 'podcast dedupe: kept one of', bucket.length, {
      kept: pick.relPath,
      dropped: bucket.filter((r) => r !== pick).map((r) => r.relPath)
    })
  }

  if (dropped > 0) {
    console.info(LOG, 'podcast dedupe: dropped duplicate library rows', dropped)
  }
  return kept
}

const SIDECAR_EXTS = ['.mp3', '.m4a', '.opus', '.ogg', '.aac', '.png', '.jpg', '.jpeg', '.webp', '.info.json']

async function renameEpisodeStem(folderAbs: string, fromStem: string, toStem: string): Promise<string[]> {
  const renamed: string[] = []
  if (fromStem === toStem) return renamed
  for (const ext of SIDECAR_EXTS) {
    const from = join(folderAbs, `${fromStem}${ext}`)
    const to = join(folderAbs, `${toStem}${ext}`)
    try {
      await fs.access(from)
    } catch {
      continue
    }
    try {
      await fs.access(to)
      console.info(LOG, 'podcast migrate: target exists, skip rename', { from, to })
      continue
    } catch {
      /* ok to rename */
    }
    await fs.rename(from, to)
    renamed.push(to)
    console.info(LOG, 'podcast migrate: renamed', { from: basename(from), to: basename(to) })
  }
  return renamed
}

/**
 * Rename legacy `uuid.mp3` files to readable `Title_trunc_id8.mp3` using sidecar metadata.
 */
export async function migrateUuidPodcastFilesToReadable(folderAbs: string): Promise<string[]> {
  const changed: string[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(folderAbs)
  } catch (e) {
    console.warn(LOG, 'podcast migrate: readdir failed', folderAbs, e)
    return changed
  }

  for (const fileName of entries) {
    if (extname(fileName).toLowerCase() !== '.mp3') continue
    if (!isUuidEpisodeBasename(fileName)) continue
    const uuidAbs = join(folderAbs, fileName)
    const meta = await readEpisodeMetaBesideMedia(uuidAbs)
    if (!meta) continue
    const newStem = podcastReadableBasename(meta.title, meta.id)
    const renamed = await renameEpisodeStem(folderAbs, parse(fileName).name, newStem)
    changed.push(...renamed)
  }
  return changed
}

/**
 * Remove pure-uuid podcast files when a readable sibling exists for the same episode id.
 */
export async function cleanupLegacyPodcastDuplicatesInFolder(folderAbs: string): Promise<string[]> {
  const removed: string[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(folderAbs)
  } catch (e) {
    console.warn(LOG, 'podcast cleanup: readdir failed', folderAbs, e)
    return removed
  }

  const mp3s = entries.filter((n) => extname(n).toLowerCase() === '.mp3')
  const metaByMp3 = new Map<string, EpisodeSidecar | null>()
  for (const fileName of mp3s) {
    metaByMp3.set(fileName, await readEpisodeMetaBesideMedia(join(folderAbs, fileName)))
  }

  for (const fileName of mp3s) {
    if (!isUuidEpisodeBasename(fileName)) continue
    const meta = metaByMp3.get(fileName)
    if (!meta) continue
    const hasReadableSibling = mp3s.some((other) => {
      if (other === fileName || isUuidEpisodeBasename(other)) return false
      const otherMeta = metaByMp3.get(other)
      return otherMeta?.id === meta.id
    })
    if (!hasReadableSibling) continue

    const stem = parse(fileName).name
    for (const ext of SIDECAR_EXTS) {
      const target = join(folderAbs, `${stem}${ext}`)
      try {
        await fs.unlink(target)
        removed.push(target)
        console.info(LOG, 'podcast cleanup: removed uuid duplicate', target)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          console.warn(LOG, 'podcast cleanup: unlink failed', target, e)
        }
      }
    }
  }

  return removed
}
