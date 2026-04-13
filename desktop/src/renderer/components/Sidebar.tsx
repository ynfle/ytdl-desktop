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
      className="sidebar-rail flex flex-col h-full bg-surface border-r border-border select-none"
      style={{ width: expanded ? 180 : 56 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo mark */}
      <div className="flex items-center h-14 px-3.5 gap-3 border-b border-border shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-bg font-bold text-sm shrink-0">
          yt
        </div>
        <span
          className="sidebar-label text-sm font-semibold text-text truncate"
          style={{ opacity: expanded ? 1 : 0 }}
        >
          ytdl
        </span>
      </div>

      {/* Navigation items */}
      <div className="flex-1 flex flex-col gap-1 py-3 px-2">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activePage === id
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`
                flex items-center gap-3 h-10 rounded-lg px-3 text-left transition-colors duration-150
                ${active
                  ? 'bg-accent-dim text-accent'
                  : 'text-text-secondary hover:text-text hover:bg-surface-raised'}
              `}
            >
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
              <span
                className="sidebar-label text-[13px] font-medium truncate"
                style={{ opacity: expanded ? 1 : 0 }}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Settings at bottom */}
      <div className="px-2 pb-3">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-3 h-10 rounded-lg px-3 text-text-secondary hover:text-text hover:bg-surface-raised transition-colors duration-150 w-full"
        >
          <Settings size={18} strokeWidth={1.8} className="shrink-0" />
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
