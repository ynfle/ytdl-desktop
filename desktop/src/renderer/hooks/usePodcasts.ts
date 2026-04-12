import { useCallback, useEffect, useState } from 'react'
import type { ApplePodcastSearchResult, PodcastInfoRow } from '../../../shared/ytdl-api'

/** Placeholder rows before network resolve (folderId filled when rows stream from main). */
function feedsToPlaceholderRows(feeds: string[]): PodcastInfoRow[] {
  return feeds.map((feedUrl) => ({
    feedUrl,
    folderId: '',
    displayName: null,
    feedPageUrl: null,
    error: null,
    logoUrl: null
  }))
}

/** Podcast subscriptions: Apple search, preview/add, hydrate, bulk resolve. */
export function usePodcasts(appendLog: (chunk: string) => void, dataDir: string) {
  const [podcastRows, setPodcastRows] = useState<PodcastInfoRow[]>([])
  const [podcastsBusy, setPodcastsBusy] = useState(false)
  const [podcastsProgress, setPodcastsProgress] = useState<string | null>(null)

  const [searchResults, setSearchResults] = useState<ApplePodcastSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [addPreview, setAddPreview] = useState<{ feedUrl: string; row: PodcastInfoRow } | null>(null)
  const [addPreviewLoading, setAddPreviewLoading] = useState(false)
  const [addConfirmBusy, setAddConfirmBusy] = useState(false)
  const [addFormError, setAddFormError] = useState<string | null>(null)

  const loadPodcastRows = useCallback(async () => {
    console.log('[usePodcasts] hydrate from cache')
    const r = await window.ytdl.hydratePodcastRowsFromCache()
    if (!r.ok) {
      appendLog(`[ui] podcasts table: ${r.error}\n`)
      setPodcastRows([])
      return
    }
    setPodcastRows(r.rows ?? [])
    console.log(`[usePodcasts] loaded ${r.rows?.length ?? 0} podcast rows`)
  }, [appendLog])

  useEffect(() => {
    void loadPodcastRows()
  }, [dataDir, loadPodcastRows])

  useEffect(() => {
    console.log('[usePodcasts] dataDir changed, clearing add preview')
    setAddPreview(null)
    setAddPreviewLoading(false)
    setAddConfirmBusy(false)
    setAddFormError(null)
    setSearchResults([])
    setSearchError(null)
  }, [dataDir])

  useEffect(() => {
    console.log('[usePodcasts] subscribe podcast resolve IPC')
    const offProgress = window.ytdl.onPodcastResolveProgress((p) => {
      setPodcastsProgress(`${p.index}/${p.total} · ${p.feedUrl.slice(0, 36)}…`)
    })
    const offRow = window.ytdl.onPodcastResolveRow((p) => {
      setPodcastRows((prev) => {
        const idx = p.index
        if (idx >= 0 && idx < prev.length) {
          const next = [...prev]
          next[idx] = p.row
          return next
        }
        const j = prev.findIndex((r) => r.feedUrl === p.row.feedUrl)
        if (j < 0) return prev
        const next = [...prev]
        next[j] = p.row
        return next
      })
    })
    const offDone = window.ytdl.onPodcastResolveDone((p) => {
      setPodcastsBusy(false)
      setPodcastsProgress(null)
      if (!p.ok) {
        appendLog(`[ui] podcast metadata: ${p.error ?? 'failed'}\n`)
        return
      }
      if (p.rows?.length) setPodcastRows(p.rows)
      appendLog(`[ui] podcast metadata: finished (${p.rows?.length ?? 0})\n`)
    })
    return () => {
      offProgress()
      offRow()
      offDone()
    }
  }, [appendLog])

  const refreshPodcastMeta = useCallback(
    async (force?: boolean) => {
      setPodcastsBusy(true)
      const fr = await window.ytdl.readPodcastFeeds()
      if (!fr.ok || !fr.feeds?.length) {
        appendLog(`[ui] podcast metadata: ${fr.error ?? 'no lines in podcasts.txt'}\n`)
        setPodcastsBusy(false)
        setPodcastsProgress(null)
        return
      }
      const feeds = fr.feeds
      setPodcastRows(feedsToPlaceholderRows(feeds))
      setPodcastsProgress(`0/${feeds.length}`)
      if (force) {
        appendLog('[ui] podcast metadata: refetch all (ignoring disk cache)\n')
      }
      console.log(`[usePodcasts] resolving ${feeds.length} podcasts, force=${Boolean(force)}`)
      const r = await window.ytdl.resolvePodcastInfo({ force: Boolean(force) })
      if (!r.ok || !r.started) {
        appendLog(`[ui] podcast metadata: ${r.error ?? 'could not start'}\n`)
        setPodcastsBusy(false)
        setPodcastsProgress(null)
      }
    },
    [appendLog]
  )

  const runAppleSearch = useCallback(
    async (term: string) => {
      setSearchError(null)
      setSearchResults([])
      const q = term.trim()
      if (!q) {
        setSearchError('Enter a search term.')
        return
      }
      setSearchLoading(true)
      try {
        console.log('[usePodcasts] searchApplePodcasts', q.slice(0, 40))
        const r = await window.ytdl.searchApplePodcasts(q)
        if (!r.ok || !r.results) {
          const msg = r.error ?? 'Search failed.'
          setSearchError(msg)
          appendLog(`[ui] podcast search: ${msg}\n`)
          return
        }
        setSearchResults(r.results)
        appendLog(`[ui] podcast search: ${r.results.length} results\n`)
      } finally {
        setSearchLoading(false)
      }
    },
    [appendLog]
  )

  const lookUpPodcast = useCallback(
    async (raw: string, opts?: { artworkUrl?: string | null }) => {
      setAddFormError(null)
      setAddPreview(null)
      setAddPreviewLoading(true)
      try {
        console.log('[usePodcasts] previewPodcast')
        const r = await window.ytdl.previewPodcast(raw, opts)
        if (!r.ok || !r.feedUrl || !r.row) {
          const msg = r.error ?? 'Look up failed.'
          appendLog(`[ui] podcast look up: ${msg}\n`)
          setAddFormError(msg)
          return
        }
        setAddPreview({ feedUrl: r.feedUrl, row: r.row })
        appendLog(`[ui] podcast look up ok: ${r.row.displayName ?? r.feedUrl.slice(0, 40)}\n`)
      } finally {
        setAddPreviewLoading(false)
      }
    },
    [appendLog]
  )

  const cancelAddPreview = useCallback(() => {
    setAddPreview(null)
    setAddFormError(null)
  }, [])

  const confirmAddPodcast = useCallback(async (): Promise<boolean> => {
    if (!addPreview) return false
    setAddConfirmBusy(true)
    setAddFormError(null)
    try {
      const feedUrl = addPreview.feedUrl
      console.log('[usePodcasts] addPodcast', feedUrl.slice(0, 48))
      const r = await window.ytdl.addPodcast(feedUrl)
      if (!r.ok) {
        const msg = r.duplicate ? 'This podcast is already in podcasts.txt.' : (r.error ?? 'Add failed.')
        appendLog(`[ui] add podcast: ${msg}\n`)
        setAddFormError(msg)
        return false
      }
      appendLog(`[ui] added podcast ${feedUrl.slice(0, 60)}…\n`)
      setAddPreview(null)
      await loadPodcastRows()
      return true
    } finally {
      setAddConfirmBusy(false)
    }
  }, [addPreview, appendLog, loadPodcastRows])

  const removePodcast = useCallback(
    async (feedUrl: string): Promise<boolean> => {
      console.log('[usePodcasts] removePodcast', feedUrl.slice(0, 48))
      const r = await window.ytdl.removePodcast(feedUrl)
      if (!r.ok) {
        const msg = r.notFound ? 'Not in podcasts.txt.' : (r.error ?? 'Remove failed.')
        appendLog(`[ui] remove podcast: ${msg}\n`)
        return false
      }
      appendLog(`[ui] removed podcast\n`)
      await loadPodcastRows()
      return true
    },
    [appendLog, loadPodcastRows]
  )

  return {
    podcastRows,
    podcastsBusy,
    podcastsProgress,
    loadPodcastRows,
    refreshPodcastMeta,
    searchResults,
    searchLoading,
    searchError,
    runAppleSearch,
    addPreview,
    addPreviewLoading,
    addConfirmBusy,
    addFormError,
    lookUpPodcast,
    cancelAddPreview,
    confirmAddPodcast,
    removePodcast
  }
}
