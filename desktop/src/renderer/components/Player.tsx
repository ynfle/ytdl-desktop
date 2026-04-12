import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, PictureInPicture2, SkipForward, ListMusic } from 'lucide-react'
import type { FloatingPlayerSyncPayload } from '../../../shared/ytdl-api'
import { parseLibraryRelPath } from '../hooks/useLibrary'

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
  onFloatingTogglePlay
}: PlayerProps): {
  videoPane: React.ReactElement
  transportBar: React.ReactElement
  collapseVideoAside: boolean
} {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPaused, setIsPaused] = useState(true)
  const seekRef = useRef(false)

  const { showInlineVideo, collapseVideoAside } = useInlineVideoPip(videoRef, currentRel, documentPipActive)
  const fileName = currentRel ? parseLibraryRelPath(currentRel).fileName : null
  /** Electron floating PiP: transport drives child window, not the paused main `<video>`. */
  const remoteFloatingTransport = Boolean(floatingPlayerActive || floatingSync)

  const handleTimeUpdate = useCallback(() => {
    onVideoTimeUpdate()
    const v = videoRef.current
    // Floating PiP owns playback; main element stays paused — ignore its frozen clock for the bar.
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
    if (v) setDuration(v.duration || 0)
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
        <video
          ref={videoRef}
          className={showInlineVideo ? 'max-h-full max-w-full object-contain' : 'block h-px w-px'}
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
        <p className="relative z-10 px-4 text-center text-xs text-text-muted">No video loaded</p>
      )}
    </div>
  )

  const transportBar = (
    <div className="flex h-[72px] w-full min-w-0 shrink-0 items-center gap-4 border-t border-border bg-surface px-4">
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={togglePlayPause}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-bg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          title={barPaused ? 'Play' : 'Pause'}
        >
          {barPaused ? <Play size={16} className="ml-0.5" /> : <Pause size={16} />}
        </button>
        <button
          onClick={onSkipNext}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-text"
          title="Next"
        >
          <SkipForward size={15} />
        </button>
        <button
          onClick={onStop}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-text"
          title="Stop"
        >
          <Square size={14} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="truncate font-mono text-xs text-text">
          {fileName ?? <span className="text-text-muted">No track loaded</span>}
        </span>
        <div className="flex items-center gap-2">
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
            className="h-1 flex-1 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-border-bright) ${pct}%)`
            }}
          />
          <span className="w-10 shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
            {fmtTime(barDuration)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onPip}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-text"
          title="Picture in Picture"
        >
          <PictureInPicture2 size={15} />
        </button>
        <button
          onClick={onToggleQueue}
          className="relative flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-text"
          title="Queue"
        >
          <ListMusic size={15} />
          {queueCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-bg">
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
  /** Main pages (library, etc.) — left column next to the video. */
  children: React.ReactNode
}

/**
 * Pages on the left, video on the right, full-width transport + seek bar along the bottom
 * (spans both columns; sidebar remains separate).
 */
export default function Player({ children, ...props }: PlayerLayoutProps): React.ReactElement {
  const { videoPane, transportBar, collapseVideoAside } = usePlayerChrome(props)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        <aside
          className={
            collapseVideoAside
              ? 'flex h-full min-h-0 w-0 min-w-0 shrink-0 flex-col overflow-hidden border-l-0 bg-surface transition-[width] duration-200 ease-out'
              : 'flex h-full min-h-0 w-[min(42vw,520px)] shrink-0 flex-col border-l border-border bg-surface transition-[width] duration-200 ease-out'
          }
          aria-label="Playback video"
        >
          {videoPane}
        </aside>
      </div>
      {transportBar}
    </div>
  )
}
