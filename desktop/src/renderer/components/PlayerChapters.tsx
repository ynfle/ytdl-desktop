import { useEffect, useRef, useState, type ChangeEvent } from 'react'
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

type ChapterScrubberProps = {
  chapters: readonly MediaChapter[]
  currentTime: number
  duration: number
  disabled: boolean
  valueText: string
  onScrub: (e: ChangeEvent<HTMLInputElement>) => void
  /** Jump the playhead to a chapter start (tick click). */
  onSeekChapter: (chapter: MediaChapter) => void
}

/**
 * Seek slider with a tick at each chapter start (the opening chapter sits on 0:00, so it has no tick).
 */
export function ChapterScrubber({
  chapters,
  currentTime,
  duration,
  disabled,
  valueText,
  onScrub,
  onSeekChapter
}: ChapterScrubberProps): React.ReactElement {
  const active = activeMediaChapter(chapters, currentTime)
  const showTicks = !disabled && duration > 0 && chapters.length > 1

  return (
    <div className="relative flex h-4 min-w-0 flex-1 items-center">
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={onScrub}
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
      {showTicks ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-full">
          {chapters.map((ch) => {
            const pct = (ch.startSec / duration) * 100
            // Skip the ends: a tick on 0:00 or the last sample fights the thumb.
            if (pct <= 0.6 || pct >= 99.4) return null
            const isActive = active?.startSec === ch.startSec
            return (
              <button
                key={`${ch.startSec}-${ch.title}`}
                type="button"
                title={`${fmtTime(ch.startSec)} ${ch.title}`}
                aria-label={`Seek to ${ch.title} (${fmtTime(ch.startSec)})`}
                className="pointer-events-auto absolute top-0 flex h-full w-3 -translate-x-1/2 items-center justify-center"
                style={{ left: `${pct}%` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  console.info('[Player] chapter tick', { title: ch.title, startSec: ch.startSec })
                  onSeekChapter(ch)
                }}
              >
                <span
                  className={`block h-2 w-px ${isActive ? 'bg-accent' : 'bg-text/70'}`}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>
      ) : null}
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
