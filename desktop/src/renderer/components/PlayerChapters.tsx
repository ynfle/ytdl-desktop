import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import type { MediaChapter } from '../../../shared/ytdl-api'

/** Format seconds to m:ss or h:mm:ss (same shape as the transport clock). */
function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/**
 * Chapter that contains `timeSec`: the last marker at or before the playhead.
 * A small epsilon keeps the highlight from lagging a frame behind the boundary.
 */
export function activeMediaChapter(
  chapters: readonly MediaChapter[],
  timeSec: number
): MediaChapter | null {
  if (!Number.isFinite(timeSec) || chapters.length === 0) return null
  let found: MediaChapter | null = null
  for (const ch of chapters) {
    if (ch.startSec <= timeSec + 0.25) found = ch
    else break
  }
  return found
}

/** One painted slice of the seek bar. `chapter` is null for the lead-in before the first marker. */
type ChapterSegment = {
  chapter: MediaChapter | null
  startSec: number
  endSec: number
}

/** Lead-in shorter than this is absorbed into chapter 1 so the bar doesn't open with a hairline. */
const LEAD_IN_ABSORB_SEC = 0.75

/**
 * Tile `[0, duration]` into chapter spans.
 * Fewer than two real slices means "use the plain slider" — a single chapter has nothing to split.
 */
function buildChapterSegments(chapters: readonly MediaChapter[], duration: number): ChapterSegment[] {
  if (!(duration > 0) || chapters.length < 2) return []
  const markers = chapters
    .filter((ch) => Number.isFinite(ch.startSec) && ch.startSec >= 0 && ch.startSec < duration - 0.05)
    .sort((a, b) => a.startSec - b.startSec)
  if (markers.length < 2) return []

  const segments: ChapterSegment[] = []
  const firstStart = markers[0]!.startSec
  // A real gap before the first marker stays unlabeled; a tiny one is just rounding.
  if (firstStart > LEAD_IN_ABSORB_SEC) {
    segments.push({ chapter: null, startSec: 0, endSec: firstStart })
  }

  for (let i = 0; i < markers.length; i++) {
    const ch = markers[i]!
    const start = i === 0 ? (firstStart > LEAD_IN_ABSORB_SEC ? firstStart : 0) : ch.startSec
    const end = i + 1 < markers.length ? markers[i + 1]!.startSec : duration
    if (!(end > start)) continue
    segments.push({ chapter: ch, startSec: start, endSec: end })
  }
  return segments.length >= 2 ? segments : []
}

/**
 * Hairline between segments, like YouTube's split progress bar.
 * Crowded lists give the gap back so the slices stay grabbable.
 */
function segmentGapPx(segmentCount: number, trackWidthPx: number): number {
  if (segmentCount <= 1) return 0
  const preferred = segmentCount > 30 ? 1 : 2
  if (!(trackWidthPx > 0)) return preferred
  const maxGap = Math.floor((trackWidthPx * 0.18) / (segmentCount - 1))
  return Math.max(0, Math.min(preferred, maxGap))
}

/** Index of the slice that contains `timeSec` (last slice also owns the final sample). */
function segmentIndexAtTime(segments: readonly ChapterSegment[], timeSec: number): number {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const last = i === segments.length - 1
    if (timeSec >= seg.startSec && (timeSec < seg.endSec || last)) return i
  }
  return 0
}

/**
 * Map a time onto the gapped bar.
 * Slice `i` occupies `[(start/duration)*inner + i*gap, (end/duration)*inner + i*gap]`.
 */
function timeToX(
  timeSec: number,
  segmentIndex: number,
  duration: number,
  trackWidth: number,
  gapPx: number,
  gapCount: number
): number {
  const inner = Math.max(1, trackWidth - gapCount * gapPx)
  return (timeSec / duration) * inner + segmentIndex * gapPx
}

/**
 * Inverse of {@link timeToX}. A pointer in the gap snaps to the next chapter's start
 * so the title you see is the slice you're about to enter.
 */
