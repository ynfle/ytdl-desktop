import type { ReactElement } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Play, Trash2, ListMusic } from 'lucide-react'
import { parseLibraryRelPath } from '../hooks/useLibrary'
import { MediaThumbSlot } from './MediaThumbSlot'

type PlaylistRow = { relPath: string; playlistIndex: number }
type StagingRow = { relPath: string; index: number }

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
  thumbByRel: ReadonlyMap<string, string | null>
}

function QueueRow({
  relPath,
  rank,
  isActive,
  thumbRel,
  onDoubleClick,
  onRemove
}: {
  relPath: string
  rank: number
  isActive: boolean
  thumbRel: string | null
  onDoubleClick: () => void
  onRemove: () => void
}): ReactElement {
  const { fileName } = parseLibraryRelPath(relPath)
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      className={`
        group flex items-center gap-2.5 px-4 py-2.5 border-b border-border cursor-pointer transition-all duration-120
        ${isActive ? 'bg-accent-dim/30 now-playing-glow' : 'hover:bg-surface-raised/60'}
      `}
      onDoubleClick={onDoubleClick}
    >
      <MediaThumbSlot
        thumbRelPath={thumbRel}
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
        className={`flex-1 text-[11px] font-mono truncate leading-tight ${isActive ? 'text-accent' : 'text-text-secondary group-hover:text-text'}`}
        title={relPath}
      >
        {fileName}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger-dim transition-all"
        title="Remove"
      >
        <Trash2 size={11} />
      </button>
    </motion.li>
  )
}

/** Section divider with label. */
function SectionLabel({ label, extra }: { label: string; extra?: string }): ReactElement {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-raised/40 backdrop-blur-sm">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-text-muted">{label}</span>
      {extra && <span className="text-[9px] text-text-muted/60 ml-auto">{extra}</span>}
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
          />

          {/* Drawer panel */}
          <motion.aside
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
                  <ListMusic size={13} className="text-accent" />
                </div>
                <h2 className="text-sm font-semibold">Play queue</h2>
                {totalCount > 0 && (
                  <span className="section-pill">{totalCount}</span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {totalCount === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted px-6">
                  <div className="w-14 h-14 rounded-xl bg-surface-overlay/60 flex items-center justify-center">
                    <ListMusic size={24} strokeWidth={1.2} className="text-text-muted/40" />
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
                    {stagingItems.map((row, si) => (
                      <QueueRow
                        key={`st-${row.relPath}-${row.index}`}
                        relPath={row.relPath}
                        rank={si + 1}
                        isActive={row.relPath === currentRel}
                        thumbRel={thumbByRel.get(row.relPath) ?? null}
                        onDoubleClick={() => onPlayStagingIndex(row.index)}
                        onRemove={() => onRemoveStagingIndex(row.index)}
                      />
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {queued.length > 0 && (
                    <>
                      <SectionLabel label="Queue" extra={`${queued.length}`} />
                      <ul>
                        {queued.map((row, i) => (
                          <QueueRow
                            key={`q-${row.relPath}-${row.playlistIndex}`}
                            relPath={row.relPath}
                            rank={i + 1}
                            isActive={row.relPath === currentRel}
                            thumbRel={thumbByRel.get(row.relPath) ?? null}
                            onDoubleClick={() => onPlayPlaylistIndex(row.playlistIndex)}
                            onRemove={() => onRemovePlaylistIndex(row.playlistIndex)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  <SectionLabel
                    label="Up next"
                    extra={upNext.length > 0 ? `${upNext.length}` : undefined}
                  />
                  {upNext.length === 0 ? (
                    <p className="px-4 py-4 text-[11px] text-text-muted">No upcoming videos from the library</p>
                  ) : (
                    <ul>
                      {upNext.map((row, i) => (
                        <QueueRow
                          key={`up-${row.relPath}-${row.playlistIndex}`}
                          relPath={row.relPath}
                          rank={i + 1}
                          isActive={row.relPath === currentRel}
                          thumbRel={thumbByRel.get(row.relPath) ?? null}
                          onDoubleClick={() => onPlayPlaylistIndex(row.playlistIndex)}
                          onRemove={() => onRemovePlaylistIndex(row.playlistIndex)}
                        />
                      ))}
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
