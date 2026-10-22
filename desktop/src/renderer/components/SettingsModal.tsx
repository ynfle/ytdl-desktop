import { useEffect, useId, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, FolderOpen, HardDrive, Loader2, RefreshCw } from 'lucide-react'
import { iconCloseButtonClass } from './subscription-page-ui'

type Props = {
  open: boolean
  onClose: () => void
  dataDir: string
  onPickDir: () => void
  onRescan: () => void
  busy: boolean
  /** Inline data-directory pick/set failure (rendered under the path row). */
  error?: string | null
  /** True while Rescan library runs (button disabled + spinner). */
  rescanning?: boolean
}

/** Selector for elements the focus trap cycles through inside the panel. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Settings modal with data directory picker and app info. */
export default function SettingsModal({
  open,
  onClose,
  dataDir,
  onPickDir,
  onRescan,
  busy,
  error = null,
  rescanning = false
}: Props) {
  /** Dialog panel root; focus is moved here on open and trapped inside. */
  const panelRef = useRef<HTMLDivElement>(null)
  /** Initial focus target when the dialog opens. */
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  /** Stable id linking the heading to `aria-labelledby`. */
  const titleId = useId()
  /** Latest `onClose` so the key listener does not re-bind (and re-steal focus) when the parent re-renders. */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  /** While open: Escape closes, Tab/Shift+Tab cycle within the panel; restore prior focus on close. */
  useEffect(() => {
    if (!open) return
    // Remember who had focus so we can hand it back on close.
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    console.info('[Settings] dialog opened, moving focus into panel')
    // Defer one frame so the motion panel is mounted before focusing.
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus()
    })

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        console.info('[Settings] Escape → close')
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement
      // Wrap at the ends; also pull focus back in if it escaped the panel.
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused && document.contains(previouslyFocused)) {
        console.info('[Settings] dialog closed, restoring focus')
        previouslyFocused.focus()
      }
    }
  }, [open])

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
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="pointer-events-auto w-full max-w-md glass-panel border border-border rounded-2xl overflow-hidden"
              style={{ boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 id={titleId} className="text-base font-bold tracking-tight">Settings</h2>
                <button
                  ref={closeBtnRef}
                  type="button"
                  onClick={onClose}
                  aria-label="Close settings"
                  className={iconCloseButtonClass}
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
                      type="button"
                      onClick={onPickDir}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-surface-raised border border-border text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      <FolderOpen size={12} />
                      Choose&hellip;
                    </button>
                  </div>
                  {/* Inline pick/set failure (also written to the sync log by App) */}
                  {error && (
                    <p role="alert" className="text-[11px] text-danger leading-relaxed">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={onRescan}
                    disabled={busy || rescanning}
                    aria-busy={rescanning}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {rescanning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {rescanning ? 'Rescanning\u2026' : 'Rescan library'}
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
                    Delete confirmation uses the{' '}
                    <a
                      href="https://rareui.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline hover:text-accent-hover"
                      onClick={() => {
                        console.info('[Settings] open Rare UI credit', 'https://rareui.com')
                      }}
                    >
                      Rare UI
                    </a>{' '}
                    delete button. Copyright (c) 2026 Swami Malode.
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
