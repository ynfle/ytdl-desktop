import { useState } from 'react'
import { motion } from 'motion/react'
import { RefreshCw, ExternalLink, Loader2, Radio, Search, UserPlus } from 'lucide-react'
import type { ChannelInfoRow } from '../../../shared/ytdl-api'

type AddChannelBarProps = {
  addPreview: { identifier: string; row: ChannelInfoRow } | null
  addPreviewLoading: boolean
  addConfirmBusy: boolean
  addFormError: string | null
  rawInput: string
  onRawInputChange: (v: string) => void
  onLookUp: () => void
  onCancelPreview: () => void
  onConfirmAdd: () => void | Promise<void>
  /** Disables Look up / list actions (sync + bulk channel resolve + add flows). */
  interactionLocked: boolean
  onOpenUrl: (url: string) => void
}

/**
 * Add flow: paste URL or slug → Look up (yt-dlp) → confirm card with avatar + name → Add to channels.txt.
 */
function AddChannelBar({
  addPreview,
  addPreviewLoading,
  addConfirmBusy,
  addFormError,
  rawInput,
  onRawInputChange,
  onLookUp,
  onCancelPreview,
  onConfirmAdd,
  interactionLocked,
  onOpenUrl
}: AddChannelBarProps) {
  const lookUpDisabled =
    interactionLocked || addPreviewLoading || addConfirmBusy || !rawInput.trim()

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-3">
      <p className="text-[11px] text-text-muted leading-relaxed">
        Add a channel: paste a full YouTube channel URL or type a slug (
        <span className="font-mono">@handle</span>, <span className="font-mono">c/name</span>,{' '}
        <span className="font-mono">channel/UC…</span>). <strong>Look up</strong> loads the profile picture
        and name so you can confirm before saving.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={rawInput}
          onChange={(e) => onRawInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !lookUpDisabled) {
              e.preventDefault()
              onLookUp()
            }
          }}
          disabled={interactionLocked || addPreviewLoading || addConfirmBusy}
          placeholder="https://www.youtube.com/@… or @handle"
          className="flex-1 min-w-[200px] text-sm px-3 py-2 rounded-lg border border-border bg-bg text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          aria-label="Channel URL or slug"
        />
        <button
          type="button"
          onClick={() => onLookUp()}
          disabled={lookUpDisabled}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border bg-bg text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {addPreviewLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Look up
        </button>
      </div>
      {addFormError ? <p className="text-[11px] text-danger">{addFormError}</p> : null}

      {addPreview ? (
        <div className="flex flex-wrap gap-4 items-center border-t border-border pt-3 mt-1">
          <img
            src={addPreview.row.logoUrl!}
            alt=""
            width={64}
            height={64}
            className="w-16 h-16 rounded-full object-cover border border-border shrink-0"
          />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-semibold text-text">{addPreview.row.displayName}</p>
            <p
              className="text-xs font-mono text-text-muted truncate"
              title={addPreview.identifier}
            >
              {addPreview.identifier}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              <button
                type="button"
                onClick={() => onOpenUrl(addPreview.row.videosUrl)}
                className="text-[11px] text-accent hover:underline"
              >
                Open /videos
              </button>
              {addPreview.row.channelPageUrl ? (
                <>
                  <span className="text-text-muted">·</span>
                  <button
                    type="button"
                    onClick={() => onOpenUrl(addPreview.row.channelPageUrl!)}
                    className="text-[11px] text-accent hover:underline"
                  >
                    Open channel page
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void onConfirmAdd()}
              disabled={addConfirmBusy}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-accent bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {addConfirmBusy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Add channel
            </button>
            <button
              type="button"
              onClick={onCancelPreview}
              disabled={addConfirmBusy}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type Props = {
  rows: ChannelInfoRow[]
  busy: boolean
  channelsBusy: boolean
  progress: string | null
  onReload: () => void
  onFetchNames: () => void
  onRefetchAll: () => void
  onOpenUrl: (url: string) => void
  addPreview: { identifier: string; row: ChannelInfoRow } | null
  addPreviewLoading: boolean
  addConfirmBusy: boolean
  addFormError: string | null
  onLookUpChannel: (raw: string) => void
  onCancelAddPreview: () => void
  onConfirmAddChannel: () => Promise<boolean>
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
  onOpenUrl,
  addPreview,
  addPreviewLoading,
  addConfirmBusy,
  addFormError,
  onLookUpChannel,
  onCancelAddPreview,
  onConfirmAddChannel
}: Props) {
  const [addRawInput, setAddRawInput] = useState('')

  const anyBusy = busy || channelsBusy || addPreviewLoading || addConfirmBusy
  /** Block add Look up while sync or bulk resolve (matches main-process gates). */
  const addInteractionLocked = busy || channelsBusy || addPreviewLoading || addConfirmBusy

  /** Progress fraction 0..1 for the bar (parse "3/12" from progress string). */
  const progressFraction = (() => {
    if (!progress) return 0
    const m = progress.match(/^(\d+)\/(\d+)/)
    if (!m) return 0
    const [, cur, total] = m
    return Number(total) > 0 ? Number(cur) / Number(total) : 0
  })()

  const addBar = (
    <AddChannelBar
      addPreview={addPreview}
      addPreviewLoading={addPreviewLoading}
      addConfirmBusy={addConfirmBusy}
      addFormError={addFormError}
      rawInput={addRawInput}
      onRawInputChange={setAddRawInput}
      onLookUp={() => onLookUpChannel(addRawInput)}
      onCancelPreview={onCancelAddPreview}
      onConfirmAdd={async () => {
        const ok = await onConfirmAddChannel()
        if (ok) setAddRawInput('')
      }}
      interactionLocked={addInteractionLocked}
      onOpenUrl={onOpenUrl}
    />
  )

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

        {rows.length > 0 ? addBar : null}

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
          <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted px-6 py-8 min-h-[280px]">
            <div className="w-full max-w-lg">{addBar}</div>
            <Radio size={40} strokeWidth={1.2} className="opacity-30" />
            <p className="text-sm text-center">No lines in channels.txt yet, or the file is missing.</p>
            <p className="text-[11px] text-center max-w-sm">
              Use <strong>Look up</strong> above to add your first channel, or create{' '}
              <code className="font-mono text-text-secondary">channels.txt</code> in your data folder.
            </p>
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
