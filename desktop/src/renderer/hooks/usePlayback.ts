import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FloatingPlayerSyncPayload,
  LibraryVideo,
  PlaybackSpotSnapshot,
  PodcastInfoRow
} from '../../../shared/ytdl-api'
import { mountDocumentPipChrome } from '../lib/documentPipChrome'
import { parseLibraryRelPath } from './useLibrary'

/** Near-end threshold: drop saved resume so "finished" does not reopen mid-credits. */
const RESUME_MAX_FRACTION = 0.95

/** Cap disk writes during continuous playback (timeupdate / floating sync); pause/seek still flush immediately. */
const POSITION_DISK_SAVE_INTERVAL_MS = 1000

/** OS media keys / Now Playing seek step (matches document PiP ± buttons). */
const MEDIA_SESSION_SEEK_SEC = 10

/**
 * Document Picture-in-Picture (`documentPictureInPicture.requestWindow`) is not reliably
 * implemented in Electron: the promise can resolve while no usable floating window appears,
 * so we would never fall back to native video PiP. Use HTMLVideoElement PiP instead.
 * @see https://github.com/electron/electron/issues/39633
 */
function shouldUseNativePictureInPictureOnly(): boolean {
  return typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent)
}

/**
 * Episode sidecar thumb (loopback) first, then podcast show cover for `videos/podcasts/…` paths.
 * Used when opening the Electron floating player so artwork matches the track before React re-renders.
 */
async function resolveFloatingArtworkUrl(
  rel: string,
  library: LibraryVideo[],
  podcastRows: PodcastInfoRow[]
): Promise<string | null> {
  const entry = library.find((v) => v.relPath === rel)
  if (entry?.thumbRelPath) {
    const r = await window.ytdl.mediaUrl(entry.thumbRelPath)
    if (r.ok && r.url) {
      console.info('[usePlayback] floating artwork: using episode sidecar thumb', {
        rel,
        thumbRelPath: entry.thumbRelPath
      })
      return r.url
    }
    console.warn('[usePlayback] floating artwork: thumb mediaUrl failed', {
      thumbRelPath: entry.thumbRelPath,
      error: r.ok ? undefined : r.error
    })
  }
  const { groupKey, channelFolder } = parseLibraryRelPath(rel)
  if (groupKey.startsWith('podcast/')) {
    const logo = podcastRows.find((row) => row.folderId === channelFolder)?.logoUrl ?? null
    if (logo) {
      console.info('[usePlayback] floating artwork: using podcast show logo', { folderId: channelFolder })
    } else {
      console.info('[usePlayback] floating artwork: no podcast logo for folder', channelFolder)
    }
    return logo
  }
  return null
}

/**
 * Without {@link MediaSession#setPositionState}, macOS Control Center / media keys often
 * ignore seek actions for HTML media. Call after metadata load and periodically on timeupdate.
 */
function pushMediaSessionPositionState(el: HTMLVideoElement): void {
  if (!('mediaSession' in navigator)) return
  const dur = el.duration
  if (!Number.isFinite(dur) || dur <= 0) return
  try {
    const pos = Math.min(dur, Math.max(0, el.currentTime))
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: el.playbackRate,
      position: pos
    })
  } catch (e) {
    console.warn('[usePlayback] mediaSession.setPositionState', e)
  }
}

/**
 * Skip media shortcuts when focus is in a text field so we do not steal keys from typing.
 * Range/checkbox-style inputs are treated as non-text so transport shortcuts still work.
 */
function isKeyboardTargetEditable(target: EventTarget | null): boolean {
  if (target == null || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) {
    console.log('[usePlayback] keyboard media shortcut skipped (contenteditable)')
    return true
  }
  const inputLike = target.closest('input, textarea, select')
  if (!inputLike) return false
  if (inputLike instanceof HTMLInputElement) {
    const t = inputLike.type
    if (
      t === 'button' ||
      t === 'checkbox' ||
      t === 'radio' ||
      t === 'range' ||
      t === 'file' ||
      t === 'hidden' ||
      t === 'color' ||
      t === 'reset' ||
      t === 'submit'
    ) {
      return false
    }
  }
  console.log('[usePlayback] keyboard media shortcut skipped (form field focused)')
  return true
}

/**
 * Filter autoplay list to paths still on disk; if the track at savedCursor is gone,
 * skip forward then fall back to first valid entry.
 */
function reconcilePlaylist(
  savedPlaylist: string[],
  savedCursor: number,
  valid: Set<string>
): { playlist: string[]; cursor: number; currentRel: string | null } {
  if (savedPlaylist.length === 0) return { playlist: [], cursor: 0, currentRel: null }
  let targetRel: string | null = null
  const at =
    savedCursor >= 0 && savedCursor < savedPlaylist.length ? savedPlaylist[savedCursor]! : null
  if (at && valid.has(at)) {
    targetRel = at
  } else {
    for (let i = savedCursor + 1; i < savedPlaylist.length; i++) {
      if (valid.has(savedPlaylist[i]!)) { targetRel = savedPlaylist[i]!; break }
    }
    if (!targetRel) {
      for (const r of savedPlaylist) {
        if (valid.has(r)) { targetRel = r; break }
      }
    }
  }
  const filtered = savedPlaylist.filter((p) => valid.has(p))
  if (filtered.length === 0 || !targetRel) return { playlist: [], cursor: 0, currentRel: null }
  const cursor = Math.max(0, filtered.indexOf(targetRel))
  return { playlist: filtered, cursor, currentRel: targetRel }
}

/** Clamp saved explicit-queue boundary into a valid playlist index. */
function clampExplicitStartIndex(n: number, playlistLen: number): number {
  if (!Number.isFinite(n)) return playlistLen
  return Math.max(0, Math.min(playlistLen, Math.round(n)))
}

