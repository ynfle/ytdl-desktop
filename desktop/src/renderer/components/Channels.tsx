import { useState } from 'react'
import { motion } from 'motion/react'
import { ExternalLink, Loader2, Radio, Search, UserPlus } from 'lucide-react'
import type { ChannelInfoRow } from '../../../shared/ytdl-api'
import { ChannelAvatar } from './ChannelAvatar'
import { RowDeleteButton } from './ui/row-delete-button'
import {
  SubscriptionListLoading,
  SubscriptionMetadataToolbar,
  SubscriptionResolveProgressBar,
  SubscriptionRowStatus,
  subPageAddCardClass,
  subPageCellTruncateClass,
  subPageLookUpButtonClass,
  subPageLookUpInputClass,
  subPagePrimaryButtonClass,
  subPageRowIconButtonClass,
  subPageSecondaryButtonClass,
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
    <div className={subPageAddCardClass}>
      <p className="text-[11px] text-text-muted leading-relaxed">
        Add a channel: paste a full YouTube or YouTube Music channel URL, or type a slug (
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
          placeholder="youtube.com or music.youtube.com channel URL, or @handle"
          className={subPageLookUpInputClass}
          aria-label="YouTube or YouTube Music channel URL or slug"
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
              className={subPagePrimaryButtonClass}
            >
              {addConfirmBusy ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Add channel
            </button>
            <button
              type="button"
              onClick={onCancelPreview}
              disabled={addConfirmBusy}
              className={subPageSecondaryButtonClass}
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
  /** Remove one line from channels.txt (same identifier as the row). */
  onRemoveChannel: (identifier: string) => void
  /**
   * False until the first cache hydrate settles (`useChannels().listLoaded`); shows a loading
   * placeholder instead of the empty state. Defaults to true so callers that omit it keep old behavior.
   */
  listLoaded?: boolean
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
  onConfirmAddChannel,
  onRemoveChannel,
  listLoaded = true
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
          {/* Hide the count until hydrate settles so it never reads "0 entries" prematurely. */}
          {listLoaded ? (
            <span className="section-pill">
              {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
            </span>
          ) : null}
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
        {/* Hydrate still in flight: avoid flashing "No lines in channels.txt yet". */}
        {rows.length === 0 && !listLoaded ? (
          <SubscriptionListLoading logTag="[Channels]" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-text-muted px-6 py-8 min-h-[280px]">
            <div className="w-full max-w-lg">{addBar}</div>
            <div className="empty-state-icon">
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
                <th className="w-24">Actions</th>
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
                    <span className={`text-[11px] font-mono text-text-secondary ${subPageCellTruncateClass}`} title={row.identifier}>
                      {row.identifier}
                    </span>
                  </td>
                  <td className="text-sm">
                    {row.displayName ? (
                      <span className={subPageCellTruncateClass} title={row.displayName}>
                        {row.displayName}
                      </span>
                    ) : (
                      <span className="text-text-muted">&mdash;</span>
                    )}
                  </td>
                  <td>
                    <SubscriptionRowStatus displayName={row.displayName} error={row.error} />
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenUrl(row.videosUrl)}
                        className={subPageRowIconButtonClass}
                        title="Open /videos"
                        aria-label={`Open ${row.displayName ?? row.identifier} videos in browser`}
                      >
                        <ExternalLink size={12} />
                      </button>
                      {row.channelPageUrl ? (
                        <button
                          type="button"
                          onClick={() => onOpenUrl(row.channelPageUrl!)}
                          className={subPageRowIconButtonClass}
                          title="Open channel page"
                          aria-label={`Open ${row.displayName ?? row.identifier} channel page in browser`}
                        >
                          <ExternalLink size={12} />
                        </button>
                      ) : null}
                      <RowDeleteButton
                        label={row.identifier}
                        disabled={anyBusy}
                        onConfirm={() => {
                          console.info('[Channels] remove confirmed', row.identifier)
                          void onRemoveChannel(row.identifier)
                        }}
                      />
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
