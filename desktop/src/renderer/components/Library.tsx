import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Play, Plus, Film, Trash2 } from 'lucide-react'
import type { LibraryVideoGroup } from '../hooks/useLibrary'
import { parseLibraryRelPath } from '../hooks/useLibrary'
import { MediaThumbSlot } from './MediaThumbSlot'
import { ChannelAvatar } from './ChannelAvatar'

/** Human-friendly relative time label. */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

type Props = {
  groups: LibraryVideoGroup[]
  currentRel: string | null
  onQueue: (relPath: string) => void
  onPlayFrom: (relPath: string) => void
  /** Remove file from disk (caller confirms). */
  onDelete: (relPath: string) => void
  isEmpty: boolean
}

/** Library page: channel-grouped video cards with click-to-queue and double-click-to-play. */
export default function LibraryPage({
  groups,
  currentRel,
  onQueue,
  onPlayFrom,
  onDelete,
  isEmpty
}: Props) {
  /** Total video count badge. */
  const totalVideos = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups])

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-text-muted px-8">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(232, 168, 73, 0.08) 0%, rgba(232, 168, 73, 0.02) 100%)',
            border: '1px solid rgba(232, 168, 73, 0.1)'
          }}
        >
          <Film size={32} strokeWidth={1.2} className="text-accent/50" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-semibold text-text-secondary">No videos yet</p>
          <p className="text-sm text-text-muted max-w-xs leading-relaxed">
            Choose a data folder and download some channels to get started.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-bold tracking-tight">Library</h1>
        <span className="section-pill">
          {totalVideos} video{totalVideos !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Scrollable channel groups */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {groups.map((group, gi) => (
          <motion.div
            key={group.groupKey}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(gi * 0.04, 0.4), ease: [0.22, 0.61, 0.36, 1] }}
            className="card-interactive rounded-xl border border-border bg-surface overflow-hidden"
          >
            {/* Sticky channel header */}
            <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-surface-raised/80 backdrop-blur-md border-b border-border">
              <ChannelAvatar src={group.logoUrl} name={group.title} size="md" />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate">{group.title}</span>
                <span className="text-[11px] text-text-muted">
                  {group.items.length} file{group.items.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* File list */}
            <ul className="divide-y divide-border">
              {group.items.map((item) => {
                const { fileName } = parseLibraryRelPath(item.relPath)
                const isActive = item.relPath === currentRel
                return (
                  <li
                    key={item.relPath}
                    className={`
                      group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all duration-120
                      ${isActive ? 'now-playing-glow bg-accent-dim/30' : 'hover:bg-surface-raised/60'}
                    `}
                    onClick={() => onQueue(item.relPath)}
                    onDoubleClick={() => onPlayFrom(item.relPath)}
                    title={item.relPath}
                  >
                    <MediaThumbSlot
                      thumbRelPath={item.thumbRelPath}
                      fallbackImageUrl={group.logoUrl}
                      widthClassName="w-20"
                      showPlayOverlay={!isActive}
                      isActive={isActive}
                    />
                    {/* Play indicator or queue icon */}
                    <div className="w-5 shrink-0 flex items-center justify-center">
                      {isActive ? (
                        <Play size={13} className="text-accent fill-accent" />
                      ) : (
                        <Plus
                          size={13}
                          className="text-text-muted opacity-0 group-hover:opacity-70 transition-opacity duration-150"
                        />
                      )}
                    </div>

                    <span
                      className={`flex-1 text-[11px] font-mono truncate leading-tight ${isActive ? 'text-accent' : 'text-text-secondary group-hover:text-text'}`}
                    >
                      {fileName}
                    </span>
                    <span className="text-[10px] text-text-muted tabular-nums shrink-0 font-mono">
                      {relativeTime(item.mtimeMs)}
                    </span>
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        void onDelete(item.relPath)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger-dim transition-all shrink-0"
                      title="Delete from library"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
