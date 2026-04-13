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
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={`
        group flex items-center gap-2 px-4 py-2.5 border-b border-border cursor-pointer transition-colors
        ${isActive ? 'bg-accent-dim/40' : 'hover:bg-surface-raised'}
      `}
      onDoubleClick={onDoubleClick}
    >
      <MediaThumbSlot thumbRelPath={thumbRel} boxClassName="h-9 w-9" />
      <div className="w-5 shrink-0 flex items-center justify-center">
        {isActive ? (
          <Play size={12} className="text-accent fill-accent" />
        ) : (
          <span className="text-[11px] text-text-muted tabular-nums">{rank}</span>
        )}
      </div>
      <span
        className={`flex-1 text-xs font-mono truncate ${isActive ? 'text-accent' : 'text-text'}`}
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
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-muted hover:text-danger transition-all"
        title="Remove"
      >
        <Trash2 size={12} />
      </button>
    </motion.li>
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
          <motion.div
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.aside
            className="fixed top-0 right-0 bottom-0 w-80 bg-surface border-l border-border z-50 flex flex-col shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <ListMusic size={16} className="text-accent" />
                <h2 className="text-sm font-semibold">Play queue</h2>
                <span className="text-[11px] text-text-muted">
                  {totalCount} item{totalCount !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {totalCount === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted px-4">
                  <ListMusic size={32} strokeWidth={1.2} className="opacity-30" />
                  <p className="text-xs">Nothing lined up</p>
                  <p className="text-[11px] text-text-muted text-center">
                    Click files in the library to queue, or double-click to play from there
                  </p>
                </div>
              ) : drawerMode === 'staging' ? (
                <div>
                  <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted border-b border-border bg-surface-raised/50">
                    Queue
                  </div>
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
                      <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted border-b border-border bg-surface-raised/50">
                        Queue
                      </div>
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
                  <div
                    className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted border-b border-border bg-surface-raised/50 ${
                      queued.length > 0 ? 'border-t' : ''
                    }`}
                  >
                    Up next
                  </div>
                  {upNext.length === 0 ? (
                    <p className="px-4 py-3 text-[11px] text-text-muted">No upcoming videos from the library</p>
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
