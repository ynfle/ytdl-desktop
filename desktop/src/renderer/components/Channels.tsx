import { motion } from 'motion/react'
import { RefreshCw, ExternalLink, Loader2, Radio } from 'lucide-react'
import type { ChannelInfoRow } from '../../../shared/ytdl-api'

type Props = {
  rows: ChannelInfoRow[]
  busy: boolean
  channelsBusy: boolean
  progress: string | null
  onReload: () => void
  onFetchNames: () => void
  onRefetchAll: () => void
  onOpenUrl: (url: string) => void
}

/** Channels page: table of channels.txt entries with resolve controls and progress. */
export default function ChannelsPage({
  rows,
  busy,
  channelsBusy,
  progress,
  onReload,
  onFetchNames,
  onRefetchAll,
  onOpenUrl
}: Props) {
  const anyBusy = busy || channelsBusy
  /** Progress fraction 0..1 for the bar (parse "3/12" from progress string). */
  const progressFraction = (() => {
    if (!progress) return 0
    const m = progress.match(/^(\d+)\/(\d+)/)
    if (!m) return 0
    const [, cur, total] = m
    return Number(total) > 0 ? Number(cur) / Number(total) : 0
  })()

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header + controls */}
      <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">Channels</h1>
          <span className="text-xs font-mono text-text-muted bg-surface-raised px-2 py-0.5 rounded-full">
            {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onReload}
            disabled={anyBusy}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-surface-raised text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={13} />
            Reload list
          </button>
          <button
            onClick={onFetchNames}
            disabled={anyBusy}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-surface-raised text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {channelsBusy ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />}
            Fetch names
          </button>
          <button
            onClick={onRefetchAll}
            disabled={anyBusy}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-accent-dim text-accent hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Refetch all
          </button>

          {/* Status text */}
          <span className="text-[11px] text-text-muted ml-auto">
            {channelsBusy && progress
              ? `${progress} · up to 4 yt-dlp at once`
              : 'cache 7d in app userData'}
          </span>
        </div>

        {/* Progress bar -- visible during resolve */}
        {channelsBusy && (
          <div className="progress-track">
            <motion.div
              className="progress-fill"
              initial={{ width: 0 }}
              animate={{ width: `${progressFraction * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <Radio size={40} strokeWidth={1.2} className="opacity-30" />
            <p className="text-sm">No lines in channels.txt, or file missing in the data folder.</p>
          </div>
        ) : (
          <table className="channel-table">
            <thead>
              <tr>
                <th className="w-12 pl-4 pr-1" aria-label="Logo" />
                <th>channels.txt</th>
                <th>YouTube Name</th>
                <th>Status</th>
                <th className="w-20">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <motion.tr
                  key={row.identifier}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, delay: Math.min(i * 0.02, 0.5) }}
                >
                  {/* Avatar */}
                  <td className="pl-4 pr-1">
                    {row.logoUrl ? (
                      <img
                        className="w-8 h-8 rounded-full object-cover border border-border"
                        src={row.logoUrl}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-overlay border border-border" />
                    )}
                  </td>

                  {/* Identifier */}
                  <td>
                    <span className="text-xs font-mono truncate block max-w-[200px]" title={row.identifier}>
                      {row.identifier}
                    </span>
                  </td>

                  {/* Display name */}
                  <td className="text-sm">{row.displayName ?? <span className="text-text-muted">--</span>}</td>

                  {/* Error / status */}
                  <td>
                    {row.error ? (
                      <span className="text-[11px] text-danger">{row.error}</span>
                    ) : row.displayName ? (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" title="resolved" />
                    ) : null}
                  </td>

                  {/* Actions */}
                  <td>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onOpenUrl(row.videosUrl)}
                        className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-colors"
                        title="Open /videos"
                      >
                        <ExternalLink size={13} />
                      </button>
                      {row.channelPageUrl && (
                        <button
                          onClick={() => onOpenUrl(row.channelPageUrl!)}
                          className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-colors"
                          title="Open channel page"
                        >
                          <ExternalLink size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
