import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Play, ListMusic } from 'lucide-react'
import { humanizeRestrictFilename } from '../../../shared/humanize-restrict-filename'
import { parseLibraryRelPath } from '../hooks/useLibrary'
import { MediaThumbSlot } from './MediaThumbSlot'
import { RowDeleteButton } from './ui/row-delete-button'
import { iconCloseButtonClass } from './subscription-page-ui'

type PlaylistRow = { relPath: string; playlistIndex: number }
type StagingRow = { relPath: string; index: number }

type ThumbSlotByRel = ReadonlyMap<
  string,
  { thumbRelPath: string | null; fallbackImageUrl: string | null; displayTitle: string }
>

type Props = {
  open: boolean
  onClose: () => void
  currentRel: string | null
  /** `staging`: only {@link stagingItems}; `playlist`: {@link queued} then {@link upNext} in the UI. */
  drawerMode: 'staging' | 'playlist'
  upNext: readonly PlaylistRow[]
  queued: readonly PlaylistRow[]
  stagingItems: readonly StagingRow[]
  onPlayPlaylistIndex: (playlistIndex: number) => void
  onPlayStagingIndex: (index: number) => void
  onRemovePlaylistIndex: (playlistIndex: number) => void
  onRemoveStagingIndex: (index: number) => void
  thumbByRel: ThumbSlotByRel
}

/** One drawer row: double-click or Enter plays from here; trailing control removes (confirmed). */
function QueueRow({
  relPath,
  rank,
  isActive,
  thumbRelPath,
  fallbackImageUrl,
  displayTitle,
  onDoubleClick,
  onRemove
}: {
  relPath: string
  rank: number
  isActive: boolean
  thumbRelPath: string | null
  fallbackImageUrl: string | null
  displayTitle: string
  onDoubleClick: () => void
  onRemove: () => void
}): ReactElement {
  /** Enter on the focused row plays it (same as double-click). */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLLIElement>): void => {
    // Ignore keys from the nested delete control.
    if (e.target !== e.currentTarget) return
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      console.info('[Queue] row Enter → play', relPath)
      onDoubleClick()
    }
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      className={`
        group flex items-center gap-2.5 px-4 py-2.5 border-b border-border cursor-pointer transition-all duration-120
        outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60
        ${isActive ? 'bg-accent-dim/30 now-playing-glow' : 'hover:bg-surface-raised/60 focus-visible:bg-surface-raised/60'}
      `}
      tabIndex={0}
      role="button"
      aria-label={isActive ? `${displayTitle} (now playing)` : `${rank}. ${displayTitle}`}
      aria-current={isActive ? 'true' : undefined}
      title={`${displayTitle}\nDouble-click or Enter to play from here`}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <MediaThumbSlot
        thumbRelPath={thumbRelPath}
        fallbackImageUrl={fallbackImageUrl}
        widthClassName="w-16"
        isActive={isActive}
      />
      <div className="w-5 shrink-0 flex items-center justify-center">
        {isActive ? (
          <Play size={11} className="text-accent fill-accent" />
        ) : (
          <span className="text-[10px] text-text-muted tabular-nums font-mono">{rank}</span>
        )}
      </div>
      <span
        className={`flex-1 min-w-0 text-[11px] truncate leading-tight ${isActive ? 'text-accent' : 'text-text-secondary group-hover:text-text group-focus-visible:text-text'}`}
      >
        {displayTitle}
      </span>
      <RowDeleteButton
        label={relPath}
        onConfirm={() => {
          console.info('[Queue] remove confirmed', relPath)
          onRemove()
        }}
      />
    </motion.li>
  )
}

/** Section divider with label. */
function SectionLabel({ label, extra }: { label: string; extra?: string }): ReactElement {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-raised/40 backdrop-blur-sm">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-text-muted">{label}</span>
      {extra && <span className="text-[9px] text-text-muted ml-auto tabular-nums">{extra}</span>}
    </div>
  )
}

