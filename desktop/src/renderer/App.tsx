import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryVideo, PlaybackSpotSnapshot } from '../../shared/ytdl-api'
import { AnimatePresence, motion } from 'motion/react'

import Sidebar, { type Page } from './components/Sidebar'
import LibraryPage from './components/Library'
import ChannelsPage from './components/Channels'
import DownloadsPage from './components/Downloads'
import PlaylistsPage from './components/Playlists'
import PodcastsPage from './components/Podcasts'
import Player from './components/Player'
import QueueDrawer from './components/Queue'
import SettingsModal from './components/SettingsModal'

import { useSync } from './hooks/useSync'
import { useChannels } from './hooks/useChannels'
import { usePlaylists } from './hooks/usePlaylists'
import {
  displayTitleForRelPath,
  libraryItemDisplayTitle,
  parseLibraryRelPath,
  useLibrary
} from './hooks/useLibrary'
import { usePodcasts } from './hooks/usePodcasts'
import { usePlayback } from './hooks/usePlayback'
import { useLoopbackMediaUrl } from './hooks/useLoopbackMediaUrl'

/**
 * App shell: sidebar navigation, page switching, persistent player bar,
 * queue drawer, and settings modal. All state is composed from custom hooks.
 */
export default function App(): React.ReactElement {
  /* ── Global state ── */
  const [dataDir, setDataDir] = useState('')
  const [activePage, setActivePage] = useState<Page>('library')
  const [queueOpen, setQueueOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Inline Settings error for data-directory pick/set failures (also logged to the sync log). */
  const [settingsError, setSettingsError] = useState<string | null>(null)
  /** True while Settings → Rescan library is running (disables the button + shows spinner). */
  const [rescanning, setRescanning] = useState(false)
  /** Drives app-level backdrop blur; overlay must sit above <Player /> in the tree, not inside <Sidebar />. */
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  useEffect(() => {
    console.log('[App] loading initial data directory')
    void window.ytdl.getDataDir().then(setDataDir)
  }, [])

  useEffect(() => {
    console.info('[App] sidebar main-column blur', { active: sidebarExpanded })
  }, [sidebarExpanded])

  /* ── Hooks ── */
  const sync = useSync()
  const channels = useChannels(sync.appendLog, dataDir)
  const playlists = usePlaylists(sync.appendLog, dataDir)
  const podcasts = usePodcasts(sync.appendLog, dataDir)
  const lib = useLibrary(sync.appendLog, dataDir, channels.channelRows, podcasts.podcastRows)
  const playback = usePlayback(sync.appendLog, lib.library, lib.allowSpotSaveRef, podcasts.podcastRows)

  /** Per-file sidecar thumb + group logo (podcast show / channel avatar) for queue rows. */
  const libraryThumbByRel = useMemo(() => {
    const m = new Map<
      string,
      { thumbRelPath: string | null; fallbackImageUrl: string | null; displayTitle: string }
    >()
    for (const g of lib.libraryGroups) {
      for (const item of g.items) {
        m.set(item.relPath, {
          thumbRelPath: item.thumbRelPath,
          fallbackImageUrl: g.logoUrl,
          displayTitle: libraryItemDisplayTitle(item)
        })
      }
    }
    return m
  }, [lib.libraryGroups])

  const currentTrackDisplayTitle = useMemo(
    () =>
      playback.currentRel != null
        ? displayTitleForRelPath(lib.library, playback.currentRel)
        : null,
    [lib.library, playback.currentRel]
  )

  const currentTrackThumbRel = useMemo(
    () => lib.library.find((v) => v.relPath === playback.currentRel)?.thumbRelPath ?? null,
    [lib.library, playback.currentRel]
  )
  /** Show cover when episode has no sidecar thumb yet. */
  const currentTrackPodcastLogoUrl = useMemo(() => {
    const rel = playback.currentRel
    if (!rel) return null
    const { groupKey, channelFolder } = parseLibraryRelPath(rel)
    if (!groupKey.startsWith('podcast/')) return null
    return podcasts.podcastRows.find((r) => r.folderId === channelFolder)?.logoUrl ?? null
  }, [playback.currentRel, podcasts.podcastRows])
  const episodeThumbLoopbackUrl = useLoopbackMediaUrl(currentTrackThumbRel)
  const displayArtworkUrl = episodeThumbLoopbackUrl ?? currentTrackPodcastLogoUrl ?? null

  /** Shared path after `scanLibrary`: merge resume/session from disk into playback state. */
  const applyLibraryScanResult = useCallback(
    (result: {
      videos: LibraryVideo[]
      freshHydrate: boolean
      snapshot?: PlaybackSpotSnapshot
      positionsOnly?: boolean
    }) => {
      const valid = new Set(result.videos.map((v) => v.relPath))
      if (result.freshHydrate && result.snapshot) {
        playback.restoreFromSnapshot(result.snapshot, valid)
      } else if (result.positionsOnly && result.snapshot) {
        playback.mergePositionsFromSnapshot(result.snapshot, valid)
      }
    },
    [playback.restoreFromSnapshot, playback.mergePositionsFromSnapshot]
  )

  /**
   * Initial hydrate: when library refreshes for a new data root,
   * restore the playback session from snapshot.
   * Do not gate restore on an effect cleanup flag — React Strict Mode can abort the first effect
   * after refreshLibrary already marked the root hydrated, which would skip restore entirely.
   */
  useEffect(() => {
    const run = async (): Promise<void> => {
      const result = await lib.refreshLibrary()
      applyLibraryScanResult(result)
    }
    void run()
    // Only re-run on dataDir change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataDir])

  /**
   * Channel sync and ytrec both end with sync:done from main; rescan so new files
   * show in the library without a manual settings rescan.
   */
  useEffect(() => {
    console.log('[App] subscribe sync:done → library rescan')
    const off = window.ytdl.onSyncDone((p) => {
      console.info('[App] sync finished, refreshing library', { ok: p.ok, error: p.error })
      void lib.refreshLibrary().then(applyLibraryScanResult)
    })
    return () => {
      console.log('[App] unsubscribe sync:done library rescan')
      off()
    }
  }, [lib.refreshLibrary, applyLibraryScanResult])

  /** While sync runs, new files under `videos/` trigger a debounced rescan from main. */
  useEffect(() => {
    console.log('[App] subscribe sync:libraryStale → library rescan')
    const off = window.ytdl.onSyncLibraryStale((p) => {
      console.info('[App] library stale during sync, refreshing', p)
      void lib.refreshLibrary().then(applyLibraryScanResult)
    })
    return () => {
      console.log('[App] unsubscribe sync:libraryStale')
      off()
    }
  }, [lib.refreshLibrary, applyLibraryScanResult])

  /* ── Actions ── */
  const pickDir = useCallback(async () => {
    let picked: string | null
    let r: { ok: boolean; error?: string }
    try {
      picked = await window.ytdl.pickDataDir()
      if (!picked) {
        console.info('[App] data dir pick cancelled')
        return
      }
      r = await window.ytdl.setDataDir(picked)
    } catch (err) {
      // IPC itself threw (e.g. handler missing): keep logging + show inline.
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[App] pick/set data dir threw', { error: msg })
      sync.appendLog(`[ui] data dir change failed: ${msg}\n`)
      setSettingsError(`Could not change data directory: ${msg}`)
      return
    }
    if (!r.ok) {
      console.warn('[App] setDataDir failed', { picked, error: r.error })
      sync.appendLog(`[ui] setDataDir failed: ${r.error}\n`)
      // Surface inline in Settings too, not only in the Downloads log.
      setSettingsError(`Could not use that folder: ${r.error ?? 'unknown error'}`)
      return
    }
    console.log(`[App] data dir changed to ${picked}`)
    setSettingsError(null)
    lib.resetHydrate()
    setDataDir(picked)
  }, [sync, lib])

  /** Settings → Rescan library; tracks `rescanning` so the button can show progress. */
  const handleRescan = useCallback(async () => {
    console.info('[App] settings rescan start')
    setRescanning(true)
    try {
      const result = await lib.refreshLibrary()
      applyLibraryScanResult(result)
      console.info('[App] settings rescan done', { count: result.videos.length })
    } finally {
      setRescanning(false)
    }
  }, [lib.refreshLibrary, applyLibraryScanResult])

  /** Close Settings and drop any stale inline error. */
  const closeSettings = useCallback(() => {
    console.log('[App] settings closed')
    setSettingsOpen(false)
    setSettingsError(null)
  }, [])

  /** Channel row already confirmed via DeleteButton. */
  const handleRemoveChannel = useCallback(
    (identifier: string) => {
      console.log('[App] remove channel confirmed', identifier)
      void channels.removeChannel(identifier)
    },
    [channels.removeChannel]
  )

  /** Playlist row already confirmed via DeleteButton. */
  const handleRemovePlaylist = useCallback(
    (playlistUrl: string) => {
      console.log('[App] remove playlist confirmed', playlistUrl.slice(0, 64))
      void playlists.removePlaylist(playlistUrl)
    },
    [playlists.removePlaylist]
  )

  /** Podcast row already confirmed via DeleteButton. */
  const handleRemovePodcast = useCallback(
    (feedUrl: string) => {
      console.log('[App] remove podcast confirmed', feedUrl.slice(0, 64))
      void podcasts.removePodcast(feedUrl)
    },
    [podcasts.removePodcast]
  )

  /** Drawer row already confirmed via DeleteButton. */
  const handleRemovePlaylistIndex = useCallback(
    (playlistIndex: number) => {
      const all = [...playback.drawerUpNext, ...playback.drawerQueued]
      const hit = all.find((r) => r.playlistIndex === playlistIndex)
      const label = hit
        ? displayTitleForRelPath(lib.library, hit.relPath)
        : `queue item (index ${playlistIndex})`
      console.log('[App] remove queue playlist index confirmed', { playlistIndex, label })
      playback.removeFromPlaylistIndex(playlistIndex)
    },
    [
      playback.drawerQueued,
      playback.drawerUpNext,
      playback.removeFromPlaylistIndex,
      lib.library
    ]
  )

  /** Staging row already confirmed via DeleteButton. */
  const handleRemoveStagingIndex = useCallback(
    (index: number) => {
      const hit = playback.drawerStagingItems.find((r) => r.index === index)
      const label = hit
        ? displayTitleForRelPath(lib.library, hit.relPath)
        : `staging item ${index}`
      console.log('[App] remove staging index confirmed', { index, label })
      playback.removeFromStagingIndex(index)
    },
    [playback.drawerStagingItems, playback.removeFromStagingIndex, lib.library]
  )

  /** Permanently remove one media file from disk and prune playback state. Row button already confirmed. */
  const handleDeleteLibraryItem = useCallback(
    async (relPath: string) => {
      const label = displayTitleForRelPath(lib.library, relPath)
      console.log('[App] deleteLibraryMedia', { relPath, label })
      await playback.releaseMediaElementForDelete(relPath)
      const del = await window.ytdl.deleteLibraryMedia(relPath)
      if (!del.ok) {
        const errMsg = del.error ?? 'unknown'
        console.error('[App] deleteLibraryMedia failed', { relPath, error: errMsg })
        sync.appendLog(`[ui] delete failed: ${errMsg}\n`)
        window.alert(`Could not delete "${label}": ${errMsg}`)
        return
      }
      const remainingRels = new Set(
        lib.library.filter((v) => v.relPath !== relPath).map((v) => v.relPath)
      )
      await playback.handleLibraryFileDeleted(relPath, remainingRels)
      const result = await lib.refreshLibrary()
      applyLibraryScanResult(result)
    },
    [
      applyLibraryScanResult,
      lib.library,
      lib.refreshLibrary,
      playback.handleLibraryFileDeleted,
      playback.releaseMediaElementForDelete,
      sync
    ]
  )

  const handleOpenUrl = useCallback(
    (url: string) => {
      void window.ytdl.openExternalUrl(url).then((o) => {
        if (!o.ok) sync.appendLog(`[ui] open URL: ${o.error}\n`)
      })
    },
    [sync]
  )

  /* ── Page content ── */
  const renderPage = (): React.ReactNode => {
    switch (activePage) {
      case 'library':
        return (
          <LibraryPage
            groups={lib.libraryGroups}
            currentRel={playback.currentRel}
            onQueue={playback.addToQueue}
            onPlayFrom={playback.playFromLibraryRel}
            onPlayFromOrdered={playback.playFromOrderedRels}
            onDelete={handleDeleteLibraryItem}
            isEmpty={lib.library.length === 0}
            scanning={lib.scanning}
            scanError={lib.scanError}
          />
        )
      case 'channels':
        return (
          <ChannelsPage
            rows={channels.channelRows}
            listLoaded={channels.listLoaded}
            busy={sync.busy}
            podcastsBusy={podcasts.podcastsBusy}
            channelsBusy={channels.channelsBusy}
            playlistsBusy={playlists.playlistsBusy}
            playlistAddPreviewLoading={playlists.addPreviewLoading}
            playlistAddConfirmBusy={playlists.addConfirmBusy}
            progress={channels.channelsProgress}
            onReload={() => void channels.loadChannelIdentifiers()}
            onFetchNames={() => void channels.refreshChannelNames(false)}
            onRefetchAll={() => void channels.refreshChannelNames(true)}
            onOpenUrl={handleOpenUrl}
            addPreview={channels.addPreview}
            addPreviewLoading={channels.addPreviewLoading}
            addConfirmBusy={channels.addConfirmBusy}
            addFormError={channels.addFormError}
            onLookUpChannel={(raw) => void channels.lookUpChannel(raw)}
            onCancelAddPreview={channels.cancelAddPreview}
            onConfirmAddChannel={() => channels.confirmAddChannel()}
            onRemoveChannel={handleRemoveChannel}
          />
        )
      case 'playlists':
        return (
          <PlaylistsPage
            rows={playlists.playlistRows}
            listLoaded={playlists.listLoaded}
            busy={sync.busy}
            podcastsBusy={podcasts.podcastsBusy}
            channelsBusy={channels.channelsBusy}
            channelsAddPreviewLoading={channels.addPreviewLoading}
            channelsAddConfirmBusy={channels.addConfirmBusy}
            playlistsBusy={playlists.playlistsBusy}
            progress={playlists.playlistsProgress}
            onReload={() => void playlists.loadPlaylistRows()}
            onFetchMeta={() => void playlists.refreshPlaylistMeta(false)}
            onRefetchAllMeta={() => void playlists.refreshPlaylistMeta(true)}
            onOpenUrl={handleOpenUrl}
            addPreview={playlists.addPreview}
            addPreviewLoading={playlists.addPreviewLoading}
            addConfirmBusy={playlists.addConfirmBusy}
            addFormError={playlists.addFormError}
            onLookUpPlaylist={(raw) => void playlists.lookUpPlaylist(raw)}
            onCancelAddPreview={playlists.cancelAddPreview}
            onConfirmAddPlaylist={() => playlists.confirmAddPlaylist()}
            onRemovePlaylist={handleRemovePlaylist}
          />
        )
      case 'podcasts':
        return (
          <PodcastsPage
            rows={podcasts.podcastRows}
            listLoaded={podcasts.listLoaded}
            busy={sync.busy}
            podcastsBusy={podcasts.podcastsBusy}
            channelsBusy={channels.channelsBusy}
            channelsAddPreviewLoading={channels.addPreviewLoading}
            channelsAddConfirmBusy={channels.addConfirmBusy}
            playlistsBusy={playlists.playlistsBusy}
            playlistAddPreviewLoading={playlists.addPreviewLoading}
            playlistAddConfirmBusy={playlists.addConfirmBusy}
            progress={podcasts.podcastsProgress}
            onReload={() => void podcasts.loadPodcastRows()}
            onFetchMeta={() => void podcasts.refreshPodcastMeta(false)}
            onRefetchAllMeta={() => void podcasts.refreshPodcastMeta(true)}
            onOpenUrl={handleOpenUrl}
            searchResults={podcasts.searchResults}
            searchLoading={podcasts.searchLoading}
            searchError={podcasts.searchError}
            onSearch={(q) => void podcasts.runAppleSearch(q)}
            addPreview={podcasts.addPreview}
            addPreviewLoading={podcasts.addPreviewLoading}
            addConfirmBusy={podcasts.addConfirmBusy}
            addFormError={podcasts.addFormError}
            onLookUpPodcast={(raw, opts) => void podcasts.lookUpPodcast(raw, opts)}
            onCancelAddPreview={podcasts.cancelAddPreview}
            onConfirmAddPodcast={() => podcasts.confirmAddPodcast()}
            onRemovePodcast={handleRemovePodcast}
          />
        )
      case 'downloads':
        return (
          <DownloadsPage
            busy={sync.busy}
            channelsBusy={channels.channelsBusy}
            podcastsBusy={podcasts.podcastsBusy}
            playlistsBusy={playlists.playlistsBusy}
            log={sync.log}
            ytrecCount={sync.ytrecCount}
            onYtrecCountChange={sync.setYtrecCount}
            onRunChannels={() => void sync.runChannels()}
            onRunPlaylists={() => void sync.runPlaylists()}
            onRunYtrec={() => void sync.runYtrec()}
            onRunPodcasts={() => void sync.runPodcasts()}
          />
        )
    }
  }

  return (
    <div className="flex h-full bg-bg">
      {/* Sidebar navigation */}
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        onOpenSettings={() => setSettingsOpen(true)}
        onExpandedChange={setSidebarExpanded}
      />

      {/* Pages + right video; transport / seek bar spans full width below (not under sidebar). */}
      <Player
        videoRef={playback.videoRef}
        currentRel={playback.currentRel}
        playing={playback.playing}
        onPlay={playback.startPreferredPlaylist}
        onStop={playback.stopPlayback}
        onPip={() => void playback.enterPip()}
        onSkipNext={playback.skipNext}
        onToggleQueue={() => setQueueOpen((o) => !o)}
        queueCount={playback.upcomingTransportCount}
        onVideoEnded={playback.onVideoEnded}
        onVideoError={playback.onVideoError}
        onVideoTimeUpdate={playback.onVideoTimeUpdate}
        onVideoPauseOrSeeked={playback.onVideoPauseOrSeeked}
        documentPipActive={playback.documentPipActive || playback.floatingPlayerActive}
        floatingPlayerActive={playback.floatingPlayerActive}
        floatingSync={playback.floatingSync}
        onFloatingSeek={playback.floatingSeek}
        onFloatingTogglePlay={playback.floatingTogglePlay}
        posterUrl={displayArtworkUrl}
        currentDisplayTitle={currentTrackDisplayTitle}
      >
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </div>
      </Player>

      {/* Blur over library + video only when sidebar hover-expanded; here so backdrop-filter samples <Player />. */}
      <motion.div
        aria-hidden={!sidebarExpanded}
        className="sidebar-content-blur pointer-events-none fixed top-0 right-0 bottom-0 left-14 z-20"
        initial={false}
        animate={{ opacity: sidebarExpanded ? 1 : 0 }}
        transition={{ duration: 0.42, ease: [0.25, 0.1, 0.25, 1] }}
      />

      {/* Queue drawer */}
      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        drawerMode={playback.queueDrawerMode}
        upNext={playback.drawerUpNext}
        queued={playback.drawerQueued}
        stagingItems={playback.drawerStagingItems}
        currentRel={playback.currentRel}
        onPlayPlaylistIndex={playback.playFromPlaylistIndex}
        onPlayStagingIndex={playback.playFromStagingIndex}
        onRemovePlaylistIndex={handleRemovePlaylistIndex}
        onRemoveStagingIndex={handleRemoveStagingIndex}
        thumbByRel={libraryThumbByRel}
      />

      {/* Settings modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        dataDir={dataDir}
        onPickDir={() => void pickDir()}
        onRescan={() => void handleRescan()}
        busy={sync.busy}
        error={settingsError}
        rescanning={rescanning}
      />
    </div>
  )
}
