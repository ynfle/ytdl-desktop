import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, PictureInPicture2, SkipForward, ListMusic, Music2 } from 'lucide-react'
import { motion } from 'motion/react'
import type { FloatingPlayerSyncPayload } from '../../../shared/ytdl-api'
import { humanizeRestrictFilename } from '../../../shared/humanize-restrict-filename'
import { parseLibraryRelPath } from '../hooks/useLibrary'
import { TransportThumb } from './MediaThumbSlot'

/** localStorage key for the right-hand video column width (px). */
const VIDEO_ASIDE_WIDTH_STORAGE_KEY = 'ytdl.videoAsideWidthPx'
/** Minimum width so the preview stays usable. */
const VIDEO_ASIDE_MIN_PX = 220
/** Minimum width reserved for the main (pages) column beside the video. */
const MAIN_COLUMN_MIN_PX = 260
/** Upper cap matching the previous `min(..., 520px)` layout. */
const VIDEO_ASIDE_DEFAULT_CAP_PX = 520

function maxVideoAsideWidth(): number {
  if (typeof window === 'undefined') return VIDEO_ASIDE_DEFAULT_CAP_PX
  return Math.max(VIDEO_ASIDE_MIN_PX, window.innerWidth - MAIN_COLUMN_MIN_PX)
}

/** Keeps the video column within window and policy bounds. */
function clampVideoAsideWidth(w: number): number {
  return Math.min(maxVideoAsideWidth(), Math.max(VIDEO_ASIDE_MIN_PX, Math.round(w)))
}

/** Default width: same formula as the old Tailwind `min(42vw, 520px)`. */
function defaultVideoAsideWidth(): number {
  if (typeof window === 'undefined') return 400
  return Math.min(Math.round(window.innerWidth * 0.42), VIDEO_ASIDE_DEFAULT_CAP_PX)
}

