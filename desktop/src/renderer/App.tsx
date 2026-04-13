import { useCallback, useEffect, useState } from 'react'
import type { LibraryVideo, PlaybackSpotSnapshot } from '../../shared/ytdl-api'
import { AnimatePresence, motion } from 'motion/react'

import Sidebar, { type Page } from './components/Sidebar'
import LibraryPage from './components/Library'
import ChannelsPage from './components/Channels'
import DownloadsPage from './components/Downloads'
import PodcastsPage from './components/Podcasts'
import Player from './components/Player'
import QueueDrawer from './components/Queue'
import SettingsModal from './components/SettingsModal'

import { useSync } from './hooks/useSync'
import { useChannels } from './hooks/useChannels'
import { parseLibraryRelPath, useLibrary } from './hooks/useLibrary'
import { usePodcasts } from './hooks/usePodcasts'
import { usePlayback } from './hooks/usePlayback'

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

  useEffect(() => {
    console.log('[App] loading initial data directory')
    void window.ytdl.getDataDir().then(setDataDir)
  }, [])

  /* ── Hooks ── */
  const sync = useSync()
  const channels = useChannels(sync.appendLog, dataDir)
  const podcasts = usePodcasts(sync.appendLog, dataDir)
  const lib = useLibrary(sync.appendLog, dataDir, channels.channelRows, podcasts.podcastRows)
  const playback = usePlayback(sync.appendLog, lib.library, lib.allowSpotSaveRef)

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
    const picked = await window.ytdl.pickDataDir()
    if (!picked) return
    const r = await window.ytdl.setDataDir(picked)
    if (!r.ok) {
      sync.appendLog(`[ui] setDataDir failed: ${r.error}\n`)
      return
    }
    console.log(`[App] data dir changed to ${picked}`)
    lib.resetHydrate()
    setDataDir(picked)
  }, [sync, lib])

  const handleRescan = useCallback(async () => {
    const result = await lib.refreshLibrary()
    applyLibraryScanResult(result)
  }, [lib.refreshLibrary, applyLibraryScanResult])

  /** Permanently remove one media file from disk and prune playback state. */
  const handleDeleteLibraryItem = useCallback(
    async (relPath: string) => {
      const { fileName } = parseLibraryRelPath(relPath)
      if (
        !window.confirm(
          `Permanently delete "${fileName}" from your library? This cannot be undone.`
        )
      ) {
        return
      }
      console.log('[App] deleteLibraryMedia', relPath)
      const del = await window.ytdl.deleteLibraryMedia(relPath)
      if (!del.ok) {
        sync.appendLog(`[ui] delete failed: ${del.error ?? 'unknown'}\n`)
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
            onDelete={handleDeleteLibraryItem}
            isEmpty={lib.library.length === 0}
          />
        )
      case 'podcasts':
        return (
          <PodcastsPage
            rows={podcasts.podcastRows}
            busy={sync.busy}
            podcastsBusy={podcasts.podcastsBusy}
            channelsBusy={channels.channelsBusy}
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
            onRemovePodcast={(url) => void podcasts.removePodcast(url)}
          />
        )
      case 'channels':
        return (
          <ChannelsPage
            rows={channels.channelRows}
            busy={sync.busy}
            podcastsBusy={podcasts.podcastsBusy}
            channelsBusy={channels.channelsBusy}
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
          />
        )
      case 'downloads':
        return (
          <DownloadsPage
            busy={sync.busy}
            channelsBusy={channels.channelsBusy}
            podcastsBusy={podcasts.podcastsBusy}
            log={sync.log}
            ytrecCount={sync.ytrecCount}
            onYtrecCountChange={sync.setYtrecCount}
            onRunChannels={() => void sync.runChannels()}
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
        queueCount={playback.queue.length}
        onVideoEnded={playback.onVideoEnded}
        onVideoError={playback.onVideoError}
        onVideoTimeUpdate={playback.onVideoTimeUpdate}
        onVideoPauseOrSeeked={playback.onVideoPauseOrSeeked}
        documentPipActive={playback.documentPipActive || playback.floatingPlayerActive}
        floatingPlayerActive={playback.floatingPlayerActive}
        floatingSync={playback.floatingSync}
        onFloatingSeek={playback.floatingSeek}
        onFloatingTogglePlay={playback.floatingTogglePlay}
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

      {/* Queue drawer */}
      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        queue={playback.queue}
        currentRel={playback.currentRel}
        onPlayFromIndex={playback.playFromQueueIndex}
        onRemove={playback.removeFromQueue}
      />

      {/* Settings modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        dataDir={dataDir}
        onPickDir={() => void pickDir()}
        onRescan={() => void handleRescan()}
        busy={sync.busy}
      />
    </div>
  )
}
