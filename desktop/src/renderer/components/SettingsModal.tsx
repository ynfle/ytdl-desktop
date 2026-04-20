import { motion, AnimatePresence } from 'motion/react'
import { X, FolderOpen, HardDrive, RefreshCw } from 'lucide-react'

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
            className="fixed inset-0 bg-black/60 z-50"
            style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal panel */}
          <motion.div
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div
              className="pointer-events-auto w-full max-w-md glass-panel border border-border rounded-2xl overflow-hidden"
              style={{ boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-base font-bold tracking-tight">Settings</h2>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Content */}
              <div className="px-5 py-5 space-y-5">
                {/* Data directory section */}
                <div className="space-y-2.5">
                  <label className="flex items-center gap-2 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                    <HardDrive size={12} />
                    Data Directory
                  </label>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-bg border border-border">
                    <span className="flex-1 text-[11px] font-mono text-text-secondary truncate" title={dataDir}>
                      {dataDir || 'Not set'}
                    </span>
                    <button
                      onClick={onPickDir}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-surface-raised border border-border text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      <FolderOpen size={12} />
                      Choose&hellip;
                    </button>
                  </div>
                  <button
                    onClick={onRescan}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <RefreshCw size={11} />
                    Rescan library
                  </button>
                </div>

                {/* Divider */}
                <div className="border-t border-border" />

                {/* App info */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-text-muted font-medium">
                    ytdl desktop
                  </p>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    That folder is your data root: subscription lines live in{' '}
                    <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">channels.txt</code>,{' '}
                    <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">playlists.txt</code>, and{' '}
                    <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">podcasts.txt</code>. YouTube
                    channel, playlist, and ytrec jobs share{' '}
                    <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">downloaded.txt</code>; podcast
                    sync uses{' '}
                    <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">podcast-downloaded.txt</code>.
                    Media is written under{' '}
                    <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">videos/</code>, which the library
                    scans.
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
