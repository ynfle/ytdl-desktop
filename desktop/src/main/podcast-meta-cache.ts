import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { PodcastInfoRow } from '../../shared/ytdl-api'
import { folderIdFromFeedUrl } from './podcast-input'

const CACHE_VERSION = 1 as const
const CACHE_FILENAME = 'podcast-display-cache.json'

export type PodcastMetaStored = {
  folderId: string
  displayName: string | null
  feedPageUrl: string | null
  error: string | null
  updatedAt: number
  logoSourceUrl?: string | null
}

export type PodcastMetaCacheFile = {
  v: typeof CACHE_VERSION
  /** Key: resolved absolute data root path. */
  roots: Record<string, Record<string, PodcastMetaStored>>
}

function cacheFilePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

export async function loadPodcastMetaCache(): Promise<PodcastMetaCacheFile> {
  try {
    const raw = await fs.readFile(cacheFilePath(), 'utf-8')
    const j = JSON.parse(raw) as PodcastMetaCacheFile
    if (j.v !== CACHE_VERSION || typeof j.roots !== 'object' || j.roots === null) {
      return { v: CACHE_VERSION, roots: {} }
    }
    return j
  } catch {
    return { v: CACHE_VERSION, roots: {} }
  }
}

export async function savePodcastMetaCache(data: PodcastMetaCacheFile): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(cacheFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  console.info('[ytdl-podcast-cache] wrote', cacheFilePath())
}

export function getPodcastCachedEntry(
  cache: PodcastMetaCacheFile,
  dataRootResolved: string,
  feedUrl: string,
  ttlMs: number,
  force: boolean
): PodcastMetaStored | null {
  if (force) return null
  const bucket = cache.roots[dataRootResolved]
  if (!bucket) return null
  const e = bucket[feedUrl]
  if (!e || typeof e.updatedAt !== 'number') return null
  if (Date.now() - e.updatedAt > ttlMs) return null
  return e
}

export function podcastStoredToRow(feedUrl: string, s: PodcastMetaStored): PodcastInfoRow {
  return {
    feedUrl,
    folderId: s.folderId || folderIdFromFeedUrl(feedUrl),
    displayName: s.displayName,
    feedPageUrl: s.feedPageUrl,
    error: s.error,
    logoUrl: null
  }
}

export function upsertPodcastMeta(
  cache: PodcastMetaCacheFile,
  dataRootResolved: string,
  feedUrl: string,
  row: PodcastInfoRow,
  logoSourceUrl?: string | null
): void {
  if (!cache.roots[dataRootResolved]) cache.roots[dataRootResolved] = {}
  const bucket = cache.roots[dataRootResolved]
  const prev = bucket[feedUrl]
  const nextLogo =
    logoSourceUrl === undefined ? (prev?.logoSourceUrl ?? null) : logoSourceUrl
  bucket[feedUrl] = {
    folderId: row.folderId,
    displayName: row.displayName,
    feedPageUrl: row.feedPageUrl,
    error: row.error,
    updatedAt: Date.now(),
    logoSourceUrl: nextLogo
  }
}
