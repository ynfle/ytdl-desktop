import { motion, AnimatePresence } from 'motion/react'
import { X, FolderOpen, HardDrive } from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
  dataDir: string
  onPickDir: () => void
  onRescan: () => void
  busy: boolean
}

/** Settings modal with data directory picker and app info. */
export default function SettingsModal({ open, onClose, dataDir, onPickDir, onRescan, busy }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal panel */}
          <motion.div
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <div
              className="pointer-events-auto w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-base font-bold">Settings</h2>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Content */}
              <div className="px-5 py-5 space-y-5">
                {/* Data directory section */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    <HardDrive size={13} />
                    Data Directory
                  </label>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-bg border border-border">
                    <span className="flex-1 text-xs font-mono text-text truncate" title={dataDir}>
                      {dataDir || 'Not set'}
                    </span>
                    <button
                      onClick={onPickDir}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-surface-raised border border-border text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      <FolderOpen size={13} />
                      Choose…
                    </button>
                  </div>
                  <button
                    onClick={onRescan}
                    disabled={busy}
                    className="text-xs text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Rescan library
                  </button>
                </div>

                {/* Divider */}
                <div className="border-t border-border" />

                {/* App info */}
                <div className="space-y-1">
                  <p className="text-[11px] text-text-muted">
                    ytdl desktop — Electron + React
                  </p>
                  <p className="text-[11px] text-text-muted">
                    Data and downloads are stored in the directory above. Channels are read from{' '}
                    <code className="font-mono text-text-secondary">channels.txt</code> in that folder.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