/** Slide-out drawer: **Queue** (click-to-add) first, then **Up next** (library order). */
export default function QueueDrawer({
  open,
  onClose,
  currentRel,
  drawerMode,
  upNext,
  queued,
  stagingItems,
  onPlayPlaylistIndex,
  onPlayStagingIndex,
  onRemovePlaylistIndex,
  onRemoveStagingIndex,
  thumbByRel
}: Props): ReactElement {
  const totalCount =
    drawerMode === 'staging' ? stagingItems.length : upNext.length + queued.length
  /** Header close button; receives focus when the drawer opens. */
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  /** Latest `onClose` so the Escape listener does not re-bind on every parent render. */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // While open: Escape closes; focus moves to the close button and returns to the opener on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const raf = requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true })
      console.info('[Queue] drawer opened; focus → close button')
    })
    const onKeyDown = (e: KeyboardEvent): void => {
      // Nested controls (e.g. delete confirm) stop propagation when they consume Escape.
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      console.info('[Queue] Escape → close drawer')
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      // Return focus to whatever opened the drawer (e.g. the queue toggle) if it is still mounted.
      if (opener && opener.isConnected) {
        opener.focus({ preventScroll: true })
        console.info('[Queue] drawer closed; focus restored to opener')
      }
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />

          {/* Drawer panel */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Play queue"
            className="fixed top-0 right-0 bottom-0 w-80 glass-panel border-l border-border z-50 flex flex-col"
            style={{ boxShadow: '-8px 0 40px rgba(0, 0, 0, 0.4)' }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-accent-dim flex items-center justify-center">
                  <ListMusic size={13} className="text-accent" aria-hidden />
                </div>
                <h2 className="text-sm font-semibold">Play queue</h2>
                {totalCount > 0 && (
                  <span className="section-pill">{totalCount}</span>
                )}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className={`${iconCloseButtonClass} outline-none focus-visible:ring-2 focus-visible:ring-accent/60`}
                aria-label="Close play queue"
                title="Close (Esc)"
              >
                <X size={14} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {totalCount === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted px-6">
                  {/* Inline size: `.empty-state-icon` is unlayered CSS, so w-/h- utilities would not override it. */}
                  <div className="empty-state-icon" style={{ width: '3.5rem', height: '3.5rem' }}>
                    <ListMusic size={24} strokeWidth={1.2} className="text-accent/50" aria-hidden />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-xs font-medium text-text-secondary">Nothing lined up</p>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      Click files in the library to queue, or double-click to play from there
                    </p>
                  </div>
                </div>
              ) : drawerMode === 'staging' ? (
                <div>
                  <SectionLabel label="Queue" extra={`${stagingItems.length} item${stagingItems.length !== 1 ? 's' : ''}`} />
                  <ul>
                    {stagingItems.map((row, si) => {
                      const slot = thumbByRel.get(row.relPath) ?? {
                        thumbRelPath: null,
                        fallbackImageUrl: null,
                        displayTitle: humanizeRestrictFilename(
                          parseLibraryRelPath(row.relPath).fileName
                        )
                      }
                      return (
                        <QueueRow
                          key={`st-${row.relPath}-${row.index}`}
                          relPath={row.relPath}
                          rank={si + 1}
                          isActive={row.relPath === currentRel}
                          thumbRelPath={slot.thumbRelPath}
                          fallbackImageUrl={slot.fallbackImageUrl}
                          displayTitle={slot.displayTitle}
                          onDoubleClick={() => onPlayStagingIndex(row.index)}
                          onRemove={() => onRemoveStagingIndex(row.index)}
                        />
                      )
                    })}
                  </ul>
                </div>
              ) : (
                <>
                  {queued.length > 0 && (
                    <>
                      <SectionLabel label="Queue" extra={`${queued.length}`} />
                      <ul>
                        {queued.map((row, i) => {
                          const slot = thumbByRel.get(row.relPath) ?? {
                            thumbRelPath: null,
                            fallbackImageUrl: null,
                            displayTitle: humanizeRestrictFilename(
                              parseLibraryRelPath(row.relPath).fileName
                            )
                          }
                          return (
                            <QueueRow
                              key={`q-${row.relPath}-${row.playlistIndex}`}
                              relPath={row.relPath}
                              rank={i + 1}
                              isActive={row.relPath === currentRel}
                              thumbRelPath={slot.thumbRelPath}
                              fallbackImageUrl={slot.fallbackImageUrl}
                              displayTitle={slot.displayTitle}
                              onDoubleClick={() => onPlayPlaylistIndex(row.playlistIndex)}
                              onRemove={() => onRemovePlaylistIndex(row.playlistIndex)}
                            />
                          )
                        })}
                      </ul>
                    </>
                  )}
                  <SectionLabel
                    label="Up next"
                    extra={upNext.length > 0 ? `${upNext.length}` : undefined}
                  />
                  {upNext.length === 0 ? (
                    <p className="px-4 py-4 text-[11px] text-text-muted">No upcoming items from the library</p>
                  ) : (
                    <ul>
                      {upNext.map((row, i) => {
                        const slot = thumbByRel.get(row.relPath) ?? {
                          thumbRelPath: null,
                          fallbackImageUrl: null,
                          displayTitle: humanizeRestrictFilename(
                            parseLibraryRelPath(row.relPath).fileName
                          )
                        }
                        return (
                          <QueueRow
                            key={`up-${row.relPath}-${row.playlistIndex}`}
                            relPath={row.relPath}
                            rank={i + 1}
                            isActive={row.relPath === currentRel}
                            thumbRelPath={slot.thumbRelPath}
                            fallbackImageUrl={slot.fallbackImageUrl}
                            displayTitle={slot.displayTitle}
                            onDoubleClick={() => onPlayPlaylistIndex(row.playlistIndex)}
                            onRemove={() => onRemovePlaylistIndex(row.playlistIndex)}
                          />
                        )
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
