import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Download, ListVideo, Mic2, Tv, Loader2, Terminal } from 'lucide-react'

type Props = {
  busy: boolean
  channelsBusy: boolean
  podcastsBusy: boolean
  playlistsBusy: boolean
  log: string
  ytrecCount: number
  onYtrecCountChange: (n: number) => void
  onRunChannels: () => void
  onRunPlaylists: () => void
  onRunYtrec: () => void
  onRunPodcasts: () => void
}

type ActionCardProps = {
  icon: React.ReactNode
  title: string
  description: string
  disabled: boolean
  onClick: () => void
  /** Optional extra content in the top-right area. */
  topRight?: React.ReactNode
  /** Stagger delay for entrance animation. */
  delay: number
}

/** Individual download action card with hover shimmer. */
function ActionCard({ icon, title, description, disabled, onClick, topRight, delay }: ActionCardProps) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.22, 0.61, 0.36, 1] }}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      disabled={disabled}
      onClick={onClick}
      className="card-interactive flex flex-col items-start gap-3 p-4 rounded-xl border border-border bg-surface disabled:opacity-35 disabled:cursor-not-allowed text-left"
    >
      <div className="flex items-center justify-between w-full">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(232, 168, 73, 0.12) 0%, rgba(232, 168, 73, 0.04) 100%)',
            boxShadow: 'inset 0 1px 0 rgba(232, 168, 73, 0.08)'
          }}
        >
          {icon}
        </div>
        {topRight}
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{description}</p>
      </div>
    </motion.button>
  )
}

/** Downloads page: action cards for channel sync + ytrec, with live log terminal. */
export default function DownloadsPage({
  busy,
  channelsBusy,
  podcastsBusy,
  playlistsBusy,
  log,
  ytrecCount,
  onYtrecCountChange,
  onRunChannels,
  onRunPlaylists,
  onRunYtrec,
  onRunPodcasts
}: Props) {
  const anyBusy = busy || channelsBusy || podcastsBusy || playlistsBusy
  const logRef = useRef<HTMLPreElement>(null)

  /** Auto-scroll log to bottom. */
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">Downloads</h1>
          {busy && (
            <span className="inline-flex items-center gap-1.5 text-xs text-accent">
              <Loader2 size={12} className="animate-spin" />
              <span className="font-medium">Syncing</span>
            </span>
          )}
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 px-6 py-4 shrink-0">
        <ActionCard
          icon={<Download size={17} className="text-accent" />}
          title="Download Channels"
          description="Fetch from channels.txt only (latest 10 per channel, shared downloaded.txt)"
          disabled={anyBusy}
          onClick={onRunChannels}
          delay={0}
        />

        <ActionCard
          icon={<ListVideo size={17} className="text-accent" />}
          title="Download Playlists"
          description="Fetch from playlists.txt only (same archive and folder layout as channels)"
          disabled={anyBusy}
          onClick={onRunPlaylists}
          delay={0.04}
        />

        {/* Ytrec card with count input */}
        <ActionCard
          icon={<Tv size={17} className="text-accent" />}
          title="Download Recommendations"
          description="Fetch YouTube recommended feed (ytrec)"
          disabled={anyBusy}
          onClick={onRunYtrec}
          delay={0.08}
          topRight={
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <label className="text-[10px] text-text-muted font-medium">count</label>
              <input
                type="number"
                min={1}
                value={ytrecCount}
                onChange={(e) => onYtrecCountChange(Math.max(1, Number(e.target.value) || 1))}
                className="w-14 px-2 py-1 text-xs rounded-md border border-border bg-bg text-text text-center font-mono"
              />
            </div>
          }
        />

        <ActionCard
          icon={<Mic2 size={17} className="text-accent" />}
          title="Download Podcasts"
          description="Fetch latest episodes from podcasts.txt (RSS, audio)"
          disabled={anyBusy}
          onClick={onRunPodcasts}
          delay={0.12}
        />
      </div>

      {/* Log terminal */}
      <div className="flex-1 flex flex-col min-h-0 mx-6 mb-4 rounded-xl border border-border bg-bg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface/80 backdrop-blur-sm">
          <Terminal size={12} className="text-text-muted" />
          <span className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Output</span>
          {busy && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent pulse-accent" />}
        </div>
        <pre ref={logRef} className="log-terminal flex-1 overflow-auto p-4 text-text-secondary">
          {log || 'Waiting for sync\u2026'}
        </pre>
      </div>
    </div>
  )
}
