import { useState } from 'react'
import { motion } from 'motion/react'
import { ExternalLink, ListVideo, Loader2, Search, UserPlus } from 'lucide-react'
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

type AddPlaylistBarProps = {
  addPreview: { playlistUrl: string; row: ChannelInfoRow } | null
  addPreviewLoading: boolean
  addConfirmBusy: boolean
  addFormError: string | null
  rawInput: string
  onRawInputChange: (v: string) => void
  onLookUp: () => void
  onCancelPreview: () => void
  onConfirmAdd: () => void | Promise<void>
  interactionLocked: boolean
  onOpenUrl: (url: string) => void
}

function AddPlaylistBar({
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
}: AddPlaylistBarProps) {
  const lookUpDisabled =
    interactionLocked || addPreviewLoading || addConfirmBusy || !rawInput.trim()

  return (
    <div className={subPageAddCardClass}>
      <p className="text-[11px] text-text-muted leading-relaxed">
        Add a playlist: paste a playlist URL, a watch URL with <span className="font-mono text-text-secondary">list=&hellip;</span>, or a
        playlist id (<span className="font-mono text-text-secondary">PL&hellip;</span>). On <strong className="text-text-secondary">Downloads</strong>, use{' '}
        <strong className="text-text-secondary">Download Playlists</strong> to fetch the latest 10 items per line (shared{' '}
        <span className="font-mono text-text-secondary">downloaded.txt</span> with channel sync).
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
          placeholder="https://www.youtube.com/playlist?list=…"
          className={subPageLookUpInputClass}
          aria-label="YouTube playlist URL or id"
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
              title={addPreview.playlistUrl}
            >
              {addPreview.playlistUrl}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              <button
                type="button"
                onClick={() => onOpenUrl(addPreview.row.videosUrl)}
                className="text-[11px] text-accent hover:text-accent-hover hover:underline transition-colors"
              >
                Open playlist
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
              Add playlist
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
  channelsAddPreviewLoading: boolean
  channelsAddConfirmBusy: boolean
  playlistsBusy: boolean
  progress: string | null
  onReload: () => void
  onFetchMeta: () => void
  onRefetchAllMeta: () => void
  onOpenUrl: (url: string) => void
  addPreview: { playlistUrl: string; row: ChannelInfoRow } | null
  addPreviewLoading: boolean
  addConfirmBusy: boolean
  addFormError: string | null
  onLookUpPlaylist: (raw: string) => void
  onCancelAddPreview: () => void
  onConfirmAddPlaylist: () => Promise<boolean>
  /** Remove one line from playlists.txt (row.identifier is the stored URL). */
  onRemovePlaylist: (playlistUrl: string) => void
  /**
   * False until the first cache hydrate settles (`usePlaylists().listLoaded`); shows a loading
   * placeholder instead of the empty state. Defaults to true so callers that omit it keep old behavior.
   */
  listLoaded?: boolean
}

/** Playlists page: playlists.txt subscriptions, metadata refresh, same cache as channels. */
export default function PlaylistsPage({
  rows,
  busy,
  podcastsBusy,
  channelsBusy,
  channelsAddPreviewLoading,
  channelsAddConfirmBusy,
  playlistsBusy,
  progress,
  onReload,
  onFetchMeta,
  onRefetchAllMeta,
  onOpenUrl,
  addPreview,
  addPreviewLoading,
  addConfirmBusy,
  addFormError,
  onLookUpPlaylist,
  onCancelAddPreview,
  onConfirmAddPlaylist,
  onRemovePlaylist,
  listLoaded = true
}: Props) {
  const [rawInput, setRawInput] = useState('')

  const { anyBusy, addInteractionLocked } = useSubscriptionPageLocks(
    busy,
    podcastsBusy,
    channelsBusy,
    addPreviewLoading,
    addConfirmBusy,
    playlistsBusy,
    false,
    false,
    channelsAddPreviewLoading,
    channelsAddConfirmBusy
  )

  const addBar = (
    <AddPlaylistBar
      addPreview={addPreview}
      addPreviewLoading={addPreviewLoading}
      addConfirmBusy={addConfirmBusy}
      addFormError={addFormError}
      rawInput={rawInput}
      onRawInputChange={setRawInput}
      onLookUp={() => onLookUpPlaylist(rawInput)}
      onCancelPreview={onCancelAddPreview}
      onConfirmAdd={async () => {
        const ok = await onConfirmAddPlaylist()
        if (ok) setRawInput('')
      }}
      interactionLocked={addInteractionLocked}
      onOpenUrl={onOpenUrl}
    />
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight">Playlists</h1>
          {/* Hide the count until hydrate settles so it never reads "0 playlists" prematurely. */}
          {listLoaded ? (
            <span className="section-pill">
              {rows.length} playlist{rows.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        {rows.length > 0 ? addBar : null}

        <SubscriptionMetadataToolbar
          anyBusy={anyBusy}
          onReload={onReload}
          onFetch={onFetchMeta}
          onRefetchAll={onRefetchAllMeta}
          fetchBusy={playlistsBusy}
          fetchIcon={<ListVideo size={12} />}
          fetchIconBusy={subscriptionToolbarFetchSpinner()}
          fetchLabel="Fetch playlist info"
          statusHint={
            playlistsBusy && progress
              ? `${progress} \u00b7 up to 4 yt-dlp at once`
              : 'cache 7d in app userData'
          }
        />

        <SubscriptionResolveProgressBar active={playlistsBusy} progress={progress} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Hydrate still in flight: avoid flashing "No lines in playlists.txt yet". */}
        {rows.length === 0 && !listLoaded ? (
          <SubscriptionListLoading logTag="[Playlists]" />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-text-muted px-6 py-8 min-h-[280px]">
            <div className="w-full max-w-lg">{addBar}</div>
            <div className="empty-state-icon">
              <ListVideo size={28} strokeWidth={1.2} className="text-accent/40" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium text-text-secondary">No lines in playlists.txt yet</p>
              <p className="text-[11px] max-w-sm leading-relaxed">
                Use <strong className="text-text-secondary">Look up</strong> above to add a playlist, or create{' '}
                <code className="font-mono text-text-secondary bg-surface-raised px-1 py-0.5 rounded">playlists.txt</code>{' '}
                in your data folder.
              </p>
            </div>
          </div>
        ) : (
          <table className="channel-table">
            <thead>
              <tr>
                <th className="w-12 pl-4 pr-1" aria-label="Logo" />
                <th>playlists.txt</th>
                <th>Title</th>
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
                    {/* CSS truncate only; full URL stays in the tooltip. */}
                    <span
                      className={`text-[11px] font-mono text-text-secondary ${subPageCellTruncateClass}`}
                      title={row.identifier}
                    >
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
                        title="Open playlist"
                        aria-label={`Open playlist ${row.displayName ?? row.identifier} in browser`}
                      >
                        <ExternalLink size={12} />
                      </button>
                      {row.channelPageUrl ? (
                        <button
                          type="button"
                          onClick={() => onOpenUrl(row.channelPageUrl!)}
                          className={subPageRowIconButtonClass}
                          title="Open channel page"
                          aria-label={`Open channel page for ${row.displayName ?? row.identifier} in browser`}
                        >
                          <ExternalLink size={12} />
                        </button>
                      ) : null}
                      <RowDeleteButton
                        label={row.identifier}
                        disabled={anyBusy}
                        onConfirm={() => {
                          console.info('[Playlists] remove confirmed', row.identifier)
                          void onRemovePlaylist(row.identifier)
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
