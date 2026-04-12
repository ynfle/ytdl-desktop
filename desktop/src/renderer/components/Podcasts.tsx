import { useState } from 'react'
import { motion } from 'motion/react'
import { ExternalLink, Loader2, Mic2, Search, Trash2 } from 'lucide-react'
import type { ApplePodcastSearchResult, PodcastInfoRow } from '../../../shared/ytdl-api'
import {
  SubscriptionMetadataToolbar,
  SubscriptionResolveProgressBar,
  subPageLookUpButtonClass,
  subPageLookUpInputClass,
  subscriptionToolbarFetchSpinner,
  useSubscriptionPageLocks
} from './subscription-page-ui'

type AddPodcastBarProps = {
  addPreview: { feedUrl: string; row: PodcastInfoRow } | null
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

/** Paste RSS or Apple Podcasts link → Look up → confirm → Add. */
function AddPodcastBar({
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
}: AddPodcastBarProps) {
  const lookUpDisabled =
    interactionLocked || addPreviewLoading || addConfirmBusy || !rawInput.trim()

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-3">
      <p className="text-[11px] text-text-muted leading-relaxed">
        Add a podcast: paste an <strong>https://</strong> RSS feed URL or a{' '}
        <span className="font-mono">podcasts.apple.com/…/id…</span> link. <strong>Look up</strong>{' '}
        loads the title and cover art before saving to <code className="font-mono">podcasts.txt</code>.
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
          placeholder="https://…/feed.xml or Apple Podcasts URL"
          className={subPageLookUpInputClass}
          aria-label="Podcast RSS or Apple URL"
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
          {addPreview.row.logoUrl ? (
            <img
              src={addPreview.row.logoUrl}
              alt=""
              width={64}
              height={64}
              className="w-16 h-16 rounded-lg object-cover border border-border shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-surface-overlay border border-border shrink-0 flex items-center justify-center text-text-muted">
              <Mic2 size={28} />
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-semibold text-text">{addPreview.row.displayName}</p>
            <p
              className="text-xs font-mono text-text-muted truncate"
              title={addPreview.feedUrl}
            >
              {addPreview.feedUrl}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              <button
                type="button"
                onClick={() => onOpenUrl(addPreview.feedUrl)}
                className="text-[11px] text-accent hover:underline"
              >
                Open feed
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onConfirmAdd()}
              disabled={interactionLocked || addConfirmBusy}
              className="text-xs font-medium px-3 py-2 rounded-lg bg-accent text-bg hover:opacity-90 disabled:opacity-40"
            >
              {addConfirmBusy ? <Loader2 size={14} className="animate-spin inline" /> : null}
              Add to podcasts.txt
            </button>
            <button
              type="button"
              onClick={onCancelPreview}
              disabled={addConfirmBusy}
              className="text-xs px-3 py-2 rounded-lg border border-border text-text-secondary hover:text-text"
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
  rows: PodcastInfoRow[]
  busy: boolean
  podcastsBusy: boolean
  channelsBusy: boolean
  progress: string | null
  onReload: () => void
  onFetchMeta: () => void
  onRefetchAllMeta: () => void
  onOpenUrl: (url: string) => void
  searchResults: ApplePodcastSearchResult[]
  searchLoading: boolean
  searchError: string | null
  onSearch: (term: string) => void
  addPreview: { feedUrl: string; row: PodcastInfoRow } | null
  addPreviewLoading: boolean
  addConfirmBusy: boolean
  addFormError: string | null
  onLookUpPodcast: (raw: string, opts?: { artworkUrl?: string | null }) => void
  onCancelAddPreview: () => void
  onConfirmAddPodcast: () => Promise<boolean>
  onRemovePodcast: (feedUrl: string) => void
}

/** Podcasts page: Apple search, RSS / Apple paste flow, subscribed list, metadata refresh. */
export default function PodcastsPage({
  rows,
  busy,
  podcastsBusy,
  channelsBusy,
  progress,
  onReload,
  onFetchMeta,
  onRefetchAllMeta,
  onOpenUrl,
  searchResults,
  searchLoading,
  searchError,
  onSearch,
  addPreview,
  addPreviewLoading,
  addConfirmBusy,
  addFormError,
  onLookUpPodcast,
  onCancelAddPreview,
  onConfirmAddPodcast,
  onRemovePodcast
}: Props) {
  const [addRawInput, setAddRawInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const { anyBusy, addInteractionLocked: interactionLocked } = useSubscriptionPageLocks(
    busy,
    podcastsBusy,
    channelsBusy,
    addPreviewLoading,
    addConfirmBusy
  )

  const addBar = (
    <AddPodcastBar
      addPreview={addPreview}
      addPreviewLoading={addPreviewLoading}
      addConfirmBusy={addConfirmBusy}
      addFormError={addFormError}
      rawInput={addRawInput}
      onRawInputChange={setAddRawInput}
      onLookUp={() => onLookUpPodcast(addRawInput)}
      onCancelPreview={onCancelAddPreview}
      onConfirmAdd={async () => {
        const ok = await onConfirmAddPodcast()
        if (ok) setAddRawInput('')
      }}
      interactionLocked={interactionLocked}
      onOpenUrl={onOpenUrl}
    />
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">Podcasts</h1>
          <span className="text-xs font-mono text-text-muted bg-surface-raised px-2 py-0.5 rounded-full">
            {rows.length} show{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Apple search */}
        <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-2">
          <p className="text-[11px] text-text-muted">
            Search Apple Podcasts (iTunes catalog). Pick a show to preview and add.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery.trim() && !searchLoading && !interactionLocked) {
                  e.preventDefault()
                  onSearch(searchQuery)
                }
              }}
              disabled={interactionLocked || searchLoading}
              placeholder="Search podcasts…"
              className={subPageLookUpInputClass}
            />
            <button
              type="button"
              disabled={interactionLocked || searchLoading || !searchQuery.trim()}
              onClick={() => onSearch(searchQuery)}
              className={subPageLookUpButtonClass}
            >
              {searchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Search
            </button>
          </div>
          {searchError ? <p className="text-[11px] text-danger">{searchError}</p> : null}
          {searchResults.length > 0 ? (
            <ul className="max-h-40 overflow-y-auto divide-y divide-border border border-border rounded-md mt-2">
              {searchResults.map((hit) => (
                <li
                  key={hit.collectionId}
                  className="flex items-center gap-3 px-2 py-2 text-sm hover:bg-surface-overlay/60"
                >
                  {hit.artworkUrl ? (
                    <img
                      src={hit.artworkUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="w-10 h-10 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-surface-overlay shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{hit.title}</p>
                    {hit.artistName ? (
                      <p className="text-[11px] text-text-muted truncate">{hit.artistName}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={interactionLocked}
                    onClick={() =>
                      onLookUpPodcast(hit.feedUrl, { artworkUrl: hit.artworkUrl ?? undefined })
                    }
                    className="text-[11px] font-medium px-2 py-1 rounded border border-accent-dim text-accent hover:bg-accent-dim shrink-0 disabled:opacity-40"
                  >
                    Preview
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {rows.length > 0 ? addBar : null}

        <SubscriptionMetadataToolbar
          anyBusy={anyBusy}
          onReload={onReload}
          onFetch={onFetchMeta}
          onRefetchAll={onRefetchAllMeta}
          fetchBusy={podcastsBusy}
          fetchIcon={<Mic2 size={13} />}
          fetchIconBusy={subscriptionToolbarFetchSpinner()}
          fetchLabel="Fetch metadata"
          statusHint={
            podcastsBusy && progress
              ? `${progress} · parallel yt-dlp`
              : 'cache 7d in app userData'
          }
        />

        <SubscriptionResolveProgressBar active={podcastsBusy} progress={progress} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted px-6 py-8 min-h-[240px]">
            <div className="w-full max-w-lg">{addBar}</div>
            <Mic2 size={40} strokeWidth={1.2} className="opacity-30" />
            <p className="text-sm text-center">No podcasts in podcasts.txt yet.</p>
            <p className="text-[11px] text-center max-w-sm">
              Search above or paste an RSS / Apple link, then use <strong>Look up</strong>.
            </p>
          </div>
        ) : (
          <table className="channel-table">
            <thead>
              <tr>
                <th className="w-12 pl-4 pr-1" aria-label="Art" />
                <th>Feed</th>
                <th>Title</th>
                <th>Status</th>
                <th className="w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <motion.tr
                  key={row.feedUrl || `row-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, delay: Math.min(i * 0.02, 0.5) }}
                >
                  <td className="pl-4 pr-1">
                    {row.logoUrl ? (
                      <img
                        className="w-8 h-8 rounded-md object-cover border border-border"
                        src={row.logoUrl}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-md bg-surface-overlay border border-border" />
                    )}
                  </td>
                  <td>
                    <span
                      className="text-xs font-mono truncate block max-w-[220px]"
                      title={row.feedUrl}
                    >
                      {row.feedUrl}
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
                        type="button"
                        onClick={() => onOpenUrl(row.feedUrl)}
                        className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-dim transition-colors"
                        title="Open feed"
                      >
                        <ExternalLink size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={busy || podcastsBusy}
                        onClick={() => void onRemovePodcast(row.feedUrl)}
                        className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-40"
                        title="Remove subscription"
                      >
                        <Trash2 size={13} />
                      </button>
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
