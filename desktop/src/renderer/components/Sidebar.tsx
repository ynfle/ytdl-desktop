import { useState } from 'react'
import { Library, ListVideo, Mic2, Radio, Download, Settings } from 'lucide-react'
import { motion } from 'motion/react'

export type Page = 'library' | 'channels' | 'playlists' | 'podcasts' | 'downloads'

type Props = {
  activePage: Page
  onNavigate: (page: Page) => void
  onOpenSettings: () => void
}

const NAV_ITEMS: { id: Page; label: string; icon: typeof Library }[] = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'playlists', label: 'Playlists', icon: ListVideo },
  { id: 'podcasts', label: 'Podcasts', icon: Mic2 },
  { id: 'downloads', label: 'Downloads', icon: Download }
]

/** Left navigation rail -- collapses to 56px icons, expands on hover to show labels. */
export default function Sidebar({ activePage, onNavigate, onOpenSettings }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.nav
      className="sidebar-rail flex flex-col h-full bg-surface select-none border-r border-border"
      style={{ width: expanded ? 180 : 56 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
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
          className="sidebar-label text-sm font-bold text-text truncate"
          style={{ opacity: expanded ? 1 : 0 }}
        >
          ytdl
        </span>
      </div>

      {/* Navigation items */}
      <div className="flex-1 flex flex-col gap-0.5 py-2 px-2">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activePage === id
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`
                relative flex items-center gap-3 h-10 rounded-lg px-3 text-left transition-all duration-150
                ${active
                  ? 'text-accent'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised/50'}
              `}
            >
              {/* Active indicator bar */}
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
                className="sidebar-label text-[13px] font-medium truncate relative z-10"
                style={{ opacity: expanded ? 1 : 0 }}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Separator */}
      <div className="mx-3 border-t border-border" />

      {/* Settings at bottom */}
      <div className="px-2 py-2">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-3 h-10 rounded-lg px-3 text-text-muted hover:text-text-secondary hover:bg-surface-raised/50 transition-all duration-150 w-full"
        >
          <Settings size={18} strokeWidth={1.6} className="shrink-0" />
          <span
            className="sidebar-label text-[13px] font-medium truncate"
            style={{ opacity: expanded ? 1 : 0 }}
          >
            Settings
          </span>
        </button>
      </div>
    </motion.nav>
  )
}
