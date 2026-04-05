import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  FloatingPlayerSyncPayload,
  LibraryVideo,
  PlaybackSpotSnapshot
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

/** Core playback state: video ref, playlist, cursor, resume positions, persistence. */
export function usePlayback(
  appendLog: (chunk: string) => void,
  library: LibraryVideo[],
  allowSpotSaveRef: React.MutableRefObject<boolean>
) {
  const [queue, setQueue] = useState<string[]>([])
  const [playlist, setPlaylist] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [currentRel, setCurrentRel] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playlistRef = useRef<string[]>([])
  const cursorRef = useRef(0)
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
  /** When true, ignore `resumePlaying` from the floating window (e.g. main Stop cleared playback). */
  const suppressFloatingResumeRef = useRef(false)
  /**
   * After the floating PiP `<video>` fires `ended`, we advance the playlist and reload the same
   * BrowserWindow with the next file. While that happens, {@link currentRel} changes — skip the
   * usual "close floating player on track change" effect so the window is not torn down twice.
   */
  const pendingFloatingReopenRef = useRef(false)
  useEffect(() => {
    floatingPlayerActiveRef.current = floatingPlayerActive
  }, [floatingPlayerActive])

  /* Keep refs in sync */
  useEffect(() => { playlistRef.current = playlist }, [playlist])
  useEffect(() => { cursorRef.current = cursor }, [cursor])
  useEffect(() => { currentRelRef.current = currentRel }, [currentRel])

  /** Restore session from a hydrated snapshot (called once per data-root). */
  const restoreFromSnapshot = useCallback(
    (snapshot: PlaybackSpotSnapshot, validPaths: Set<string>) => {
      const queueF = snapshot.session.queue.filter((p) => validPaths.has(p))
      const { playlist: pl, cursor: cur, currentRel: cr } = reconcilePlaylist(
        snapshot.session.playlist,
        snapshot.session.cursor,
        validPaths
      )
      positionsRef.current = Object.fromEntries(
        Object.entries(snapshot.positions).map(([k, v]) => [k, v.currentTime])
      )
      setQueue(queueF)
      setPlaylist(pl)
      setCursor(cur)
      setCurrentRel(cr)
      setPlaying(false)
      console.log('[usePlayback] restored session from snapshot', {
        positionKeys: Object.keys(positionsRef.current).length
      })
      appendLog('[ui] playback spot restored from disk\n')
    },
    [appendLog]
  )

  /**
   * Merge resume times from disk into memory without replacing queue/session.
   * Used after rescans and when the same data root was already hydrated.
   */
  const mergePositionsFromSnapshot = useCallback((snapshot: PlaybackSpotSnapshot) => {
    const fromDisk = Object.fromEntries(
      Object.entries(snapshot.positions).map(([k, v]) => [k, v.currentTime])
    )
    positionsRef.current = { ...positionsRef.current, ...fromDisk }
    console.log('[usePlayback] merged resume positions from disk', {
      mergedKeys: Object.keys(fromDisk).length,
      totalKeys: Object.keys(positionsRef.current).length
    })
  }, [])

  /** Load and play a specific relPath. */
  const playRel = useCallback(
    async (relPath: string) => {
      const v = videoRef.current
      const r = await window.ytdl.mediaUrl(relPath)
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
      setCurrentRel(relPath)
      if (v) {
        v.src = r.url
        const onMeta = (): void => {
          v.removeEventListener('loadedmetadata', onMeta)
          const dur = v.duration
          if (resume != null && dur > 0 && !Number.isNaN(dur) && resume < dur * RESUME_MAX_FRACTION) {
            v.currentTime = Math.min(resume, dur * 0.999)
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
            void window.ytdl
              .openFloatingPlayer({
                url,
                currentTime: v.currentTime,
                volume: v.volume,
                playing: true
              })
              .then((openR) => {
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
                console.log('[usePlayback] floating PiP next track window ready')
              })
              .catch((e) => {
                appendLog(`[ui] floating player IPC (next track): ${String(e)}\n`)
                console.error('[usePlayback] openFloatingPlayer after advance threw', e)
                setFloatingPlayerActive(false)
                void v.play().catch((err) => appendLog(`[ui] play error: ${String(err)}\n`))
              })
            return
          }
          void v.play().catch((e) => appendLog(`[ui] play error: ${String(e)}\n`))
        }
        v.addEventListener('loadedmetadata', onMeta)
      }
    },
    [appendLog]
  )

  /** When playing flag is on, load the track at cursor. */
  useEffect(() => {
    if (!playing || playlist.length === 0) return
    if (cursor < 0 || cursor >= playlist.length) return
    const rel = playlist[cursor]
    if (!rel) return
    void playRel(rel)
  }, [playing, playlist, cursor, playRel])

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
      void window.ytdl.patchPlaybackSpot({
        session: { queue, playlist, cursor, currentRel, playing }
      })
    }, 500)
    return () => clearTimeout(t)
  }, [queue, playlist, cursor, currentRel, playing, allowSpotSaveRef])

  /** Paused preview: show last restored track + resume frame without autoplay. */
  useEffect(() => {
    if (!allowSpotSaveRef.current || playing || !currentRel) return
    const v = videoRef.current
    if (!v) return
    let cancelled = false
    void (async () => {
      const r = await window.ytdl.mediaUrl(currentRel)
      if (cancelled || currentRelRef.current !== currentRel) return
      if (!r.ok || !r.url) return
      v.src = r.url
      const resume = positionsRef.current[currentRel]
      const onMeta = (): void => {
        v.removeEventListener('loadedmetadata', onMeta)
        if (cancelled || currentRelRef.current !== currentRel) return
        const dur = v.duration
        if (resume != null && dur > 0 && !Number.isNaN(dur) && resume < dur * RESUME_MAX_FRACTION) {
          v.currentTime = Math.min(resume, dur * 0.999)
        }
        v.pause()
      }
      v.addEventListener('loadedmetadata', onMeta)
    })()
    return () => { cancelled = true }
  }, [playing, currentRel, allowSpotSaveRef])

  /* ── Actions ── */

  const addToQueue = useCallback((relPath: string) => {
    setQueue((q) => (q.includes(relPath) ? q : [...q, relPath]))
  }, [])

  const removeFromQueue = useCallback((index: number) => {
    setQueue((q) => q.filter((_, i) => i !== index))
  }, [])

  /** Queue > restored session > full library (newest first). */
  const startPreferredPlaylist = useCallback(() => {
    if (queue.length > 0) {
      setPlaylist([...queue])
      setCursor(0)
      setPlaying(true)
      return
    }
    if (playlist.length > 0) {
      setPlaying(true)
      return
    }
    const pl = library.map((x) => x.relPath)
    if (pl.length === 0) { appendLog('[ui] nothing to play\n'); return }
    setPlaylist(pl)
    setCursor(0)
    setPlaying(true)
  }, [queue, playlist, library, appendLog])

  const playFromQueueIndex = useCallback((index: number) => {
    if (index < 0 || index >= queue.length) return
    setPlaylist(queue.slice(index))
    setCursor(0)
    setPlaying(true)
  }, [queue])

  const playFromLibraryRel = useCallback(
    (relPath: string) => {
      const idx = library.findIndex((x) => x.relPath === relPath)
      if (idx < 0) return
      setPlaylist(library.slice(idx).map((x) => x.relPath))
      setCursor(0)
      setPlaying(true)
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
      console.log('[usePlayback] enterPip: opening Electron floating player (seek controls)', {
        urlSample: url.slice(0, 80)
      })
      try {
        const r = await window.ytdl.openFloatingPlayer({
          url,
          currentTime: v.currentTime,
          volume: v.volume,
          playing: wasPlaying
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
    setPlaying(false)
    setCurrentRel(null)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.removeAttribute('src')
    }
  }, [flushPositionNow, allowSpotSaveRef, syncRestoreDocumentPip])

  /** Skip to next track in playlist. */
  const skipNext = useCallback(() => {
    const pl = playlistRef.current
    const i = cursorRef.current
    if (i + 1 < pl.length) {
      setCursor(i + 1)
    }
  }, [])

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
      void videoRef.current?.play()
      console.log('[usePlayback] mediaSession play')
    }
    const pause = (): void => {
      videoRef.current?.pause()
      console.log('[usePlayback] mediaSession pause')
    }
    /** Relative rewind: used by `seekbackward` and often by hardware / OS as `previoustrack`. */
    const seekBack = (): void => {
      const el = videoRef.current
      if (!el) return
      el.currentTime = Math.max(0, el.currentTime - MEDIA_SESSION_SEEK_SEC)
      queueMicrotask(() => pushMediaSessionPositionState(el))
      console.log('[usePlayback] mediaSession seekbackward (or previoustrack → seek back)')
    }
    const seekFwd = (): void => {
      const el = videoRef.current
      if (!el) return
      const dur = el.duration
      if (dur > 0 && !Number.isNaN(dur)) el.currentTime = Math.min(dur, el.currentTime + MEDIA_SESSION_SEEK_SEC)
      else el.currentTime = el.currentTime + MEDIA_SESSION_SEEK_SEC
      queueMicrotask(() => pushMediaSessionPositionState(el))
      console.log('[usePlayback] mediaSession seekforward')
    }
    const seekTo = (details: MediaSessionActionDetails): void => {
      const el = videoRef.current
      if (!el) return
      const t = details.seekTime
      if (t == null || !Number.isFinite(t)) return
      const dur = el.duration
      const clamped =
        dur > 0 && Number.isFinite(dur) ? Math.max(0, Math.min(dur, t)) : Math.max(0, t)
      el.currentTime = clamped
      queueMicrotask(() => pushMediaSessionPositionState(el))
      console.log('[usePlayback] mediaSession seekto', { requested: t, clamped })
    }
    const next = (): void => {
      console.log('[usePlayback] mediaSession nexttrack')
      skipNext()
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
  }, [currentRel, skipNext])

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

  return {
    queue,
    setQueue,
    playlist,
    cursor,
    playing,
    currentRel,
    videoRef,
    restoreFromSnapshot,
    mergePositionsFromSnapshot,
    addToQueue,
    removeFromQueue,
    startPreferredPlaylist,
    playFromQueueIndex,
    playFromLibraryRel,
    enterPip,
    stopPlayback,
    skipNext,
    documentPipActive,
    floatingPlayerActive,
    floatingSync,
    onVideoEnded,
    onVideoError,
    onVideoTimeUpdate,
    onVideoPauseOrSeeked
  }
}