function readStoredVideoAsideWidth(): number | null {
  try {
    const raw = localStorage.getItem(VIDEO_ASIDE_WIDTH_STORAGE_KEY)
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function initialVideoAsideWidth(): number {
  const stored = readStoredVideoAsideWidth()
  if (stored != null) return clampVideoAsideWidth(stored)
  return clampVideoAsideWidth(defaultVideoAsideWidth())
}

/**
 * Draggable width for the video aside when it is visible (not PiP-collapsed).
 * Persists to localStorage; clamps on window resize; optional keyboard nudge on the separator.
 */
function useResizableVideoAside(collapseVideoAside: boolean): {
  asideWidthPx: number
  asideResizing: boolean
  onVideoAsideResizeMouseDown: (e: React.MouseEvent) => void
  onVideoAsideSeparatorKeyDown: (e: React.KeyboardEvent) => void
  onVideoAsideSeparatorDoubleClick: () => void
  videoAsideSeparatorMax: number
} {
  const [asideWidthPx, setAsideWidthPx] = useState(initialVideoAsideWidth)
  const [asideResizing, setAsideResizing] = useState(false)

  useEffect(() => {
    const onWinResize = (): void => {
      setAsideWidthPx((w) => {
        const next = clampVideoAsideWidth(w)
        if (next !== w) {
          console.info('[Player] video aside width clamped on window resize', {
            before: w,
            after: next,
            innerWidth: window.innerWidth
          })
        }
        return next
      })
    }
    window.addEventListener('resize', onWinResize)
    return () => window.removeEventListener('resize', onWinResize)
  }, [])

  const persistAsideWidth = useCallback((w: number): number => {
    const c = clampVideoAsideWidth(w)
    try {
      localStorage.setItem(VIDEO_ASIDE_WIDTH_STORAGE_KEY, String(c))
      console.log('[Player] video aside width persisted', { widthPx: c })
    } catch (err) {
      console.warn('[Player] video aside width persist failed', err)
    }
    return c
  }, [])

  const onVideoAsideResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapseVideoAside || e.button !== 0) return
      e.preventDefault()
      const startX = e.clientX
      const startW = asideWidthPx
      setAsideResizing(true)
      console.log('[Player] video aside resize drag start', { startW, startX })

      const onMove = (ev: MouseEvent): void => {
        setAsideWidthPx(clampVideoAsideWidth(startW - (ev.clientX - startX)))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setAsideResizing(false)
        setAsideWidthPx((w) => {
          const c = clampVideoAsideWidth(w)
          persistAsideWidth(c)
          console.info('[Player] video aside resize drag end', { widthPx: c })
          return c
        })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [asideWidthPx, collapseVideoAside, persistAsideWidth]
  )

  const onVideoAsideSeparatorDoubleClick = useCallback(() => {
    if (collapseVideoAside) return
    const d = clampVideoAsideWidth(defaultVideoAsideWidth())
    setAsideWidthPx(d)
    persistAsideWidth(d)
    console.info('[Player] video aside width reset to default (double-click)', { widthPx: d })
  }, [collapseVideoAside, persistAsideWidth])

  const onVideoAsideSeparatorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (collapseVideoAside) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setAsideWidthPx((w) => {
          const c = clampVideoAsideWidth(w + 16)
          persistAsideWidth(c)
          return c
        })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setAsideWidthPx((w) => {
          const c = clampVideoAsideWidth(w - 16)
          persistAsideWidth(c)
          return c
        })
      } else if (e.key === 'Home') {
        e.preventDefault()
        setAsideWidthPx(() => {
          persistAsideWidth(VIDEO_ASIDE_MIN_PX)
          return VIDEO_ASIDE_MIN_PX
        })
      } else if (e.key === 'End') {
        e.preventDefault()
        const maxW = maxVideoAsideWidth()
        setAsideWidthPx(() => {
          persistAsideWidth(maxW)
          return maxW
        })
      }
    },
    [collapseVideoAside, persistAsideWidth]
  )

  return {
    asideWidthPx,
    asideResizing,
    onVideoAsideResizeMouseDown,
    onVideoAsideSeparatorKeyDown,
    onVideoAsideSeparatorDoubleClick,
    videoAsideSeparatorMax: maxVideoAsideWidth()
  }
}

/** Inline vs PiP: drives video column size and where the element is positioned. */
function useInlineVideoPip(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  currentRel: string | null,
  /** Document Picture-in-Picture (custom window); native video PiP does not set this. */
  documentPipActive: boolean
) {
  /** True while this <video> is in the native system Picture-in-Picture window. */
  const [inPip, setInPip] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onEnter = (): void => {
      setInPip(true)
      console.log('[Player] Picture-in-Picture: entered (video moves to PiP window)')
    }
    const onLeave = (): void => {
      setInPip(false)
      console.log('[Player] Picture-in-Picture: left (video returns to app window)')
    }
    v.addEventListener('enterpictureinpicture', onEnter)
    v.addEventListener('leavepictureinpicture', onLeave)
    if (document.pictureInPictureElement === v) {
      setInPip(true)
      console.log('[Player] Picture-in-Picture: already active on bind')
    }
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter)
      v.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [videoRef, currentRel])

  const inAnyPip = inPip || documentPipActive
  const showInlineVideo = Boolean(currentRel) && !inAnyPip
  /** Collapse the right video column while PiP is showing the picture (frees space for pages). */
  const collapseVideoAside = Boolean(currentRel) && inAnyPip

  useEffect(() => {
    if (currentRel) {
      console.log(
        '[Player] video pane:',
        showInlineVideo ? 'inline' : inAnyPip ? 'PiP (aside collapsed)' : 'idle',
        { currentRel, collapseVideoAside, nativePip: inPip, documentPip: documentPipActive }
      )
    }
  }, [currentRel, showInlineVideo, inAnyPip, collapseVideoAside, inPip, documentPipActive])

  return { showInlineVideo, inPip: inAnyPip, collapseVideoAside }
}

