import { useEffect, useState } from 'react'
import { Library, ListVideo, Mic2, Radio, Download, Settings } from 'lucide-react'
import { motion } from 'motion/react'

export type Page = 'library' | 'channels' | 'playlists' | 'podcasts' | 'downloads'

type Props = {
  activePage: Page
  onNavigate: (page: Page) => void
  onOpenSettings: () => void
  /** For main-column backdrop blur: must render outside the flex column so backdrop composites over <Player />. */
  onExpandedChange?: (expanded: boolean) => void
}

const NAV_ITEMS: { id: Page; label: string; icon: typeof Library }[] = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'playlists', label: 'Playlists', icon: ListVideo },
  { id: 'podcasts', label: 'Podcasts', icon: Mic2 },
  { id: 'downloads', label: 'Downloads', icon: Download }
]

/** Fixed 56px layout width; hover expands a frosted flyout over the main column (no flex reflow). */
export default function Sidebar({ activePage, onNavigate, onOpenSettings, onExpandedChange }: Props) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    console.info('[Sidebar] flyout expanded state', { expanded })
  }, [expanded])

  useEffect(() => {
    onExpandedChange?.(expanded)
  }, [expanded, onExpandedChange])

  return (
    <nav
      className="relative h-full w-14 shrink-0 overflow-visible z-30 select-none"
      aria-label="Main navigation"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Absolute panel: width animates here only — Player column width stays constant; stays sharp */}
      <motion.div
        className="absolute left-0 top-0 bottom-0 z-20 flex flex-col overflow-hidden border-r border-border bg-surface/95 shadow-lg"
        initial={false}
        animate={{ width: expanded ? 180 : 56 }}
        transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      >
        {/* Brand mark */}
        <div className="flex items-center h-14 px-3 gap-3 shrink-0">
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center text-bg font-bold text-[11px] shrink-0 tracking-tight"
            style={{
              background: 'linear-gradient(135deg, #e8a849 0%, #d4893a 100%)',
              boxShadow: '0 2px 8px rgba(232, 168, 73, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
            }}
          >
            yt
          </div>
          <span
            className="sidebar-label text-sm font-bold text-text truncate min-w-0"
            style={{ opacity: expanded ? 1 : 0 }}
          >
            ytdl
          </span>
        </div>

        {/* Navigation items */}
        <div className="flex-1 flex flex-col gap-0.5 py-2 px-2 min-h-0">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = activePage === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                className={`
                  relative flex items-center gap-3 h-10 rounded-lg px-3 text-left transition-all duration-150
                  ${active
                    ? 'text-accent'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised/50'}
                `}
              >
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-lg bg-accent-dim"
                    style={{ boxShadow: 'inset 0 0 12px rgba(232, 168, 73, 0.06)' }}
                    transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                  />
                )}
                <Icon size={18} strokeWidth={active ? 2.2 : 1.6} className="shrink-0 relative z-10" />
                <span
                  className="sidebar-label text-[13px] font-medium truncate relative z-10 min-w-0"
                  style={{ opacity: expanded ? 1 : 0 }}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mx-3 border-t border-border shrink-0" />

        <div className="px-2 py-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-3 h-10 rounded-lg px-3 text-text-muted hover:text-text-secondary hover:bg-surface-raised/50 transition-all duration-150 w-full"
          >
            <Settings size={18} strokeWidth={1.6} className="shrink-0" />
            <span
              className="sidebar-label text-[13px] font-medium truncate min-w-0"
              style={{ opacity: expanded ? 1 : 0 }}
            >
              Settings
            </span>
          </button>
        </div>
      </motion.div>
    </nav>
  )
}
