import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { ChannelInfoRow } from '../../shared/ytdl-api'
import { DISPLAY_META_TTL_MS } from './constants'

/** @deprecated Prefer `DISPLAY_META_TTL_MS` from `./constants` — same value. */
export const CHANNEL_META_TTL_MS = DISPLAY_META_TTL_MS

const CACHE_VERSION = 1 as const
const CACHE_FILENAME = 'channel-display-cache.json'

export type ChannelMetaStored = {
  displayName: string | null
  channelPageUrl: string | null
  videosUrl: string
  error: string | null
  updatedAt: number
  /** Remote avatar URL last fetched (yt3); used to re-download if the local file is missing. */
  logoSourceUrl?: string | null
}

export type ChannelMetaCacheFile = {
  v: typeof CACHE_VERSION
  /** Key: resolved absolute data root path. */
  roots: Record<string, Record<string, ChannelMetaStored>>
}

function cacheFilePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

export async function loadChannelMetaCache(): Promise<ChannelMetaCacheFile> {
  try {
    const raw = await fs.readFile(cacheFilePath(), 'utf-8')
    const j = JSON.parse(raw) as ChannelMetaCacheFile
    if (j.v !== CACHE_VERSION || typeof j.roots !== 'object' || j.roots === null) {
      return { v: CACHE_VERSION, roots: {} }
    }
    return j
  } catch {
    return { v: CACHE_VERSION, roots: {} }
  }
}

export async function saveChannelMetaCache(data: ChannelMetaCacheFile): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(cacheFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  console.info('[ytdl-channel-cache] wrote', cacheFilePath())
}

export function getCachedEntry(
  cache: ChannelMetaCacheFile,
  dataRootResolved: string,
  identifier: string,
  ttlMs: number,
  force: boolean
): ChannelMetaStored | null {
  if (force) return null
  const bucket = cache.roots[dataRootResolved]
  if (!bucket) return null
  const e = bucket[identifier]
  if (!e || typeof e.updatedAt !== 'number') return null
  if (Date.now() - e.updatedAt > ttlMs) return null
  return e
}

export function storedToRow(identifier: string, s: ChannelMetaStored): ChannelInfoRow {
  return {
    identifier,
    videosUrl: s.videosUrl,
    displayName: s.displayName,
    channelPageUrl: s.channelPageUrl,
    error: s.error,
    /** Filled in main after checking disk + loopback server. */
    logoUrl: null
  }
}

export function upsertChannelMeta(
  cache: ChannelMetaCacheFile,
  dataRootResolved: string,
  identifier: string,
  row: ChannelInfoRow,
  /** New remote logo URL; omit to keep previous `logoSourceUrl` in the cache entry. */
  logoSourceUrl?: string | null
): void {
  if (!cache.roots[dataRootResolved]) cache.roots[dataRootResolved] = {}
  const bucket = cache.roots[dataRootResolved]
  const prev = bucket[identifier]
  const nextLogo =
    logoSourceUrl === undefined ? (prev?.logoSourceUrl ?? null) : logoSourceUrl
  bucket[identifier] = {
    displayName: row.displayName,
    channelPageUrl: row.channelPageUrl,
    videosUrl: row.videosUrl,
    error: row.error,
    updatedAt: Date.now(),
    logoSourceUrl: nextLogo
  }
}
