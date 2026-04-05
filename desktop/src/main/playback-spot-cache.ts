import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { PlaybackSpotPatch, PlaybackSpotSession, PlaybackSpotSnapshot } from '../../shared/ytdl-api'

/** File schema version for migrations. */
const CACHE_VERSION = 1 as const
const FILENAME = 'playback-spot.json'

const LOG = '[ytdl-playback-spot]'

export type PlaybackSpotFile = {
  v: typeof CACHE_VERSION
  /** Key: resolved absolute data root. */
  roots: Record<string, PlaybackSpotSnapshot>
}

function filePath(): string {
  return join(app.getPath('userData'), FILENAME)
}

function defaultSession(): PlaybackSpotSession {
  return {
    queue: [],
    playlist: [],
    cursor: 0,
    currentRel: null,
    playing: false
  }
}

function emptySnapshot(): PlaybackSpotSnapshot {
  return { positions: {}, session: defaultSession() }
}

/** Serialize writes so concurrent patches do not interleave read-modify-write. */
let writeChain: Promise<void> = Promise.resolve()

export async function loadPlaybackSpotForRoot(dataRootResolved: string): Promise<PlaybackSpotSnapshot> {
  try {
    const raw = await fs.readFile(filePath(), 'utf-8')
    const j = JSON.parse(raw) as PlaybackSpotFile
    if (j.v !== CACHE_VERSION || typeof j.roots !== 'object' || j.roots === null) {
      console.info(LOG, 'load: invalid schema, using empty')
      return emptySnapshot()
    }
    const bucket = j.roots[dataRootResolved]
    if (!bucket || typeof bucket.positions !== 'object' || !bucket.session) {
      return emptySnapshot()
    }
    const session = { ...defaultSession(), ...bucket.session }
    console.info(LOG, 'load', { root: dataRootResolved, positions: Object.keys(bucket.positions).length })
    return {
      positions: { ...bucket.positions },
      session
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      console.warn(LOG, 'load failed, backing up if possible', e)
      try {
        const bad = filePath()
        const bak = `${bad}.corrupt-${Date.now()}.bak`
        await fs.rename(bad, bak)
        console.info(LOG, 'renamed corrupt file to', bak)
      } catch {
        /* ignore */
      }
    }
    return emptySnapshot()
  }
}

function mergeSnapshot(prev: PlaybackSpotSnapshot, patch: PlaybackSpotPatch): PlaybackSpotSnapshot {
  const positions = { ...prev.positions }
  if (patch.positionUpdates) {
    for (const [rel, val] of Object.entries(patch.positionUpdates)) {
      if (val === null) {
        delete positions[rel]
      } else {
        positions[rel] = {
          currentTime: val.currentTime,
          updatedAt: Date.now()
        }
      }
    }
  }
  const session = patch.session !== undefined ? { ...defaultSession(), ...patch.session } : prev.session
  return { positions, session }
}

async function writeFileAtomic(absPath: string, data: string): Promise<void> {
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, data, 'utf-8')
  await fs.rename(tmp, absPath)
}

/**
 * Read latest file from disk, merge patch, write. Callers are serialized via `writeChain`.
 */
async function mergeAndPersist(dataRootResolved: string, patch: PlaybackSpotPatch): Promise<void> {
  let file: PlaybackSpotFile = { v: CACHE_VERSION, roots: {} }
  try {
    const raw = await fs.readFile(filePath(), 'utf-8')
    const j = JSON.parse(raw) as PlaybackSpotFile
    if (j.v === CACHE_VERSION && typeof j.roots === 'object' && j.roots !== null) {
      file = j
    }
  } catch {
    /* start fresh roots */
  }
  const prevBucket = file.roots[dataRootResolved] ?? emptySnapshot()
  const nextBucket = mergeSnapshot(prevBucket, patch)
  file.roots[dataRootResolved] = nextBucket
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await writeFileAtomic(filePath(), JSON.stringify(file, null, 2))
  console.info(LOG, 'saved', {
    root: dataRootResolved,
    positionKeys: Object.keys(nextBucket.positions).length,
    sessionPlaylistLen: nextBucket.session.playlist.length
  })
}

export function patchPlaybackSpot(dataRootResolved: string, patch: PlaybackSpotPatch): Promise<void> {
  writeChain = writeChain
    .then(() => mergeAndPersist(dataRootResolved, patch))
    .catch((e) => console.error(LOG, 'patch failed', e))
  return writeChain
}