export type PlayerProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  currentRel: string | null
  playing: boolean
  onPlay: () => void
  onStop: () => void
  onPip: () => void
  onSkipNext: () => void
  onToggleQueue: () => void
  queueCount: number
  onVideoEnded: () => void
  onVideoError: () => void
  onVideoTimeUpdate: () => void
  onVideoPauseOrSeeked: () => void
  /** True while video is in a Document PiP window (collapse aside like native PiP). */
  documentPipActive: boolean
  /** Electron floating PiP window is open (timeline may lag until first `floatingSync`). */
  floatingPlayerActive: boolean
  /** Electron floating PiP: timeline + play state (main `<video>` is paused; avoid driving it from the bar). */
  floatingSync: FloatingPlayerSyncPayload | null
  /** Route transport to floating `<video>` via IPC. */
  onFloatingSeek: (t: number) => void
  onFloatingTogglePlay: () => void
  /** Loopback URL for sidecar thumbnail (inline `<video>` poster until frames decode). */
  posterUrl: string | null
}

/** Format seconds to mm:ss or hh:mm:ss. */
function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/**
 * Shared state + handlers for the video element and full-width transport bar.
 * Split so the video can live in the right column while the bar spans the bottom.
 */
function usePlayerChrome({
  videoRef,
  currentRel,
  onPlay,
  onStop,
  onPip,
  onSkipNext,
  onToggleQueue,
  queueCount,
  onVideoEnded,
  onVideoError,
  onVideoTimeUpdate,
  onVideoPauseOrSeeked,
  documentPipActive,
  floatingPlayerActive,
  floatingSync,
  onFloatingSeek,
  onFloatingTogglePlay,
  posterUrl
}: PlayerProps): {
  videoPane: React.ReactElement
  transportBar: React.ReactElement
  collapseVideoAside: boolean
} {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPaused, setIsPaused] = useState(true)
  /** null until metadata/resize; false = audio-only → show {@link posterUrl} behind hidden video. */
  const [hasVideoFrame, setHasVideoFrame] = useState<boolean | null>(null)
  const seekRef = useRef(false)

  const { showInlineVideo, collapseVideoAside } = useInlineVideoPip(videoRef, currentRel, documentPipActive)

  useEffect(() => {
    setHasVideoFrame(null)
    console.info('[Player] video pane: reset hasVideoFrame for new track', { currentRel })
  }, [currentRel])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onResize = (): void => {
      const ok = v.videoWidth > 0 && v.videoHeight > 0
      setHasVideoFrame(ok)
      console.info('[Player] video pane: resize', {
        hasVideoFrame: ok,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight
      })
    }
    v.addEventListener('resize', onResize)
    return () => v.removeEventListener('resize', onResize)
  }, [currentRel, videoRef])
  const fileName = currentRel ? humanizeRestrictFilename(parseLibraryRelPath(currentRel).fileName) : null
  /** Electron floating PiP: transport drives child window, not the paused main `<video>`. */
  const remoteFloatingTransport = Boolean(floatingPlayerActive || floatingSync)

  const handleTimeUpdate = useCallback(() => {
    onVideoTimeUpdate()
    const v = videoRef.current
    if (remoteFloatingTransport) return
    if (v && !seekRef.current) {
      setCurrentTime(v.currentTime)
      setDuration(v.duration || 0)
      setIsPaused(v.paused)
    }
  }, [videoRef, onVideoTimeUpdate, remoteFloatingTransport])

  const handlePause = useCallback(() => {
    onVideoPauseOrSeeked()
    setIsPaused(true)
  }, [onVideoPauseOrSeeked])

  const handlePlay = useCallback(() => {
    setIsPaused(false)
  }, [])

  const handleSeeked = useCallback(() => {
    onVideoPauseOrSeeked()
    seekRef.current = false
  }, [onVideoPauseOrSeeked])

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration || 0)
    const ok = v.videoWidth > 0 && v.videoHeight > 0
    setHasVideoFrame(ok)
    console.info('[Player] video pane: loadedmetadata', {
      hasVideoFrame: ok,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight
    })
  }, [videoRef])

  const onScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = Number(e.target.value)
      if (remoteFloatingTransport) {
        onFloatingSeek(t)
        return
      }
      const v = videoRef.current
      if (!v) return
      seekRef.current = true
      v.currentTime = t
      setCurrentTime(t)
    },
    [videoRef, remoteFloatingTransport, onFloatingSeek]
  )

  const togglePlayPause = useCallback(() => {
    if (remoteFloatingTransport) {
      onFloatingTogglePlay()
      console.log('[Player] play/pause → floating PiP via IPC')
      return
    }
    const v = videoRef.current
    if (!v || !currentRel) {
      onPlay()
      return
    }
    if (v.paused) {
      void v.play()
    } else {
      v.pause()
    }
  }, [videoRef, currentRel, onPlay, remoteFloatingTransport, onFloatingTogglePlay])

  /** While `floatingSync` is set, the transport reflects the child window, not the paused main `<video>`. */
  const barDuration =
    floatingSync && floatingSync.duration > 0 ? floatingSync.duration : duration
  const barTime = floatingSync ? floatingSync.currentTime : currentTime
  const barPaused = floatingSync ? !floatingSync.playing : isPaused
  const pct = barDuration > 0 ? (barTime / barDuration) * 100 : 0

  /** Keep artwork visible until we know the media has a decoded video plane (audio posters drop in Chromium). */
  const showArtworkLayer = Boolean(showInlineVideo && posterUrl && hasVideoFrame !== true)

  const videoPane = (
    <div
      className={
        collapseVideoAside
          ? 'relative flex h-0 min-h-0 flex-none flex-col overflow-hidden bg-black'
          : 'relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-black'
      }
      data-player-video-pane={showInlineVideo ? 'inline' : collapseVideoAside ? 'pip-collapsed' : 'idle'}
    >
      <div
        className={
          showInlineVideo
            ? 'absolute inset-0 flex items-center justify-center'
            : 'pointer-events-none fixed -left-[9999px] -top-[9999px] h-px w-px overflow-hidden'
        }
      >
        {showArtworkLayer && posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        ) : null}
        <video
          ref={videoRef}
          className={
            showInlineVideo
              ? `relative z-10 max-h-full max-w-full object-contain${showArtworkLayer ? ' opacity-0' : ''}`
              : 'block h-px w-px'
          }
          poster={posterUrl ?? undefined}
          onEnded={onVideoEnded}
          onError={onVideoError}
          onTimeUpdate={handleTimeUpdate}
          onPause={handlePause}
          onPlay={handlePlay}
          onSeeked={handleSeeked}
          onLoadedMetadata={handleLoadedMetadata}
        />
      </div>
      {collapseVideoAside && (
        <span className="sr-only">Video is playing in Picture-in-Picture</span>
      )}
      {!currentRel && !collapseVideoAside && (
        <div className="relative z-10 flex flex-col items-center gap-3 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-surface-overlay/60 flex items-center justify-center">
            <Music2 size={20} className="text-text-muted/50" />
          </div>
          <p className="text-xs text-text-muted">No video loaded</p>
        </div>
      )}
    </div>
  )

  const transportBar = (
    <div className="transport-bar flex h-[68px] w-full min-w-0 shrink-0 items-center gap-4 px-5">
      {/* Current track artwork */}
      <TransportThumb posterUrl={posterUrl} />

      {/* Playback controls */}
      <div className="flex shrink-0 items-center gap-1.5">
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={togglePlayPause}
          className="flex h-10 w-10 items-center justify-center rounded-full text-bg transition-shadow"
          style={{
            background: 'linear-gradient(135deg, #e8a849 0%, #d4893a 100%)',
            boxShadow: '0 2px 12px rgba(232, 168, 73, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
          }}
          title={barPaused ? 'Play' : 'Pause'}
        >
          {barPaused ? <Play size={16} className="ml-0.5" /> : <Pause size={16} />}
        </motion.button>
        <button
          onClick={onSkipNext}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text hover:bg-surface-raised/50"
          title="Next track (media key Next, or ⌘/Ctrl+Shift+→)"
        >
          <SkipForward size={15} />
        </button>
        <button
          onClick={onStop}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text hover:bg-surface-raised/50"
          title="Stop"
        >
          <Square size={13} />
        </button>
      </div>

      {/* Track info + scrubber */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <span className="truncate font-mono text-[11px] leading-tight text-text-secondary">
          {fileName ?? <span className="text-text-muted">Nothing playing</span>}
        </span>
        <div className="flex items-center gap-2.5">
          <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-muted">
            {fmtTime(barTime)}
          </span>
          <input
            type="range"
            min={0}
            max={barDuration || 0}
            step={0.1}
            value={barTime}
            onChange={onScrub}
            className="h-1 flex-1 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-border-bright) ${pct}%)`
            }}
          />
          <span className="w-10 shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
            {fmtTime(barDuration)}
          </span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onPip}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text hover:bg-surface-raised/50"
          title="Picture in Picture"
        >
          <PictureInPicture2 size={15} />
        </button>
        <button
          onClick={onToggleQueue}
          className="relative flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text hover:bg-surface-raised/50"
          title="Queue"
        >
          <ListMusic size={15} />
          {queueCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-bg"
              style={{
                background: 'linear-gradient(135deg, #e8a849 0%, #d4893a 100%)',
                boxShadow: '0 1px 4px rgba(232, 168, 73, 0.3)'
              }}
            >
              {queueCount}
            </span>
          )}
        </button>
      </div>
    </div>
  )

  return { videoPane, transportBar, collapseVideoAside }
}

