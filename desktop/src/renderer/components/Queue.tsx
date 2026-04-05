import { motion, AnimatePresence } from 'motion/react'
import { X, Play, Trash2, ListMusic } from 'lucide-react'
import { parseLibraryRelPath } from '../hooks/useLibrary'

type Props = {
  open: boolean
  onClose: () => void
  queue: string[]
  currentRel: string | null
  onPlayFromIndex: (index: number) => void
  onRemove: (index: number) => void
}

/** Slide-out queue drawer from the right edge. */
export default function QueueDrawer({ open, onClose, queue, currentRel, onPlayFromIndex, onRemove }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            className="fixed top-0 right-0 bottom-0 w-80 bg-surface border-l border-border z-50 flex flex-col shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <ListMusic size={16} className="text-accent" />
                <h2 className="text-sm font-semibold">Queue</h2>
                <span className="text-[11px] text-text-muted">
                  {queue.length} item{queue.length !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Queue list */}
            <div className="flex-1 overflow-y-auto">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted">
                  <ListMusic size={32} strokeWidth={1.2} className="opacity-30" />
                  <p className="text-xs">Queue is empty</p>
                  <p className="text-[11px] text-text-muted">Click files in the library to add</p>
                </div>
              ) : (
                <ul>
                  {queue.map((rel, index) => {
                    const { fileName } = parseLibraryRelPath(rel)
                    const isActive = rel === currentRel
                    return (
                      <motion.li
                        key={`${rel}-${index}`}
                        layout
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className={`
                          group flex items-center gap-2 px-4 py-2.5 border-b border-border cursor-pointer transition-colors
                          ${isActive ? 'bg-accent-dim/40' : 'hover:bg-surface-raised'}
                        `}
                        onDoubleClick={() => onPlayFromIndex(index)}
                      >
                        <div className="w-5 shrink-0 flex items-center justify-center">
                          {isActive ? (
                            <Play size={12} className="text-accent fill-accent" />
                          ) : (
                            <span className="text-[11px] text-text-muted tabular-nums">{index + 1}</span>
                          )}
                        </div>
                        <span
                          className={`flex-1 text-xs font-mono truncate ${isActive ? 'text-accent' : 'text-text'}`}
                          title={rel}
                        >
                          {fileName}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemove(index)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-muted hover:text-danger transition-all"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </motion.li>
                    )
                  })}
                </ul>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
