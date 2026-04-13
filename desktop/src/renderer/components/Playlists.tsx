import { useState } from 'react'
import { motion } from 'motion/react'
import { ExternalLink, ListVideo, Loader2, Search, UserPlus } from 'lucide-react'
import type { ChannelInfoRow } from '../../../shared/ytdl-api'
import {
  SubscriptionMetadataToolbar,
  SubscriptionResolveProgressBar,
  subPageLookUpButtonClass,
  subPageLookUpInputClass,
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
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-3">
      <p className="text-[11px] text-text-muted leading-relaxed">
        Add a playlist: paste a playlist URL, a watch URL with <span className="font-mono">list=…</span>, or a
        playlist id (<span className="font-mono">PL…</span>). On <strong>Downloads</strong>, use{' '}
        <strong>Download Playlists</strong> to fetch the latest 10 items per line (shared{' '}
        <span className="font-mono">downloaded.txt</span> with channel sync).
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
              title={addPreview.playlistUrl}
            >
              {addPreview.playlistUrl.length > 72
                ? `${addPreview.playlistUrl.slice(0, 72)}…`
                : addPreview.playlistUrl}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              <button
                type="button"
                onClick={() => onOpenUrl(addPreview.row.videosUrl)}
                className="text-[11px] text-accent hover:underline"
              >
                Open playlist
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
              Add playlist
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
  onConfirmAddPlaylist
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
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">Playlists</h1>
          <span className="text-xs font-mono text-text-muted bg-surface-raised px-2 py-0.5 rounded-full">
            {rows.length} playlist{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        {rows.length > 0 ? addBar : null}

        <SubscriptionMetadataToolbar
          anyBusy={anyBusy}
          onReload={onReload}
          onFetch={onFetchMeta}
          onRefetchAll={onRefetchAllMeta}
          fetchBusy={playlistsBusy}
          fetchIcon={<ListVideo size={13} />}
          fetchIconBusy={subscriptionToolbarFetchSpinner()}
          fetchLabel="Fetch playlist info"
          statusHint={
            playlistsBusy && progress
              ? `${progress} · up to 4 yt-dlp at once`
              : 'cache 7d in app userData'
          }
        />

        <SubscriptionResolveProgressBar active={playlistsBusy} progress={progress} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted px-6 py-8 min-h-[280px]">
            <div className="w-full max-w-lg">{addBar}</div>
            <ListVideo size={40} strokeWidth={1.2} className="opacity-30" />
            <p className="text-sm text-center">No lines in playlists.txt yet, or the file is missing.</p>
            <p className="text-[11px] text-center max-w-sm">
              Use <strong>Look up</strong> above to add a playlist, or create{' '}
              <code className="font-mono text-text-secondary">playlists.txt</code> in your data folder.
            </p>
          </div>
        ) : (
          <table className="channel-table">
            <thead>
              <tr>
                <th className="w-12 pl-4 pr-1" aria-label="Logo" />
                <th>playlists.txt</th>
                <th>Title</th>
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
                  <td>
                    <span
                      className="text-xs font-mono truncate block max-w-[240px]"
                      title={row.identifier}
                    >
                      {row.identifier.length > 48 ? `${row.identifier.slice(0, 48)}…` : row.identifier}
                    </span>
                  </td>
                  <td className="text-sm">
                    {row.displayName ?? <span className="text-text-muted">--</span>}
                  </td>
                  <td>
                    {row.error ? (
                      <span className="text-[11px] text-danger">{row.error}</span>
                    ) : row.displayName ? (
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full bg-success"
                        title="resolved"
                      />
                    ) : null}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onOpenUrl(row.videosUrl)}
                        className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-colors"
                        title="Open playlist"
                      >
                        <ExternalLink size={13} />
                      </button>
                      {row.channelPageUrl ? (
                        <button
                          onClick={() => onOpenUrl(row.channelPageUrl!)}
                          className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-colors"
                          title="Open channel page"
                        >
                          <ExternalLink size={13} />
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
