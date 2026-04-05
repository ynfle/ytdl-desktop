import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Play, Plus, Film } from 'lucide-react'
import type { LibraryVideoGroup } from '../hooks/useLibrary'
import { parseLibraryRelPath } from '../hooks/useLibrary'

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
  isEmpty: boolean
}

/** Library page: channel-grouped video cards with click-to-queue and double-click-to-play. */
export default function LibraryPage({ groups, currentRel, onQueue, onPlayFrom, isEmpty }: Props) {
  /** Total video count badge. */
  const totalVideos = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups])

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
        <Film size={48} strokeWidth={1.2} className="opacity-40" />
        <p className="text-lg font-medium">No videos yet</p>
        <p className="text-sm text-text-muted max-w-xs text-center">
          Choose a data folder and download some channels to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-bold">Library</h1>
        <span className="text-xs font-mono text-text-muted bg-surface-raised px-2 py-0.5 rounded-full">
          {totalVideos} video{totalVideos !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Scrollable channel groups */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {groups.map((group, gi) => (
          <motion.div
            key={group.groupKey}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(gi * 0.04, 0.4) }}
            className="rounded-xl border border-border bg-surface overflow-hidden"
          >
            {/* Sticky channel header */}
            <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-surface-raised/80 backdrop-blur-sm border-b border-border">
              {group.logoUrl ? (
                <img
                  className="w-8 h-8 rounded-full object-cover border border-border shrink-0"
                  src={group.logoUrl}
                  alt=""
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-surface-overlay border border-border shrink-0" />
              )}
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
                      group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors duration-100
                      ${isActive ? 'now-playing-glow bg-accent-dim/40' : 'hover:bg-surface-raised'}
                    `}
                    onClick={() => onQueue(item.relPath)}
                    onDoubleClick={() => onPlayFrom(item.relPath)}
                    title={item.relPath}
                  >
                    {/* Play indicator or queue icon on hover */}
                    <div className="w-5 shrink-0 flex items-center justify-center">
                      {isActive ? (
                        <Play size={14} className="text-accent fill-accent" />
                      ) : (
                        <Plus
                          size={14}
                          className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      )}
                    </div>

                    <span
                      className={`flex-1 text-xs font-mono truncate ${isActive ? 'text-accent' : 'text-text'}`}
                    >
                      {fileName}
                    </span>
                    <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                      {relativeTime(item.mtimeMs)}
                    </span>
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