function timeAtClientX(
  clientX: number,
  rect: DOMRect,
  segments: readonly ChapterSegment[],
  duration: number
): number {
  const gapCount = Math.max(0, segments.length - 1)
  const gapPx = segmentGapPx(segments.length, rect.width)
  const inner = Math.max(1, rect.width - gapCount * gapPx)
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left))
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const left = (seg.startSec / duration) * inner + i * gapPx
    const right = (seg.endSec / duration) * inner + i * gapPx
    const last = i === segments.length - 1
    // Past this slice (and not standing in the gap before it): try the next one.
    if (x > right && !last) continue
    const span = Math.max(0.001, right - left)
    const clamped = Math.min(right, Math.max(left, x))
    const t = seg.startSec + ((clamped - left) / span) * (seg.endSec - seg.startSec)
    return Math.min(duration, Math.max(0, t))
  }
  return 0
}

/** How much of a slice is covered by `timeSec`, as 0–1. */
function fillRatio(seg: ChapterSegment, timeSec: number): number {
  if (timeSec <= seg.startSec) return 0
  if (timeSec >= seg.endSec) return 1
  const span = seg.endSec - seg.startSec
  if (!(span > 0)) return 0
  return (timeSec - seg.startSec) / span
}

/** Pointer position while hovering or dragging the chapter bar. */
type ScrubHover = {
  timeSec: number
  /** Viewport x for the title, clamped so a wide label stays over the bar. */
  tipClientX: number
  /** Viewport y of the top of the track; the title sits just above this. */
  trackTop: number
  title: string | null
  segmentIndex: number
}

type ChapterScrubberProps = {
  chapters: readonly MediaChapter[]
  currentTime: number
  duration: number
  disabled: boolean
  valueText: string
  /** Seek the active player (inline video or floating PiP) to this time. */
  onSeek: (timeSec: number) => void
}

/**
 * Seek bar. With two or more chapters it becomes a YouTube-style split track:
 * each chapter is its own segment, the one under the pointer grows, and the title
 * stays up for the whole time you're anywhere inside that chapter.
 */
