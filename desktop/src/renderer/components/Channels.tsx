import { useState } from 'react'
import { motion } from 'motion/react'
import { ExternalLink, Loader2, Radio, Search, UserPlus } from 'lucide-react'
import type { ChannelInfoRow } from '../../../shared/ytdl-api'
import { ChannelAvatar } from './ChannelAvatar'
import {
  SubscriptionMetadataToolbar,
  SubscriptionResolveProgressBar,
  subPageLookUpButtonClass,
  subPageLookUpInputClass,
  subscriptionToolbarFetchSpinner,
  useSubscriptionPageLocks
} from './subscription-page-ui'

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
 * Add flow: paste URL or slug -> Look up (yt-dlp) -> confirm card with avatar + name -> Add to channels.txt.
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
    <div className="rounded-xl border border-border bg-surface-raised/60 p-4 space-y-3">
      <p className="text-[11px] text-text-muted leading-relaxed">
        Add a channel: paste a full YouTube channel URL or type a slug (
        <span className="font-mono text-text-secondary">@handle</span>,{' '}
        <span className="font-mono text-text-secondary">c/name</span>,{' '}
        <span className="font-mono text-text-secondary">channel/UC&hellip;</span>
        ). <strong className="text-text-secondary">Look up</strong> loads the profile picture
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
          className={subPageLookUpInputClass}
          aria-label="Channel URL or slug"
        />
        <button
          type="button"
          onClick={() => onLookUp()}
          disabled={lookUpDisabled}
          className={subPageLookUpButtonClass}
        >
          {addPreviewLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Look up
        </button>
      </div>
      {addFormError ? <p className="text-[11px] text-danger">{addFormError}</p> : null}

      {addPreview ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-wrap gap-4 items-center border-t border-border pt-4 mt-1"
        >
          <ChannelAvatar src={addPreview.row.logoUrl} name={addPreview.row.displayName} size="lg" />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-semibold text-text">{addPreview.row.displayName}</p>
            <p
              className="text-[11px] font-mono text-text-muted truncate"
              title={addPreview.identifier}
            >
              {addPreview.identifier}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              <button
                type="button"
                onClick={() => onOpenUrl(addPreview.row.videosUrl)}
                className="text-[11px] text-accent hover:text-accent-hover hover:underline transition-colors"
              >
                Open /videos
              </button>
              {addPreview.row.channelPageUrl ? (
                <>
                  <span className="text-text-muted">&middot;</span>
                  <button
                    type="button"
                    onClick={() => onOpenUrl(addPreview.row.channelPageUrl!)}
                    className="text-[11px] text-accent hover:text-accent-hover hover:underline transition-colors"
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
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg text-bg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              style={{
                background: 'linear-gradient(135deg, #e8a849 0%, #d4893a 100%)',
                boxShadow: '0 2px 8px rgba(232, 168, 73, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
              }}
            >
              {addConfirmBusy ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Add channel
            </button>
            <button
              type="button"
              onClick={onCancelPreview}
              disabled={addConfirmBusy}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg border border-border text-text-secondary hover:text-text hover:border-border-bright disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Back
            </button>
          </div>
        </motion.div>
      ) : null}
    </div>
  )
}

type Props = {
  rows: ChannelInfoRow[]
  busy: boolean
  podcastsBusy: boolean
  channelsBusy: boolean
  /** Cross-page: Playlists tab bulk resolve or add draft. */
  playlistsBusy: boolean
  playlistAddPreviewLoading: boolean
  playlistAddConfirmBusy: boolean
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
  podcastsBusy,
  channelsBusy,
  playlistsBusy,
  playlistAddPreviewLoading,
  playlistAddConfirmBusy,
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

  const { anyBusy, addInteractionLocked } = useSubscriptionPageLocks(
    busy,
    podcastsBusy,
    channelsBusy,
    addPreviewLoading,
    addConfirmBusy,
    playlistsBusy,
    playlistAddPreviewLoading,
    playlistAddConfirmBusy,
    false,
    false
  )

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
      <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">Channels</h1>
          <span className="section-pill">
            {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        {rows.length > 0 ? addBar : null}

        <SubscriptionMetadataToolbar
          anyBusy={anyBusy}
          onReload={onReload}
          onFetch={onFetchNames}
          onRefetchAll={onRefetchAll}
          fetchBusy={channelsBusy}
          fetchIcon={<Radio size={12} />}
          fetchIconBusy={subscriptionToolbarFetchSpinner()}
          fetchLabel="Fetch names"
          statusHint={
            channelsBusy && progress
              ? `${progress} \u00b7 up to 4 yt-dlp at once`
              : 'cache 7d in app userData'
          }
        />

        <SubscriptionResolveProgressBar active={channelsBusy} progress={progress} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-text-muted px-6 py-8 min-h-[280px]">
            <div className="w-full max-w-lg">{addBar}</div>
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(232, 168, 73, 0.08) 0%, rgba(232, 168, 73, 0.02) 100%)',
                border: '1px solid rgba(232, 168, 73, 0.1)'
              }}
            >
              <Radio size={28} strokeWidth={1.2} className="text-accent/40" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium text-text-secondary">No lines in channels.txt yet</p>
              <p className="text-[11px] max-w-sm leading-relaxed">
                Use <strong className="text-text-secondary">Look up</strong> above to add your first channel, or create{' '}
                <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">channels.txt</code>{' '}
                in your data folder.
              </p>
            </div>
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
                  transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.5) }}
                >
                  <td className="pl-4 pr-1">
                    <ChannelAvatar src={row.logoUrl} name={row.displayName ?? row.identifier} size="md" />
                  </td>
                  <td>
                    <span className="text-[11px] font-mono truncate block max-w-[200px] text-text-secondary" title={row.identifier}>
                      {row.identifier}
                    </span>
                  </td>
                  <td className="text-sm">{row.displayName ?? <span className="text-text-muted">&mdash;</span>}</td>
                  <td>
                    {row.error ? (
                      <span className="text-[11px] text-danger">{row.error}</span>
                    ) : row.displayName ? (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" title="resolved" />
                    ) : null}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onOpenUrl(row.videosUrl)}
                        className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-all"
                        title="Open /videos"
                      >
                        <ExternalLink size={12} />
                      </button>
                      {row.channelPageUrl ? (
                        <button
                          onClick={() => onOpenUrl(row.channelPageUrl!)}
                          className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-all"
                          title="Open channel page"
                        >
                          <ExternalLink size={12} />
                        </button>
                      ) : null}
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