type PlayerLayoutProps = PlayerProps & {
  /** Main pages (library, etc.) -- left column next to the video. */
  children: React.ReactNode
}

/**
 * Pages on the left, video on the right, full-width transport + seek bar along the bottom
 * (spans both columns; sidebar remains separate).
 */
export default function Player({ children, ...props }: PlayerLayoutProps): React.ReactElement {
  const { videoPane, transportBar, collapseVideoAside } = usePlayerChrome(props)
  const {
    asideWidthPx,
    asideResizing,
    onVideoAsideResizeMouseDown,
    onVideoAsideSeparatorKeyDown,
    onVideoAsideSeparatorDoubleClick,
    videoAsideSeparatorMax
  } = useResizableVideoAside(collapseVideoAside)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        {/* Pages column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>

        {/* Resize handle */}
        {!collapseVideoAside && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize video panel"
            title="Drag to resize video. Double-click to reset."
            aria-valuenow={Math.round(asideWidthPx)}
            aria-valuemin={VIDEO_ASIDE_MIN_PX}
            aria-valuemax={videoAsideSeparatorMax}
            tabIndex={0}
            onKeyDown={onVideoAsideSeparatorKeyDown}
            onDoubleClick={onVideoAsideSeparatorDoubleClick}
            onMouseDown={onVideoAsideResizeMouseDown}
            className="resize-handle group relative z-10 h-full w-1.5 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-accent/40 group-focus-visible:bg-accent transition-colors duration-200" />
          </div>
        )}

        {/* Video aside */}
        <aside
          className={
            collapseVideoAside
              ? 'flex h-full min-h-0 w-0 min-w-0 shrink-0 flex-col overflow-hidden border-l-0 bg-surface transition-[width] duration-200 ease-out'
              : asideResizing
                ? 'flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l-0 bg-surface'
                : 'flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l-0 bg-surface transition-[width] duration-200 ease-out'
          }
          style={collapseVideoAside ? undefined : { width: asideWidthPx }}
          aria-label="Playback video"
        >
          {videoPane}
        </aside>
      </div>

      {/* Full-width transport bar */}
      {transportBar}
    </div>
  )
}
