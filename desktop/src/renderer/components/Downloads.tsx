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
          <h1 className="text-lg font-bold">Downloads</h1>
          {busy && (
            <span className="inline-flex items-center gap-1.5 text-xs text-accent">
              <Loader2 size={13} className="animate-spin" />
              Syncing…
            </span>
          )}
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 px-6 py-4 shrink-0">
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          disabled={anyBusy}
          onClick={onRunChannels}
          className="flex flex-col items-start gap-3 p-4 rounded-xl border border-border bg-surface hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-accent-dim flex items-center justify-center">
            <Download size={18} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold">Download Channels</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Fetch from channels.txt only (latest 10 per channel, shared downloaded.txt)
            </p>
          </div>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          disabled={anyBusy}
          onClick={onRunPlaylists}
          className="flex flex-col items-start gap-3 p-4 rounded-xl border border-border bg-surface hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-accent-dim flex items-center justify-center">
            <ListVideo size={18} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold">Download Playlists</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Fetch from playlists.txt only (same archive and folder layout as channels)
            </p>
          </div>
        </motion.button>

        {/* Ytrec card */}
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          disabled={anyBusy}
          onClick={onRunYtrec}
          className="flex flex-col items-start gap-3 p-4 rounded-xl border border-border bg-surface hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
        >
          <div className="flex items-center justify-between w-full">
            <div className="w-9 h-9 rounded-lg bg-accent-dim flex items-center justify-center">
              <Tv size={18} className="text-accent" />
            </div>
            {/* Count input */}
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <label className="text-[11px] text-text-muted">count</label>
              <input
                type="number"
                min={1}
                value={ytrecCount}
                onChange={(e) => onYtrecCountChange(Math.max(1, Number(e.target.value) || 1))}
                className="w-14 px-2 py-1 text-xs rounded-md border border-border bg-bg text-text text-center"
              />
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold">Download Recommendations</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Fetch YouTube recommended feed (ytrec)
            </p>
          </div>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          disabled={anyBusy}
          onClick={onRunPodcasts}
          className="flex flex-col items-start gap-3 p-4 rounded-xl border border-border bg-surface hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-accent-dim flex items-center justify-center">
            <Mic2 size={18} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold">Download Podcasts</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Fetch latest episodes from podcasts.txt (RSS, audio)
            </p>
          </div>
        </motion.button>
      </div>

      {/* Log terminal */}
      <div className="flex-1 flex flex-col min-h-0 mx-6 mb-4 rounded-xl border border-border bg-bg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface">
          <Terminal size={13} className="text-text-muted" />
          <span className="text-[11px] text-text-muted font-medium">Output</span>
        </div>
        <pre ref={logRef} className="log-terminal flex-1 overflow-auto p-3 text-text-secondary">
          {log || 'Waiting for sync…'}
        </pre>
      </div>
    </div>
  )
}