/** Core playback state: video ref, playlist, cursor, resume positions, persistence. */
export function usePlayback(
  appendLog: (chunk: string) => void,
  library: LibraryVideo[],
  allowSpotSaveRef: React.MutableRefObject<boolean>,
  podcastRows: PodcastInfoRow[]
) {
  /** Latest library / podcast metadata for IPC helpers (avoid stale closures in playRel). */
  const libraryRef = useRef(library)
  libraryRef.current = library
  const podcastRowsRef = useRef(podcastRows)
  podcastRowsRef.current = podcastRows
  /**
   * Pre-play staging when `playlist` is still empty (single-click add from library before Play).
   * Once a session has a playlist, further idle adds append on `playlist` instead.
   */
  const [stagingQueue, setStagingQueue] = useState<string[]>([])
  const [playlist, setPlaylist] = useState<string[]>([])
  /** First playlist index of user-queued tail; library “Up next” is strictly before this. */
  const [explicitStartIndex, setExplicitStartIndex] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  /** Mirrors {@link playing} for delete / IPC handlers that must not capture stale render state. */
  const playingRef = useRef(false)
  const [currentRel, setCurrentRel] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playlistRef = useRef<string[]>([])
  const cursorRef = useRef(0)
  const explicitStartIndexRef = useRef(0)
  const stagingQueueRef = useRef<string[]>([])
  const currentRelRef = useRef<string | null>(null)
  const positionsRef = useRef<Record<string, number>>({})
  /** Wall time of last `patchPlaybackSpot` for resume position (throttle during play). */
  const lastSpotDiskWriteAtRef = useRef(0)
  /** Single trailing timer so the latest `t` is written at most one interval after the last disk write. */
  const spotTrailingSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingResumeRelRef = useRef<string | null>(null)
  const pendingResumeTimeRef = useRef(0)

  /** Document PiP: parent node in the main document to restore {@link videoRef} into. */
  const docPipSlotParentRef = useRef<HTMLElement | null>(null)
  /** Unmount listeners installed by {@link mountDocumentPipChrome}. */
  const docPipUnmountRef = useRef<(() => void) | null>(null)
  /** Registered on `documentPictureInPicture` so we can remove it during sync teardown. */
  const docPipLeaveHandlerRef = useRef<(() => void) | null>(null)
  /** True while the video lives in a Document Picture-in-Picture window (not native video PiP). */
  const [documentPipActive, setDocumentPipActive] = useState(false)
  /** Electron: always-on-top floating window with seek controls (replaces non-customizable OS video PiP). */
  const [floatingPlayerActive, setFloatingPlayerActive] = useState(false)
  const floatingPlayerActiveRef = useRef(false)
  /** Live timeline from floating `<video>` (main element stays paused at handoff time). */
  const [floatingSync, setFloatingSync] = useState<FloatingPlayerSyncPayload | null>(null)
  /** Latest sync for skip-next resume flush (refs avoid stale closures in callbacks). */
  const floatingSyncRef = useRef<FloatingPlayerSyncPayload | null>(null)
  /** When true, ignore `resumePlaying` from the floating window (e.g. main Stop cleared playback). */
  const suppressFloatingResumeRef = useRef(false)
  /**
   * After the floating PiP `<video>` fires `ended`, we advance the playlist and reload the same
   * BrowserWindow with the next file. While that happens, {@link currentRel} changes — skip the
   * usual "close floating player on track change" effect so the window is not torn down twice.
   */
  const pendingFloatingReopenRef = useRef(false)
  /**
   * When both `navigator.mediaSession` and `keydown` deliver the same physical Next key in one
   * frame, advance the playlist only once.
   */
  const skipNextCoalesceFrameRef = useRef(false)
  /**
   * Monotonic id for each {@link playRel} load. Stale `loadedmetadata` handlers from an
   * earlier in-flight `playRel` (user switched files before the prior load finished) must
   * not seek or call `play()` — they would apply the previous file's resume to the new src.
   */
  const playRelGenerationRef = useRef(0)
  /**
   * Latest rel path passed to {@link playRel}. {@link playRel} awaits `mediaUrl` — if the user
   * switches tracks while that promise is in flight, a slower response must not assign `v.src`
   * or `setCurrentRel` (that used to leave the new file playing at the old file's timeline).
   */
  const latestPlayRelRequestRef = useRef<string | null>(null)
  /** Same ordering guard as {@link latestPlayRelRequestRef} for paused preview loads. */
  const latestPreviewRelRequestRef = useRef<string | null>(null)
  useEffect(() => {
    floatingPlayerActiveRef.current = floatingPlayerActive
  }, [floatingPlayerActive])

  useEffect(() => {
    floatingSyncRef.current = floatingSync
  }, [floatingSync])

  /* Keep refs in sync */
  useEffect(() => { playlistRef.current = playlist }, [playlist])
  useEffect(() => { cursorRef.current = cursor }, [cursor])
  useEffect(() => { currentRelRef.current = currentRel }, [currentRel])
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    explicitStartIndexRef.current = explicitStartIndex
  }, [explicitStartIndex])

  useEffect(() => {
    stagingQueueRef.current = stagingQueue
  }, [stagingQueue])

  /** Restore session from a hydrated snapshot (called once per data-root). */
  const restoreFromSnapshot = useCallback(
    (snapshot: PlaybackSpotSnapshot, validPaths: Set<string>) => {
      const { playlist: pl, cursor: cur, currentRel: cr } = reconcilePlaylist(
        snapshot.session.playlist,
        snapshot.session.cursor,
        validPaths
      )
      positionsRef.current = Object.fromEntries(
        Object.entries(snapshot.positions)
          .filter(([k]) => validPaths.has(k))
          .map(([k, v]) => [k, v.currentTime])
      )
      const rawEs = snapshot.session.explicitStartIndex
      let nextEs =
        typeof rawEs === 'number' && Number.isFinite(rawEs)
          ? clampExplicitStartIndex(rawEs, pl.length)
          : pl.length
      /** Legacy files: no explicit boundary — entire playlist is library/autoplay context. */
      if (rawEs == null) {
        nextEs = pl.length
        console.log('[usePlayback] restore: legacy session — explicitStartIndex := playlist.length', {
          plLen: pl.length
        })
      }
      setStagingQueue([])
      setPlaylist(pl)
      setCursor(cur)
      setExplicitStartIndex(nextEs)
      setCurrentRel(cr)
      setPlaying(false)
      console.log('[usePlayback] restored session from snapshot', {
        positionKeys: Object.keys(positionsRef.current).length,
        explicitStartIndex: nextEs
      })
      appendLog('[ui] playback spot restored from disk\n')
    },
    [appendLog]
  )

  /**
   * Merge resume times from disk into memory without replacing queue/session.
   * Used after rescans and when the same data root was already hydrated.
   */
  const mergePositionsFromSnapshot = useCallback(
    (snapshot: PlaybackSpotSnapshot, validRelPaths?: Set<string>) => {
      const fromDisk = Object.fromEntries(
        Object.entries(snapshot.positions)
          .filter(([k]) => !validRelPaths || validRelPaths.has(k))
          .map(([k, v]) => [k, v.currentTime])
      )
      positionsRef.current = { ...positionsRef.current, ...fromDisk }
      console.log('[usePlayback] merged resume positions from disk', {
        mergedKeys: Object.keys(fromDisk).length,
        totalKeys: Object.keys(positionsRef.current).length,
        filtered: Boolean(validRelPaths)
      })
    },
    []
  )

  /** Load and play a specific relPath. */
  const playRel = useCallback(
    async (relPath: string) => {
      latestPlayRelRequestRef.current = relPath
      const v = videoRef.current
      const r = await window.ytdl.mediaUrl(relPath)
      if (latestPlayRelRequestRef.current !== relPath) {
        console.info('[usePlayback] playRel mediaUrl result ignored (newer track requested)', {
          relPath,
          latest: latestPlayRelRequestRef.current
        })
        return
      }
      if (!r.ok || !r.url) {
        if (pendingFloatingReopenRef.current) {
          pendingFloatingReopenRef.current = false
          setFloatingPlayerActive(false)
          console.warn('[usePlayback] floating PiP advance: mediaUrl failed, clearing pending reopen')
        }
        appendLog(`[ui] mediaUrl failed: ${r.error}\n`)
        return
      }
      const resume = positionsRef.current[relPath]
      console.log(`[usePlayback] playing: ${relPath}`, { resumeSec: resume ?? null })
      currentRelRef.current = relPath
      setCurrentRel(relPath)
      if (v) {
        playRelGenerationRef.current += 1
        const loadGen = playRelGenerationRef.current
        v.src = r.url
        const onMeta = (): void => {
          v.removeEventListener('loadedmetadata', onMeta)
          if (loadGen !== playRelGenerationRef.current) {
            console.info('[usePlayback] ignoring stale loadedmetadata after newer playRel', {
              relPath,
              loadGen,
              currentGen: playRelGenerationRef.current
            })
            return
          }
          const dur = v.duration
          const shouldResume =
            resume != null &&
            dur > 0 &&
            !Number.isNaN(dur) &&
            resume < dur * RESUME_MAX_FRACTION
          if (shouldResume) {
            v.currentTime = Math.min(resume, dur * 0.999)
          } else {
            try {
              v.currentTime = 0
            } catch (e) {
              console.warn('[usePlayback] could not reset currentTime after track change', e)
            }
          }
          /** Continuation: floating window already closed on `ended`; hand next track back to PiP. */
          if (pendingFloatingReopenRef.current && shouldUseNativePictureInPictureOnly()) {
            pendingFloatingReopenRef.current = false
            v.pause()
            const url = v.currentSrc || v.src
            if (!url) {
              appendLog('[ui] floating PiP advance: no media URL on main element\n')
              setFloatingPlayerActive(false)
              void v.play().catch((e) => appendLog(`[ui] play error: ${String(e)}\n`))
              return
            }
            console.log('[usePlayback] floating PiP: loading next track into floating window', {
              relPath,
              urlSample: url.slice(0, 80)
            })
            void (async (): Promise<void> => {
              const artworkUrl = await resolveFloatingArtworkUrl(
                relPath,
                libraryRef.current,
                podcastRowsRef.current
              )
              try {
                const openR = await window.ytdl.openFloatingPlayer({
                  url,
                  currentTime: v.currentTime,
                  volume: v.volume,
                  playing: true,
                  artworkUrl,
                  reuseExisting: true
                })
                if (!openR || typeof openR !== 'object' || !('ok' in openR) || !openR.ok) {
                  const err =
                    openR && typeof openR === 'object' && 'error' in openR && typeof openR.error === 'string'
                      ? openR.error
                      : 'failed'
                  appendLog(`[ui] floating player (next track): ${err}\n`)
                  setFloatingPlayerActive(false)
                  void v.play().catch((e) => appendLog(`[ui] play error: ${String(e)}\n`))
                  return
                }
                setFloatingSync(null)
                setFloatingPlayerActive(true)
                console.log('[usePlayback] floating PiP next track window ready', {
                  hasArtwork: Boolean(artworkUrl)
                })
              } catch (e) {
                appendLog(`[ui] floating player IPC (next track): ${String(e)}\n`)
                console.error('[usePlayback] openFloatingPlayer after advance threw', e)
                setFloatingPlayerActive(false)
                void v.play().catch((err) => appendLog(`[ui] play error: ${String(err)}\n`))
              }
            })()
            return
          }
          void v.play().catch((e) => appendLog(`[ui] play error: ${String(e)}\n`))
        }
        v.addEventListener('loadedmetadata', onMeta)
      }
    },
    [appendLog]
  )

  /**
   * Path at `cursor` while playing. Depends on the **active rel string**, not `playlist` array identity,
   * so tail-only queue edits / other `setPlaylist` clones do not re-run {@link playRel} and unmute the main `<video>` under floating PiP.
   */
  const activePlaylistRel: string | null =
    playing && playlist.length > 0 && cursor >= 0 && cursor < playlist.length
      ? (playlist[cursor] ?? null)
      : null

  /** Load the track at cursor when the active path changes. */
  useEffect(() => {
    if (!activePlaylistRel) return
    console.log('[usePlayback] load track at cursor (activePlaylistRel changed)', {
      rel: activePlaylistRel
    })
    void playRel(activePlaylistRel)
  }, [activePlaylistRel, playRel])

  /* ── Position persistence helpers ── */

  const flushPositionNow = useCallback((rel: string, t: number) => {
    if (!allowSpotSaveRef.current || t < 0.5) return
    if (spotTrailingSaveTimerRef.current) {
      clearTimeout(spotTrailingSaveTimerRef.current)
      spotTrailingSaveTimerRef.current = null
    }
    positionsRef.current[rel] = t
    lastSpotDiskWriteAtRef.current = Date.now()
    void window.ytdl.patchPlaybackSpot({ positionUpdates: { [rel]: { currentTime: t } } })
    console.log('[usePlayback] resume position flush (immediate)', { rel, t })
  }, [allowSpotSaveRef])

  /** During play: persist at most once per {@link POSITION_DISK_SAVE_INTERVAL_MS}; always keep memory fresh. */
  const schedulePositionSave = useCallback(
    (rel: string, t: number) => {
      if (!allowSpotSaveRef.current || t < 0.5) return
      positionsRef.current[rel] = t
      pendingResumeRelRef.current = rel
      pendingResumeTimeRef.current = t
      const now = Date.now()
      const since = now - lastSpotDiskWriteAtRef.current
      if (since >= POSITION_DISK_SAVE_INTERVAL_MS) {
        if (spotTrailingSaveTimerRef.current) {
          clearTimeout(spotTrailingSaveTimerRef.current)
          spotTrailingSaveTimerRef.current = null
        }
        lastSpotDiskWriteAtRef.current = now
        void window.ytdl.patchPlaybackSpot({ positionUpdates: { [rel]: { currentTime: t } } })
        console.debug('[usePlayback] resume position persisted (throttle slot)', { rel, t })
        return
      }
      if (spotTrailingSaveTimerRef.current) return
      const delay = POSITION_DISK_SAVE_INTERVAL_MS - since
      spotTrailingSaveTimerRef.current = setTimeout(() => {
        spotTrailingSaveTimerRef.current = null
        const r = pendingResumeRelRef.current
        const tt = pendingResumeTimeRef.current
        if (!r || !allowSpotSaveRef.current) return
        lastSpotDiskWriteAtRef.current = Date.now()
        void window.ytdl.patchPlaybackSpot({ positionUpdates: { [r]: { currentTime: tt } } })
        console.debug('[usePlayback] resume position persisted (throttle trailing)', { rel: r, t: tt })
      }, delay)
    },
    [allowSpotSaveRef]
  )

  useEffect(
    () => () => {
      if (spotTrailingSaveTimerRef.current) {
        clearTimeout(spotTrailingSaveTimerRef.current)
        spotTrailingSaveTimerRef.current = null
      }
    },
    []
  )

  /* ── Video event handlers ── */

  /**
   * Clear resume spot for the finished file and move to the next playlist entry.
   * @returns false if the playlist is exhausted
   */
  const advanceAfterEnded = useCallback((): boolean => {
    const pl = playlistRef.current
    const i = cursorRef.current
    const endedRel = pl[i]
    if (endedRel) {
      delete positionsRef.current[endedRel]
      if (allowSpotSaveRef.current) {
        void window.ytdl.patchPlaybackSpot({ positionUpdates: { [endedRel]: null } })
      }
    }
    const next = i + 1
    if (next >= pl.length) {
      appendLog('[ui] playlist finished\n')
      setPlaying(false)
      return false
    }
    setCursor(next)
    return true
  }, [appendLog, allowSpotSaveRef])

  const onVideoEnded = useCallback(() => {
    advanceAfterEnded()
  }, [advanceAfterEnded])

  const onVideoError = useCallback(() => {
    const v = videoRef.current
    const err = v?.error
    if (!err) { appendLog('[ui] video error (no MediaError details)\n'); return }
    const names = ['', 'ABORTED', 'NETWORK', 'DECODE', 'SRC_NOT_SUPPORTED'] as const
    const label = names[err.code] ?? `CODE_${err.code}`
    appendLog(`[ui] video error ${label} message=${err.message} currentSrc=${v.currentSrc || '—'}\n`)
  }, [appendLog])

  const onVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current
    const rel = currentRelRef.current
    if (!v || !rel || !allowSpotSaveRef.current) return
    const dur = v.duration
    if (dur > 0 && !Number.isNaN(dur) && v.currentTime >= dur * RESUME_MAX_FRACTION) {
      delete positionsRef.current[rel]
      void window.ytdl.patchPlaybackSpot({ positionUpdates: { [rel]: null } })
      return
    }
    schedulePositionSave(rel, v.currentTime)
  }, [schedulePositionSave, allowSpotSaveRef])

  const onVideoPauseOrSeeked = useCallback(() => {
    const v = videoRef.current
    const rel = currentRelRef.current
    if (!v || !rel || !allowSpotSaveRef.current) return
    const dur = v.duration
    if (dur > 0 && !Number.isNaN(dur) && v.currentTime >= dur * RESUME_MAX_FRACTION) {
      delete positionsRef.current[rel]
      void window.ytdl.patchPlaybackSpot({ positionUpdates: { [rel]: null } })
      return
    }
    flushPositionNow(rel, v.currentTime)
  }, [flushPositionNow, allowSpotSaveRef])

  /** Flush position on visibility hidden (tab/window hide). */
  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState !== 'hidden') return
      const v = videoRef.current
      const rel = currentRelRef.current
      if (!v || !rel || !allowSpotSaveRef.current) return
      const dur = v.duration
      if (dur > 0 && !Number.isNaN(dur) && v.currentTime >= dur * RESUME_MAX_FRACTION) return
      console.log('[usePlayback] visibility hidden → flush resume position', { rel, t: v.currentTime })
      flushPositionNow(rel, v.currentTime)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [flushPositionNow, allowSpotSaveRef])

  /** Flush before reload/close so debounced saves are not lost (best-effort; IPC is async). */
  useEffect(() => {
    const onLeave = (): void => {
      const v = videoRef.current
      const rel = currentRelRef.current
      if (!v || !rel || !allowSpotSaveRef.current) return
      const dur = v.duration
      if (dur > 0 && !Number.isNaN(dur) && v.currentTime >= dur * RESUME_MAX_FRACTION) return
      const t = v.currentTime
      if (t < 0.5) return
      console.log('[usePlayback] pagehide/beforeunload → flush resume position', { rel, t })
      flushPositionNow(rel, t)
    }
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('beforeunload', onLeave)
    }
  }, [flushPositionNow, allowSpotSaveRef])

  /** Persist session state changes (debounced). */
  useEffect(() => {
    if (!allowSpotSaveRef.current) return
    const t = setTimeout(() => {
      const es = clampExplicitStartIndex(explicitStartIndex, playlist.length)
      const explicitTail = playlist.slice(es)
      void window.ytdl.patchPlaybackSpot({
        session: {
          queue: explicitTail,
          playlist,
          cursor,
          currentRel,
          playing,
          explicitStartIndex: es
        }
      })
      console.log('[usePlayback] patchPlaybackSpot session', {
        explicitStartIndex: es,
        explicitTailLen: explicitTail.length,
        playlistLen: playlist.length
      })
    }, 500)
    return () => clearTimeout(t)
  }, [explicitStartIndex, playlist, cursor, currentRel, playing, allowSpotSaveRef])

  /** Paused preview: show last restored track + resume frame without autoplay. */
  useEffect(() => {
    if (!allowSpotSaveRef.current || playing || !currentRel) return
    const relSnapshot = currentRel
    latestPreviewRelRequestRef.current = relSnapshot
    const v = videoRef.current
    if (!v) return
    let cancelled = false
    /** Same idea as {@link playRelGenerationRef}: overlapping preview loads must not seek wrong file. */
    const previewGen = ++playRelGenerationRef.current
    void (async () => {
      const r = await window.ytdl.mediaUrl(relSnapshot)
      if (cancelled) return
      if (latestPreviewRelRequestRef.current !== relSnapshot) {
        console.info('[usePlayback] preview mediaUrl: superseded by newer selection', { relSnapshot })
        return
      }
      if (previewGen !== playRelGenerationRef.current) {
        console.info('[usePlayback] preview mediaUrl: superseded by newer load', { relSnapshot, previewGen })
        return
      }
      if (!r.ok || !r.url) return
      v.src = r.url
      const resume = positionsRef.current[relSnapshot]
      const onMeta = (): void => {
        v.removeEventListener('loadedmetadata', onMeta)
        if (cancelled || latestPreviewRelRequestRef.current !== relSnapshot) return
        if (previewGen !== playRelGenerationRef.current) {
          console.info('[usePlayback] ignoring stale preview loadedmetadata', { relSnapshot, previewGen })
          return
        }
        const dur = v.duration
        const shouldResume =
          resume != null &&
          dur > 0 &&
          !Number.isNaN(dur) &&
          resume < dur * RESUME_MAX_FRACTION
        if (shouldResume) {
          v.currentTime = Math.min(resume, dur * 0.999)
        } else {
          try {
            v.currentTime = 0
          } catch (e) {
            console.warn('[usePlayback] preview: could not reset currentTime', e)
          }
        }
        v.pause()
      }
      v.addEventListener('loadedmetadata', onMeta)
    })()
    return () => { cancelled = true }
  }, [playing, currentRel, allowSpotSaveRef])

  /* ── Actions ── */

  const addToQueue = useCallback((relPath: string) => {
    if (playingRef.current) {
      setPlaylist((pl) => {
        const c = cursorRef.current
        const upcoming = pl.slice(c)
        if (upcoming.includes(relPath)) return pl
        return [...pl, relPath]
      })
      console.log('[usePlayback] addToQueue while playing → appended to playlist tail', { relPath })
      return
    }
    if (playlistRef.current.length === 0) {
      setStagingQueue((q) => (q.includes(relPath) ? q : [...q, relPath]))
      console.log('[usePlayback] addToQueue idle (staging) → appended', { relPath })
      return
    }
    setPlaylist((pl) => {
      const c = cursorRef.current
      const rest = pl.slice(c)
      if (rest.includes(relPath)) return pl
      return [...pl, relPath]
    })
    console.log('[usePlayback] addToQueue idle → appended to playlist tail', { relPath })
  }, [])

  /** Staging / restored playlist / full library (newest first). */
  const startPreferredPlaylist = useCallback(() => {
    if (stagingQueueRef.current.length > 0 && playlistRef.current.length === 0) {
      const sq = [...stagingQueueRef.current]
      setPlaylist(sq)
      setExplicitStartIndex(0)
      setStagingQueue([])
      setCursor(0)
      setPlaying(true)
      console.log('[usePlayback] startPreferredPlaylist from staging', { len: sq.length })
      return
    }
    if (playlist.length > 0) {
      setPlaying(true)
      console.log('[usePlayback] startPreferredPlaylist resume existing playlist')
      return
    }
    const pl = library.map((x) => x.relPath)
    if (pl.length === 0) {
      appendLog('[ui] nothing to play\n')
      return
    }
    setPlaylist(pl)
    setExplicitStartIndex(pl.length)
    setCursor(0)
    setPlaying(true)
    console.log('[usePlayback] startPreferredPlaylist full library', { len: pl.length })
  }, [playlist.length, library, appendLog])

  /** Jump to `playlist[p]` as the new current track; truncate earlier entries; preserve explicit boundary. */
  const playFromPlaylistIndex = useCallback((p: number) => {
    const pl = playlistRef.current
    const E = explicitStartIndexRef.current
    if (p < 0 || p >= pl.length) {
      console.warn('[usePlayback] playFromPlaylistIndex out of range', { p, len: pl.length })
      return
    }
    const newPl = pl.slice(p)
    const newE = clampExplicitStartIndex(Math.max(0, E - p), newPl.length)
    setPlaylist(newPl)
    setExplicitStartIndex(newE)
    setCursor(0)
    setPlaying(true)
    console.log('[usePlayback] playFromPlaylistIndex', { p, newPlLen: newPl.length, newE })
  }, [])

  /** Staging-only drawer: play from row `i` onward. */
  const playFromStagingIndex = useCallback((i: number) => {
    const sq = stagingQueueRef.current
    if (i < 0 || i >= sq.length) {
      console.warn('[usePlayback] playFromStagingIndex out of range', { i, len: sq.length })
      return
    }
    const slice = sq.slice(i)
    setPlaylist(slice)
    setExplicitStartIndex(0)
    setStagingQueue([])
    setCursor(0)
    setPlaying(true)
    console.log('[usePlayback] playFromStagingIndex', { i, len: slice.length })
  }, [])

  const playFromLibraryRel = useCallback(
    (relPath: string) => {
      const idx = library.findIndex((x) => x.relPath === relPath)
      if (idx < 0) return
      const context = library.slice(idx).map((x) => x.relPath)
      const playingNow = playingRef.current
      const tail = playingNow
        ? playlistRef.current.slice(explicitStartIndexRef.current)
        : [...playlistRef.current.slice(explicitStartIndexRef.current), ...stagingQueueRef.current]
      setStagingQueue([])
      const merged = [...context, ...tail]
      setPlaylist(merged)
      setExplicitStartIndex(context.length)
      setCursor(0)
      setPlaying(true)
      console.log('[usePlayback] playFromLibraryRel', {
        relPath,
        contextLen: context.length,
        tailLen: tail.length,
        wasPlaying: playingNow
      })
    },
    [library]
  )

  /**
   * Move the video element back from a Document PiP window into the main DOM slot.
   * @param closePipWindow When true, call {@link Window#close} on the PiP window after moving the node (e.g. user toggle off or stop).
   */
  const syncRestoreDocumentPip = useCallback((closePipWindow: boolean): void => {
    docPipUnmountRef.current?.()
    docPipUnmountRef.current = null
    const dpp = window.documentPictureInPicture
    const leaveHandler = docPipLeaveHandlerRef.current
    if (leaveHandler && dpp) {
      dpp.removeEventListener('leave', leaveHandler)
      docPipLeaveHandlerRef.current = null
    }
    const el = videoRef.current
    const parent = docPipSlotParentRef.current
    if (el && parent && !parent.contains(el)) parent.appendChild(el)
    if (el) el.style.cssText = ''
    docPipSlotParentRef.current = null
    setDocumentPipActive(false)
    if (closePipWindow && dpp?.window) {
      try {
        dpp.window.close()
      } catch (e) {
        console.warn('[usePlayback] document PiP window.close failed', e)
      }
    }
  }, [])

  const enterPip = useCallback(async () => {
    const v = videoRef.current
    if (!v) {
      console.log('[usePlayback] enterPip: no video element')
      return
    }
    /** `video.src` can be empty while `currentSrc` is set after resolution / internal state. */
    const hasMedia = Boolean(v.srcObject || v.currentSrc || v.src)
    if (!hasMedia) {
      appendLog('[ui] PiP: no media loaded on the video element.\n')
      console.log('[usePlayback] enterPip: abort — no media url / srcObject')
      return
    }
    const dpp = window.documentPictureInPicture
    const electron = shouldUseNativePictureInPictureOnly()
    /**
     * On Electron, `documentPictureInPicture.window` may be truthy even when no visible Document PiP
     * exists (API stub). Treating that as “PiP open” made every click hit “close” and return early,
     * so the floating player never opened.
     */
    const documentPipIsOpen =
      Boolean(docPipSlotParentRef.current) || (!electron && Boolean(dpp?.window))
    if (documentPipIsOpen) {
      console.log('[usePlayback] enterPip: closing document PiP', {
        hadSlotParent: Boolean(docPipSlotParentRef.current),
        dppWindow: Boolean(dpp?.window),
        electron
      })
      syncRestoreDocumentPip(true)
      return
    }
    if (floatingPlayerActiveRef.current) {
      console.log('[usePlayback] enterPip: closing floating player window')
      await window.ytdl.closeFloatingPlayer()
      return
    }
    if (document.pictureInPictureElement === v) {
      try {
        console.log('[usePlayback] enterPip: exiting native video PiP')
        await document.exitPictureInPicture()
      } catch (e) {
        appendLog(`[ui] exit PiP error: ${String(e)}\n`)
      }
      return
    }

    const slotParent = v.parentElement
    if (!slotParent) {
      appendLog('[ui] PiP error: video has no parent element\n')
      return
    }

    const canDocPip =
      !shouldUseNativePictureInPictureOnly() && Boolean(dpp && typeof dpp.requestWindow === 'function')
    if (canDocPip) {
      let pipWin: Window | null = null
      try {
        console.log('[usePlayback] enterPip: opening document PiP window')
        pipWin = await dpp!.requestWindow({ width: 560, height: 380 })
        docPipSlotParentRef.current = slotParent
        setDocumentPipActive(true)
        docPipUnmountRef.current = mountDocumentPipChrome(pipWin, v, {
          onRequestClose: () => {
            console.log('[usePlayback] document PiP: Close control')
            pipWin?.close()
          }
        })
        const onLeave = (): void => {
          console.log('[usePlayback] document PiP: leave event')
          syncRestoreDocumentPip(false)
        }
        docPipLeaveHandlerRef.current = onLeave
        dpp!.addEventListener('leave', onLeave)
        return
      } catch (e) {
        console.warn('[usePlayback] document PiP failed, falling back to native PiP', e)
        appendLog(`[ui] document PiP unavailable (${String(e)}); trying native PiP\n`)
        docPipSlotParentRef.current = null
        setDocumentPipActive(false)
        if (pipWin) {
          try {
            pipWin.close()
          } catch {
            /* ignore */
          }
        }
      }
    }

    if (shouldUseNativePictureInPictureOnly()) {
      const url = v.currentSrc || v.src
      if (!url) {
        appendLog('[ui] PiP: could not read media URL for floating player.\n')
        return
      }
      const wasPlaying = !v.paused
      v.pause()
      const relForArt = currentRelRef.current
      const artworkUrl =
        relForArt != null
          ? await resolveFloatingArtworkUrl(relForArt, libraryRef.current, podcastRowsRef.current)
          : null
      console.log('[usePlayback] enterPip: opening Electron floating player (seek controls)', {
        urlSample: url.slice(0, 80),
        hasArtwork: Boolean(artworkUrl)
      })
      try {
        const r = await window.ytdl.openFloatingPlayer({
          url,
          currentTime: v.currentTime,
          volume: v.volume,
          playing: wasPlaying,
          artworkUrl
        })
        if (!r || typeof r !== 'object' || !('ok' in r) || !r.ok) {
          const err =
            r && typeof r === 'object' && 'error' in r && typeof r.error === 'string'
              ? r.error
              : 'failed'
          appendLog(`[ui] floating player: ${err}\n`)
          if (wasPlaying) void v.play()
          return
        }
        setFloatingSync(null)
        setFloatingPlayerActive(true)
        console.log('[usePlayback] floating player active; timeline will sync via IPC')
      } catch (e) {
        appendLog(`[ui] floating player IPC error: ${String(e)}\n`)
        console.error('[usePlayback] openFloatingPlayer threw', e)
        if (wasPlaying) void v.play()
      }
      return
    }

    try {
      if (v.disablePictureInPicture) {
        appendLog('[ui] PiP: disabled on this video element.\n')
        return
      }
      if (!document.pictureInPictureEnabled) {
        console.warn('[usePlayback] enterPip: document.pictureInPictureEnabled is false')
      }
      console.log('[usePlayback] enterPip: native video requestPictureInPicture')
      await v.requestPictureInPicture()
    } catch (e) {
      const msg = String(e)
      appendLog(`[ui] PiP error: ${msg}\n`)
      console.error('[usePlayback] enterPip: native PiP failed', e)
    }
  }, [appendLog, syncRestoreDocumentPip])

  const stopPlayback = useCallback(() => {
    syncRestoreDocumentPip(true)
    suppressFloatingResumeRef.current = true
    pendingFloatingReopenRef.current = false
    void window.ytdl.closeFloatingPlayer()
    setFloatingPlayerActive(false)
    const v = videoRef.current
    const rel = currentRelRef.current
    if (v && rel && allowSpotSaveRef.current) {
      const t = v.currentTime
      const dur = v.duration
      const nearEnd = dur > 0 && !Number.isNaN(dur) && t >= dur * RESUME_MAX_FRACTION
      if (!nearEnd && t >= 0.5) flushPositionNow(rel, t)
    }
    latestPlayRelRequestRef.current = null
    setPlaying(false)
    setCurrentRel(null)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.removeAttribute('src')
    }
  }, [flushPositionNow, allowSpotSaveRef, syncRestoreDocumentPip])

  const removeFromStagingIndex = useCallback((idx: number) => {
    setStagingQueue((q) => q.filter((_, i) => i !== idx))
    console.log('[usePlayback] removeFromStagingIndex', { idx })
  }, [])

  /** Remove one row from the in-memory playlist by absolute index (drawer passes this). */
  const removeFromPlaylistIndex = useCallback(
    (targetIndex: number) => {
      const pl = playlistRef.current
      const c = cursorRef.current
      const E = explicitStartIndexRef.current
      if (targetIndex < 0 || targetIndex >= pl.length) {
        console.warn('[usePlayback] removeFromPlaylistIndex out of range', {
          targetIndex,
          plLen: pl.length
        })
        return
      }
      const play = playingRef.current
      const nextPl = pl.filter((_, j) => j !== targetIndex)
      if (nextPl.length === 0) {
        console.log('[usePlayback] removeFromPlaylistIndex → playlist empty, stop')
        stopPlayback()
        setPlaylist([])
        setExplicitStartIndex(0)
        setCursor(0)
        setCurrentRel(null)
        return
      }
      let newE = E
      if (targetIndex < E) newE--
      newE = clampExplicitStartIndex(newE, nextPl.length)

      if (!play) {
        let newCur = c
        if (targetIndex < c) newCur = c - 1
        else if (targetIndex === c) newCur = Math.min(c, nextPl.length - 1)
        newCur = Math.max(0, Math.min(newCur, nextPl.length - 1))
        setPlaylist(nextPl)
        setExplicitStartIndex(newE)
        setCursor(newCur)
        setCurrentRel(nextPl[newCur] ?? null)
        console.log('[usePlayback] removeFromPlaylistIndex idle', { targetIndex, newCur, newE })
        return
      }

      setPlaylist(nextPl)
      setExplicitStartIndex(newE)
      setCursor((prev) => (targetIndex < prev ? prev - 1 : prev))
      console.log('[usePlayback] removeFromPlaylistIndex playing', { targetIndex, newE })
    },
    [stopPlayback]
  )

  /**
   * After the file for `deletedRel` was removed on disk: drop resume entry, prune queue/session,
   * and keep Electron floating PiP in sync when the deleted row was the active track.
   */
  const handleLibraryFileDeleted = useCallback(
    async (deletedRel: string, remainingRels: Set<string>) => {
      console.log('[usePlayback] handleLibraryFileDeleted start', {
        deletedRel,
        remainingCount: remainingRels.size,
        playing: playingRef.current,
        currentRel: currentRelRef.current
      })

      delete positionsRef.current[deletedRel]
      if (allowSpotSaveRef.current) {
        const patch = await window.ytdl.patchPlaybackSpot({
          positionUpdates: { [deletedRel]: null }
        })
        if (!patch.ok) {
          console.warn('[usePlayback] handleLibraryFileDeleted patchPlaybackSpot failed', patch.error)
        }
      }

      setStagingQueue((q) => q.filter((p) => p !== deletedRel))

      const pl = playlistRef.current
      const cur = cursorRef.current
      const oldE = explicitStartIndexRef.current
      const curRel = currentRelRef.current
      const isCurrent = curRel === deletedRel
      const play = playingRef.current

      const { playlist: newPl, cursor: newCur, currentRel: newCr } = reconcilePlaylist(
        pl,
        cur,
        remainingRels
      )

      const delIdx = pl.indexOf(deletedRel)
      let newE = oldE
      if (delIdx >= 0 && delIdx < oldE) newE--
      setExplicitStartIndex(clampExplicitStartIndex(newE, newPl.length))
      console.log('[usePlayback] handleLibraryFileDeleted explicit boundary', { oldE, newE, delIdx })

      const electron = shouldUseNativePictureInPictureOnly()
      const floatingOn = floatingPlayerActiveRef.current

      if (electron && floatingOn && isCurrent && play) {
        const sync = floatingSyncRef.current
        if (curRel && sync && allowSpotSaveRef.current) {
          const dur = sync.duration
          if (dur > 0 && !Number.isNaN(dur) && sync.currentTime >= dur * RESUME_MAX_FRACTION) {
            delete positionsRef.current[curRel]
            void window.ytdl.patchPlaybackSpot({ positionUpdates: { [curRel]: null } })
          } else if (sync.currentTime >= 0.5) {
            flushPositionNow(curRel, sync.currentTime)
          }
        }
        if (newPl.length > 0 && newCr) {
          pendingFloatingReopenRef.current = true
          console.log('[usePlayback] handleLibraryFileDeleted: floating PiP handoff to next track')
        }
      }

      setPlaylist(newPl)
      setCursor(newCur)

      if (newPl.length === 0 || !newCr) {
        console.log('[usePlayback] handleLibraryFileDeleted: playlist exhausted after delete')
        suppressFloatingResumeRef.current = true
        pendingFloatingReopenRef.current = false
        void window.ytdl.closeFloatingPlayer()
        setFloatingPlayerActive(false)
        setFloatingSync(null)
        syncRestoreDocumentPip(true)
        latestPlayRelRequestRef.current = null
        setPlaying(false)
        setCurrentRel(null)
        const v = videoRef.current
        if (v) {
          v.pause()
          v.removeAttribute('src')
        }
        return
      }

      if (!play) {
        setCurrentRel(newCr)
        console.log('[usePlayback] handleLibraryFileDeleted: set preview current', newCr)
      } else {
        console.log('[usePlayback] handleLibraryFileDeleted: playRel will run via effect', {
          cursor: newCur,
          rel: newPl[newCur]
        })
      }
    },
    [allowSpotSaveRef, flushPositionNow, syncRestoreDocumentPip]
  )

  /** Main transport bar → floating PiP `<video>` (seek / play toggle). */
  const floatingSeek = useCallback((t: number) => {
    if (!floatingPlayerActiveRef.current) {
      console.log('[usePlayback] floatingSeek ignored (floating PiP not active)')
      return
    }
    void window.ytdl.controlFloatingPlayer({ action: 'seek', currentTime: t }).then((r) => {
      if (!r.ok) console.warn('[usePlayback] controlFloatingPlayer seek', r.error)
    })
    setFloatingSync((prev) => (prev ? { ...prev, currentTime: t } : prev))
    console.log('[usePlayback] floatingSeek', { t })
  }, [])

  const floatingTogglePlay = useCallback(() => {
    if (!floatingPlayerActiveRef.current) {
      console.log('[usePlayback] floatingTogglePlay ignored (floating PiP not active)')
      return
    }
    void window.ytdl.controlFloatingPlayer({ action: 'togglePlay' }).then((r) => {
      if (!r.ok) console.warn('[usePlayback] controlFloatingPlayer togglePlay', r.error)
    })
    setFloatingSync((prev) => (prev ? { ...prev, playing: !prev.playing } : prev))
    console.log('[usePlayback] floatingTogglePlay (optimistic toggle until sync)')
  }, [])

  /**
   * OS media keys (`seekforward` / `seekbackward`) and Now Playing scrub must adjust the **active**
   * player. While Electron floating PiP is open, the main `<video>` stays paused — seeks there are
   * invisible; forward the delta to {@link floatingSeek} using {@link floatingSyncRef} time.
   */
  const applyMediaSessionSeekDelta = useCallback((deltaSec: number): void => {
    if (floatingPlayerActiveRef.current) {
      const sync = floatingSyncRef.current
      if (!sync) {
        console.warn('[usePlayback] applyMediaSessionSeekDelta: floating PiP on but no sync yet', {
          deltaSec
        })
        return
      }
      const dur = sync.duration
      const cur = sync.currentTime
      let nextT: number
      if (dur > 0 && Number.isFinite(dur)) {
        nextT = Math.max(0, Math.min(dur, cur + deltaSec))
      } else {
        nextT = Math.max(0, cur + deltaSec)
      }
      console.info('[usePlayback] applyMediaSessionSeekDelta (floating PiP)', {
        deltaSec,
        cur,
        dur,
        nextT
      })
      floatingSeek(nextT)
      return
    }
    const el = videoRef.current
    if (!el) {
      console.warn('[usePlayback] applyMediaSessionSeekDelta: no <video> element', { deltaSec })
      return
    }
    const dur = el.duration
    const cur = el.currentTime
    let nextT: number
    if (dur > 0 && !Number.isNaN(dur)) {
      nextT = Math.max(0, Math.min(dur, cur + deltaSec))
    } else {
      nextT = Math.max(0, cur + deltaSec)
    }
    el.currentTime = nextT
    queueMicrotask(() => pushMediaSessionPositionState(el))
    console.info('[usePlayback] applyMediaSessionSeekDelta (inline <video>)', { deltaSec, nextT })
  }, [floatingSeek])

  /** Skip to next track in playlist. */
  const skipNext = useCallback(() => {
    const pl = playlistRef.current
    const i = cursorRef.current
    if (i + 1 >= pl.length) return

    if (floatingPlayerActiveRef.current && shouldUseNativePictureInPictureOnly()) {
      const rel = currentRelRef.current
      const sync = floatingSyncRef.current
      if (rel && sync && allowSpotSaveRef.current) {
        const dur = sync.duration
        if (dur > 0 && !Number.isNaN(dur) && sync.currentTime >= dur * RESUME_MAX_FRACTION) {
          delete positionsRef.current[rel]
          void window.ytdl.patchPlaybackSpot({ positionUpdates: { [rel]: null } })
        } else if (sync.currentTime >= 0.5) {
          flushPositionNow(rel, sync.currentTime)
        }
      }
      pendingFloatingReopenRef.current = true
      console.log('[usePlayback] skipNext: floating PiP handoff → next track (pending reopen)')
    }
    setCursor(i + 1)
  }, [flushPositionNow, allowSpotSaveRef])

  /** Media keys / `keydown`: coalesce duplicate deliveries in the same animation frame. */
  const skipNextFromMediaKeys = useCallback(() => {
    if (skipNextCoalesceFrameRef.current) {
      console.log('[usePlayback] skipNextFromMediaKeys: ignored (coalesced same frame)')
      return
    }
    skipNextCoalesceFrameRef.current = true
    requestAnimationFrame(() => {
      skipNextCoalesceFrameRef.current = false
    })
    console.log('[usePlayback] skipNextFromMediaKeys → skipNext')
    skipNext()
  }, [skipNext])

  /**
   * Control Center, Bluetooth headsets, and many keyboards send **`seekforward`** for the
   * “fast-forward / skip ahead” control, not **`nexttrack`**. When the session has another queued
   * file, treat that as **next episode** (same as the in-app Skip control); on the last item,
   * fall back to an in-file jump (+{@link MEDIA_SESSION_SEEK_SEC}s).
   */
  const handleOsSeekForward = useCallback((): void => {
    const pl = playlistRef.current
    const i = cursorRef.current
    if (i + 1 < pl.length) {
      console.info('[usePlayback] OS seekforward / FF intent → next track', {
        cursor: i,
        playlistLength: pl.length
      })
      skipNextFromMediaKeys()
      return
    }
    console.info('[usePlayback] OS seekforward / FF intent → in-file seek (last or only item)')
    applyMediaSessionSeekDelta(MEDIA_SESSION_SEEK_SEC)
  }, [skipNextFromMediaKeys, applyMediaSessionSeekDelta])

  /** Tear down floating player when the main window switches to another file (not auto-advance from PiP). */
  useEffect(() => {
    if (!floatingPlayerActiveRef.current) return
    if (pendingFloatingReopenRef.current) {
      console.log('[usePlayback] keep floating PiP — reopening for next playlist item')
      return
    }
    void window.ytdl.closeFloatingPlayer()
  }, [currentRel])

  /** Mirror floating window progress into resume saves (main `<video>` does not emit `timeupdate` while paused). */
  useEffect(() => {
    const off = window.ytdl.onFloatingPlayerSync((p) => {
      if (!floatingPlayerActiveRef.current) {
        console.debug('[usePlayback] floating sync ignored (no active window)')
        return
      }
      console.log('[usePlayback] floating player sync', {
        t: p.currentTime,
        duration: p.duration,
        playing: p.playing
      })
      setFloatingSync(p)
      const rel = currentRelRef.current
      if (!rel || !allowSpotSaveRef.current) return
      const dur = p.duration
      if (dur > 0 && !Number.isNaN(dur) && p.currentTime >= dur * RESUME_MAX_FRACTION) {
        delete positionsRef.current[rel]
        void window.ytdl.patchPlaybackSpot({ positionUpdates: { [rel]: null } })
        return
      }
      // While floating plays, main `<video>` stays paused — flush on pause so quit saves immediately.
      if (p.playing) schedulePositionSave(rel, p.currentTime)
      else flushPositionNow(rel, p.currentTime)
    })
    return () => off()
  }, [schedulePositionSave, flushPositionNow, allowSpotSaveRef])

  useEffect(() => {
    const offClosed = window.ytdl.onFloatingPlayerClosed((p) => {
      pendingFloatingReopenRef.current = false
      console.log('[usePlayback] floating player closed', p)
      setFloatingSync(null)
      setFloatingPlayerActive(false)
      const el = videoRef.current
      const rel = currentRelRef.current
      if (el) {
        el.currentTime = p.currentTime
        if (rel && allowSpotSaveRef.current) {
          const dur = el.duration
          if (
            !(
              dur > 0 &&
              !Number.isNaN(dur) &&
              p.currentTime >= dur * RESUME_MAX_FRACTION
            )
          ) {
            flushPositionNow(rel, p.currentTime)
          }
        }
        const skipResume = suppressFloatingResumeRef.current
        suppressFloatingResumeRef.current = false
        if (p.resumePlaying && !skipResume) void el.play()
      }
    })
    const offEnded = window.ytdl.onFloatingPlayerEnded(() => {
      console.log('[usePlayback] floating player ended → advance playlist')
      setFloatingSync(null)
      const pl = playlistRef.current
      const i = cursorRef.current
      if (i + 1 < pl.length) {
        pendingFloatingReopenRef.current = true
        console.log('[usePlayback] floating PiP will reopen after next track metadata loads')
      }
      const continued = advanceAfterEnded()
      if (!continued) {
        pendingFloatingReopenRef.current = false
        setFloatingPlayerActive(false)
        /** Main no longer auto-closes the floating window on `ended`; close when the queue is done. */
        void window.ytdl.closeFloatingPlayer()
        console.log('[usePlayback] floating PiP: playlist finished — closed floating window')
      }
    })
    const offErr = window.ytdl.onFloatingPlayerError((p) => {
      pendingFloatingReopenRef.current = false
      appendLog(`[ui] floating player: ${p.message}\n`)
      setFloatingSync(null)
      setFloatingPlayerActive(false)
    })
    return () => {
      offClosed()
      offEnded()
      offErr()
    }
  }, [appendLog, advanceAfterEnded, flushPositionNow, allowSpotSaveRef])

  /** Now Playing / media keys: title and artwork hook for the current file. */
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!currentRel) {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
      return
    }
    const title = parseLibraryRelPath(currentRel).fileName
    navigator.mediaSession.metadata = new MediaMetadata({ title })
    console.log('[usePlayback] mediaSession metadata', { title })
    return () => {
      navigator.mediaSession.metadata = null
    }
  }, [currentRel])

  /** Media key actions: play/pause, ± seek, next track. */
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!currentRel) {
      try {
        navigator.mediaSession.setActionHandler('play', null)
        navigator.mediaSession.setActionHandler('pause', null)
        navigator.mediaSession.setActionHandler('seekbackward', null)
        navigator.mediaSession.setActionHandler('seekforward', null)
        navigator.mediaSession.setActionHandler('seekto', null)
        navigator.mediaSession.setActionHandler('previoustrack', null)
        navigator.mediaSession.setActionHandler('nexttrack', null)
      } catch (e) {
        console.warn('[usePlayback] mediaSession clear handlers', e)
      }
      return
    }

    const play = (): void => {
      if (floatingPlayerActiveRef.current) {
        const sync = floatingSyncRef.current
        if (sync?.playing) {
          console.log('[usePlayback] mediaSession play noop (floating PiP already playing)')
          return
        }
        floatingTogglePlay()
        console.log('[usePlayback] mediaSession play → floating PiP')
        return
      }
      void videoRef.current?.play()
      console.log('[usePlayback] mediaSession play (inline <video>)')
    }
    const pause = (): void => {
      if (floatingPlayerActiveRef.current) {
        const sync = floatingSyncRef.current
        if (sync && !sync.playing) {
          console.log('[usePlayback] mediaSession pause noop (floating PiP already paused)')
          return
        }
        floatingTogglePlay()
        console.log('[usePlayback] mediaSession pause → floating PiP')
        return
      }
      videoRef.current?.pause()
      console.log('[usePlayback] mediaSession pause (inline <video>)')
    }
    /** Relative rewind: used by `seekbackward` and often by hardware / OS as `previoustrack`. */
    const seekBack = (): void => {
      applyMediaSessionSeekDelta(-MEDIA_SESSION_SEEK_SEC)
      console.log('[usePlayback] mediaSession seekbackward / previoustrack')
    }
    const seekFwd = (): void => {
      handleOsSeekForward()
    }
    const seekTo = (details: MediaSessionActionDetails): void => {
      const t = details.seekTime
      if (t == null || !Number.isFinite(t)) return
      if (floatingPlayerActiveRef.current) {
        const sync = floatingSyncRef.current
        const dur =
          sync && sync.duration > 0 && Number.isFinite(sync.duration) ? sync.duration : 0
        const clamped = dur > 0 ? Math.max(0, Math.min(dur, t)) : Math.max(0, t)
        floatingSeek(clamped)
        console.log('[usePlayback] mediaSession seekto (floating PiP)', { requested: t, clamped, dur })
        return
      }
      const el = videoRef.current
      if (!el) return
      const dur = el.duration
      const clamped =
        dur > 0 && Number.isFinite(dur) ? Math.max(0, Math.min(dur, t)) : Math.max(0, t)
      el.currentTime = clamped
      queueMicrotask(() => pushMediaSessionPositionState(el))
      console.log('[usePlayback] mediaSession seekto (inline <video>)', { requested: t, clamped })
    }
    const next = (): void => {
      console.log('[usePlayback] mediaSession nexttrack')
      skipNextFromMediaKeys()
    }

    try {
      navigator.mediaSession.setActionHandler('play', play)
      navigator.mediaSession.setActionHandler('pause', pause)
      navigator.mediaSession.setActionHandler('seekbackward', seekBack)
      navigator.mediaSession.setActionHandler('seekforward', seekFwd)
      navigator.mediaSession.setActionHandler('seekto', seekTo)
      navigator.mediaSession.setActionHandler('previoustrack', seekBack)
      navigator.mediaSession.setActionHandler('nexttrack', next)
    } catch (e) {
      console.warn('[usePlayback] mediaSession setActionHandler', e)
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null)
        navigator.mediaSession.setActionHandler('pause', null)
        navigator.mediaSession.setActionHandler('seekbackward', null)
        navigator.mediaSession.setActionHandler('seekforward', null)
        navigator.mediaSession.setActionHandler('seekto', null)
        navigator.mediaSession.setActionHandler('previoustrack', null)
        navigator.mediaSession.setActionHandler('nexttrack', null)
      } catch {
        /* ignore */
      }
    }
  }, [currentRel, skipNextFromMediaKeys, applyMediaSessionSeekDelta, floatingSeek, floatingTogglePlay, handleOsSeekForward])

  /**
   * Hardware / OS "next track" key (`MediaTrackNext`) is not always routed through
   * {@link MediaSession#setActionHandler} in Electron; listen on `window` as well.
   * Fallback chord: ⌘/Ctrl+Shift+ArrowRight (matches common desktop player patterns).
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isKeyboardTargetEditable(e.target)) return
      if (!currentRelRef.current) return

      const isMediaRewind = e.key === 'MediaRewind' || e.code === 'MediaRewind'
      const isMediaFastForward = e.key === 'MediaFastForward' || e.code === 'MediaFastForward'
      const isMediaTrackPrevious = e.key === 'MediaTrackPrevious' || e.code === 'MediaTrackPrevious'

      if (isMediaRewind || isMediaTrackPrevious) {
        e.preventDefault()
        console.log('[usePlayback] keyboard rewind / previous track key → seek back', {
          key: e.key,
          code: e.code
        })
        applyMediaSessionSeekDelta(-MEDIA_SESSION_SEEK_SEC)
        return
      }
      if (isMediaFastForward) {
        e.preventDefault()
        console.log('[usePlayback] keyboard MediaFastForward (same intent as Control Center FF)', {
          key: e.key,
          code: e.code
        })
        handleOsSeekForward()
        return
      }

      const isMediaTrackNext = e.key === 'MediaTrackNext' || e.code === 'MediaTrackNext'
      const isNextChord =
        e.shiftKey &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (e.key === 'ArrowRight' || e.code === 'ArrowRight')
      if (!isMediaTrackNext && !isNextChord) return

      const pl = playlistRef.current
      const i = cursorRef.current
      if (i + 1 >= pl.length) {
        console.log('[usePlayback] keyboard next: ignored (no next item in playlist)', {
          cursor: i,
          len: pl.length
        })
        return
      }

      e.preventDefault()
      console.log('[usePlayback] keyboard next', {
        key: e.key,
        code: e.code,
        isMediaTrackNext,
        isNextChord
      })
      skipNextFromMediaKeys()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [skipNextFromMediaKeys, applyMediaSessionSeekDelta, handleOsSeekForward])

  /** Publish duration/position so the OS enables seek / scrub (especially macOS). */
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentRel) return
    const el = videoRef.current
    if (!el) return

    const sync = (): void => {
      pushMediaSessionPositionState(el)
    }

    let lastTimeUpdatePush = 0
    const onTimeUpdate = (): void => {
      const now = performance.now()
      if (now - lastTimeUpdatePush < 900) return
      lastTimeUpdatePush = now
      sync()
    }

    el.addEventListener('loadedmetadata', sync)
    el.addEventListener('durationchange', sync)
    el.addEventListener('seeked', sync)
    el.addEventListener('ratechange', sync)
    el.addEventListener('timeupdate', onTimeUpdate)
    sync()

    return () => {
      el.removeEventListener('loadedmetadata', sync)
      el.removeEventListener('durationchange', sync)
      el.removeEventListener('seeked', sync)
      el.removeEventListener('ratechange', sync)
      el.removeEventListener('timeupdate', onTimeUpdate)
      try {
        navigator.mediaSession.setPositionState(undefined)
      } catch {
        /* ignore */
      }
    }
  }, [currentRel])

  /** Keep OS Now Playing state in sync with the actual element. */
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentRel) return
    const el = videoRef.current
    if (!el) return
    const syncPlaybackState = (): void => {
      try {
        navigator.mediaSession.playbackState = el.paused ? 'paused' : 'playing'
      } catch (e) {
        console.warn('[usePlayback] mediaSession.playbackState', e)
      }
    }
    syncPlaybackState()
    el.addEventListener('play', syncPlaybackState)
    el.addEventListener('pause', syncPlaybackState)
    return () => {
      el.removeEventListener('play', syncPlaybackState)
      el.removeEventListener('pause', syncPlaybackState)
    }
  }, [currentRel])

  /** Drawer: library-derived upcoming (play order), each row knows its `playlist` index for jump/remove. */
  const drawerUpNext = useMemo(() => {
    if (playlist.length === 0) return [] as { relPath: string; playlistIndex: number }[]
    return playlist
      .slice(cursor + 1, explicitStartIndex)
      .map((relPath, i) => ({ relPath, playlistIndex: cursor + 1 + i }))
  }, [playlist, cursor, explicitStartIndex])

  const drawerQueued = useMemo(() => {
    if (playlist.length === 0) return [] as { relPath: string; playlistIndex: number }[]
    return playlist
      .slice(explicitStartIndex)
      .map((relPath, i) => ({ relPath, playlistIndex: explicitStartIndex + i }))
  }, [playlist, explicitStartIndex])

  const drawerStagingItems = useMemo(
    () => stagingQueue.map((relPath, index) => ({ relPath, index })),
    [stagingQueue]
  )

  /** When the only pending items are pre-play staging, the drawer uses staging rows instead of playlist slices. */
  const queueDrawerMode = useMemo((): 'staging' | 'playlist' => {
    if (playlist.length === 0 && stagingQueue.length > 0) return 'staging'
    return 'playlist'
  }, [playlist.length, stagingQueue.length])

  /** Badge on transport: items after the current track, or staged lines before first play. */
  const upcomingTransportCount = useMemo(() => {
    if (playlist.length === 0) return stagingQueue.length
    return Math.max(0, playlist.length - cursor - 1)
  }, [playlist.length, cursor, stagingQueue.length])

  return {
    playlist,
    cursor,
    playing,
    currentRel,
    videoRef,
    drawerUpNext,
    drawerQueued,
    drawerStagingItems,
    queueDrawerMode,
    upcomingTransportCount,
    restoreFromSnapshot,
    mergePositionsFromSnapshot,
    addToQueue,
    removeFromPlaylistIndex,
    removeFromStagingIndex,
    startPreferredPlaylist,
    playFromPlaylistIndex,
    playFromStagingIndex,
    playFromLibraryRel,
    enterPip,
    stopPlayback,
    skipNext,
    handleLibraryFileDeleted,
    floatingSeek,
    floatingTogglePlay,
    documentPipActive,
    floatingPlayerActive,
    floatingSync,
    onVideoEnded,
    onVideoError,
    onVideoTimeUpdate,
    onVideoPauseOrSeeked
  }
}