export function ChapterScrubber({
  chapters,
  currentTime,
  duration,
  disabled,
  valueText,
  onSeek
}: ChapterScrubberProps): React.ReactElement {
  // Stable while the track's chapter list and duration don't change (timeupdates must not rebuild this).
  const segments = useMemo(() => buildChapterSegments(chapters, duration), [chapters, duration])
  const segmented = !disabled && segments.length >= 2
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  /** True while a chapter title is showing, so a window listener can dismiss it past the bar. */
  const hoveringRef = useRef(false)
  const hoverTitleRef = useRef<string | null>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const [hover, setHover] = useState<ScrubHover | null>(null)

  useEffect(() => {
    if (!segmented) return
    console.info('[Player] chapter scrubber ready', {
      segments: segments.length,
      duration,
      titles: segments.map((s) => s.chapter?.title ?? '(lead-in)')
    })
  }, [segmented, segments, duration])

  // Measure after layout so gap math matches the painted bar (playback moves the thumb without a pointer event).
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el || !segmented) return
    const apply = (): void => {
      const next = el.clientWidth
      setTrackWidth((prev) => (prev === next ? prev : next))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [segmented])

  /** Read the chapter under the pointer and park the tooltip on that x. */
  const readHover = (clientX: number, rect: DOMRect): ScrubHover => {
    const timeSec = timeAtClientX(clientX, rect, segments, duration)
    const segmentIndex = segmentIndexAtTime(segments, timeSec)
    const title = segments[segmentIndex]?.chapter?.title ?? null
    const pointerX = Math.min(rect.width, Math.max(0, clientX - rect.left))
    // Half of the tooltip's max width, but never more than half the track.
    const half = Math.min(130, rect.width / 2)
    const tipX = Math.min(rect.width - half, Math.max(half, pointerX))
    return { timeSec, tipClientX: rect.left + tipX, trackTop: rect.top, title, segmentIndex }
  }

  const publishHover = (next: ScrubHover): void => {
    if (next.title !== hoverTitleRef.current) {
      hoverTitleRef.current = next.title
      console.info('[Player] chapter under scrubber', { title: next.title, timeSec: next.timeSec })
    }
    hoveringRef.current = true
    setHover(next)
  }

  const clearHover = (): void => {
    hoveringRef.current = false
    hoverTitleRef.current = null
    setHover(null)
  }

  // The title floats above the bar. Keep it while the pointer is in that band; drop it once they leave.
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (!hoveringRef.current || draggingRef.current) return
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      const overTooltip =
        e.clientX >= rect.left - 12 &&
        e.clientX <= rect.right + 12 &&
        e.clientY >= rect.top - 64 &&
        e.clientY <= rect.bottom + 16
      if (overTooltip) return
      console.info('[Player] chapter scrubber hover end')
      hoveringRef.current = false
      hoverTitleRef.current = null
      setHover(null)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || !segmented) return
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    const next = readHover(e.clientX, rect)
    publishHover(next)
    console.info('[Player] chapter scrub start', { title: next.title, timeSec: next.timeSec })
    onSeek(next.timeSec)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!segmented) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const next = readHover(e.clientX, rect)
    publishHover(next)
    // Hover previews the title; the playhead moves only while the button is down.
    if (draggingRef.current) onSeek(next.timeSec)
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const rect = trackRef.current?.getBoundingClientRect()
    const inside =
      rect != null &&
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    console.info('[Player] chapter scrub end', { timeSec: hover?.timeSec ?? null, stillInside: inside })
    if (!inside) clearHover()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled || !(duration > 0)) return
    const step = e.shiftKey ? 10 : 5
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(duration, currentTime + step)
    else if (e.key === 'ArrowLeft') next = Math.max(0, currentTime - step)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = duration
    if (next == null) return
    e.preventDefault()
    console.info('[Player] chapter scrubber key seek', { key: e.key, timeSec: next })
    onSeek(next)
  }

  if (!segmented) {
    return (
      <div className="relative flex h-4 min-w-0 flex-1 items-center">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={disabled}
          aria-label="Playback position"
          aria-valuetext={valueText}
          className="h-1 w-full disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: `linear-gradient(to right, var(--color-accent) ${
              duration > 0 ? (currentTime / duration) * 100 : 0
            }%, var(--color-border-bright) ${duration > 0 ? (currentTime / duration) * 100 : 0}%)`
          }}
        />
      </div>
    )
  }

  const gapCount = segments.length - 1
  const gapPx = segmentGapPx(segments.length, trackWidth)
  const playIndex = segmentIndexAtTime(segments, currentTime)
  // Until the first measure, lay the slices out by percentage so the bar isn't blank.
  const thumbLeft =
    trackWidth > 0
      ? timeToX(currentTime, playIndex, duration, trackWidth, gapPx, gapCount)
      : null

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
      aria-valuetext={valueText}
      aria-orientation="horizontal"
      className="relative h-7 min-w-0 flex-1 cursor-pointer touch-none select-none outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      {hover && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed z-30 flex w-max max-w-[260px] -translate-x-1/2 -translate-y-full flex-col items-center gap-0.5"
              style={{ left: hover.tipClientX, top: hover.trackTop - 6 }}
            >
              {hover.title ? (
                <span className="line-clamp-2 text-center text-[13px] font-semibold leading-snug text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_8px_rgba(0,0,0,0.65)]">
                  {hover.title}
                </span>
              ) : null}
              <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white">
                {fmtTime(hover.timeSec)}
              </span>
            </div>,
            document.body
          )
        : null}

      {segments.map((seg, index) => {
        const hot = hover?.segmentIndex === index
        const engaged = hover !== null
        const left =
          trackWidth > 0
            ? timeToX(seg.startSec, index, duration, trackWidth, gapPx, gapCount)
            : (seg.startSec / duration) * 100
        const width =
          trackWidth > 0
            ? Math.max(0, timeToX(seg.endSec, index, duration, trackWidth, gapPx, gapCount) - left)
            : ((seg.endSec - seg.startSec) / duration) * 100
        const unit = trackWidth > 0 ? 'px' : '%'
        const played = fillRatio(seg, currentTime)
        const preview = hover ? fillRatio(seg, hover.timeSec) : 0
        return (
          <div
            key={`${seg.startSec}-${seg.chapter?.title ?? 'lead'}`}
            className={`absolute top-1/2 -translate-y-1/2 overflow-hidden bg-white/20 transition-[height] duration-150 ease-out ${
              index === 0 ? 'rounded-l-full' : 'rounded-l-[1px]'
            } ${index === segments.length - 1 ? 'rounded-r-full' : 'rounded-r-[1px]'} ${
              hot ? 'h-2.5' : engaged ? 'h-1' : 'h-[3px]'
            }`}
            style={{ left: `${left}${unit}`, width: `${width}${unit}` }}
          >
            {/* Dimmer fill out to the pointer, then solid fill out to the playhead (YouTube's preview). */}
            {preview > 0 ? (
              <div
                className="absolute inset-y-0 left-0 bg-accent/45"
                style={{ width: `${preview * 100}%` }}
              />
            ) : null}
            {played > 0 ? (
              <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${played * 100}%` }} />
            ) : null}
          </div>
        )
      })}

      <div
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent shadow-[0_0_0_2px_rgba(232,168,73,0.25),0_2px_6px_rgba(0,0,0,0.4)] transition-transform duration-150 ${
          hover ? 'scale-110' : 'scale-100'
        }`}
        style={
          thumbLeft != null
            ? { left: `${thumbLeft}px` }
            : { left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }
        }
      />
    </div>
  )
}

type ChapterListButtonProps = {
  chapters: readonly MediaChapter[]
  currentTime: number
  onSeek: (chapter: MediaChapter) => void
}

/**
 * Current chapter title. Opens an upward list of every chapter; choosing one seeks.
 * Renders nothing when the file has no chapter list.
 */
export function ChapterListButton({
  chapters,
  currentTime,
  onSeek
}: ChapterListButtonProps): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = activeMediaChapter(chapters, currentTime)
  const activeRowRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setOpen(false)
  }, [chapters])

  useEffect(() => {
    if (!open) return
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
    const onDoc = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (chapters.length === 0) return null

  const label = active?.title ?? 'Chapters'

  return (
    <div ref={rootRef} className="relative min-w-0 max-w-[46%] shrink-0">
      <button
        type="button"
        className="block w-full truncate text-left text-[11px] leading-tight text-accent hover:text-accent-hover"
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={active ? `Chapters, current: ${active.title}` : 'Show chapters'}
        onClick={() => {
          setOpen((v) => {
            console.info('[Player] chapters menu', { open: !v, count: chapters.length })
            return !v
          })
        }}
      >
        {label}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Chapters"
          className="glass-panel absolute bottom-full right-0 z-30 mb-2 max-h-72 w-72 overflow-y-auto rounded-lg border border-border py-1 shadow-xl"
        >
          {chapters.map((ch) => {
            const selected = active?.startSec === ch.startSec && active.title === ch.title
            return (
              <button
                key={`${ch.startSec}-${ch.title}`}
                ref={selected ? activeRowRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[11px] leading-snug ${
                  selected
                    ? 'bg-accent-dim text-accent'
                    : 'text-text-secondary hover:bg-surface-raised hover:text-text'
                }`}
                onClick={() => {
                  console.info('[Player] chapter menu seek', { title: ch.title, startSec: ch.startSec })
                  onSeek(ch)
                  setOpen(false)
                }}
              >
                <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
                  {fmtTime(ch.startSec)}
                </span>
                <span className="min-w-0 flex-1">{ch.title}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
