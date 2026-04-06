import { basename, extname, join } from 'path'
import { watch, type FSWatcher } from 'fs'
import { mkdir } from 'fs/promises'

import { LOG, VIDEO_EXT } from './constants'

/** Coalesce bursts of fs events (merge + rename) into one library rescan. */
const DEBOUNCE_MS = 550

/** Avoid spamming main logs when yt-dlp writes many fragments. */
const EVENT_LOG_THROTTLE_MS = 5000

export type VideosLibraryWatchHandle = {
  /** Close watchers, clear debounce, flush optional pending tick is skipped (sync ending will full-scan). */
  stop: () => void
}

/**
 * Recursive watch on `dataRoot/videos` while sync runs. Emits debounced ticks when
 * plausible finished video paths change; renderer triggers `scanLibrary`.
 */
export function startVideosLibraryWatch(
  dataRoot: string,
  opts: { onTick: () => void }
): VideosLibraryWatchHandle {
  const videosPath = join(dataRoot, 'videos')
  let closed = false
  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let rawEventsSinceLog = 0
  let lastThrottleLog = 0

  const flushTick = (): void => {
    console.info(LOG, 'videos watch: debounced tick → sync:libraryStale')
    opts.onTick()
  }

  const scheduleTick = (): void => {
    if (closed) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (closed) return
      flushTick()
    }, DEBOUNCE_MS)
  }

  const onFsEvent = (eventType: string, filename: string | Buffer | null): void => {
    if (closed) return
    const name = filename != null ? String(filename) : null
    if (!name) {
      scheduleTick()
      return
    }
    const norm = name.replace(/\\/g, '/')
    const base = basename(norm)
    if (base.includes('.part') || base.includes('.ytdl')) {
      return
    }
    const ext = extname(base).toLowerCase()
    if (ext && !VIDEO_EXT.has(ext)) {
      return
    }
    rawEventsSinceLog++
    const now = Date.now()
    if (now - lastThrottleLog >= EVENT_LOG_THROTTLE_MS) {
      console.info(LOG, 'videos watch: fs activity (throttled summary)', {
        rawEventsSinceLog,
        lastEventType: eventType,
        sample: norm.slice(0, 120)
      })
      rawEventsSinceLog = 0
      lastThrottleLog = now
    }
    scheduleTick()
  }

  void (async (): Promise<void> => {
    try {
      await mkdir(videosPath, { recursive: true })
    } catch (e) {
      console.warn(LOG, 'videos watch: mkdir videos failed', e)
    }
    if (closed) return
    try {
      watcher = watch(videosPath, { recursive: true }, (evt, fname) => onFsEvent(evt, fname))
      watcher.on('error', (err) => {
        console.error(LOG, 'videos watch: watcher error', err)
      })
      console.info(LOG, 'videos watch: started', { videosPath })
    } catch (e) {
      console.error(LOG, 'videos watch: failed to start', e)
    }
  })()

  return {
    stop(): void {
      closed = true
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (watcher) {
        watcher.close()
        watcher = null
        console.info(LOG, 'videos watch: stopped', { videosPath })
      }
    }
  }
}
