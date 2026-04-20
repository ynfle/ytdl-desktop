import { useCallback, useEffect, useState } from 'react'
import type { ChannelInfoRow } from '../../../shared/ytdl-api'

/** Placeholder rows before cache hydrate / resolve. */
function urlsToPlaceholderRows(urls: string[]): ChannelInfoRow[] {
  return urls.map((playlistUrl) => ({
    identifier: playlistUrl,
    videosUrl: playlistUrl,
    displayName: null,
    channelPageUrl: null,
    error: null,
    logoUrl: null
  }))
}

/** playlists.txt list: hydrate, yt-dlp resolve, add flow (same cache file as channels). */
export function usePlaylists(appendLog: (chunk: string) => void, dataDir: string) {
  const [playlistRows, setPlaylistRows] = useState<ChannelInfoRow[]>([])
  const [playlistsBusy, setPlaylistsBusy] = useState(false)
  const [playlistsProgress, setPlaylistsProgress] = useState<string | null>(null)

  const [addPreview, setAddPreview] = useState<{ playlistUrl: string; row: ChannelInfoRow } | null>(null)
  const [addPreviewLoading, setAddPreviewLoading] = useState(false)
  const [addConfirmBusy, setAddConfirmBusy] = useState(false)
  const [addFormError, setAddFormError] = useState<string | null>(null)

  const loadPlaylistRows = useCallback(async () => {
    console.log('[usePlaylists] hydrate playlist rows from cache')
    const r = await window.ytdl.hydratePlaylistRowsFromCache()
    if (!r.ok) {
      appendLog(`[ui] playlists table: ${r.error}\n`)
      setPlaylistRows([])
      return
    }
    setPlaylistRows(r.rows ?? [])
    console.log(`[usePlaylists] loaded ${r.rows?.length ?? 0} playlist rows`)
  }, [appendLog])

  useEffect(() => {
    void loadPlaylistRows()
  }, [dataDir, loadPlaylistRows])

  useEffect(() => {
    console.log('[usePlaylists] dataDir changed, clearing add-playlist preview')
    setAddPreview(null)
    setAddPreviewLoading(false)
    setAddConfirmBusy(false)
    setAddFormError(null)
  }, [dataDir])

  useEffect(() => {
    console.log('[usePlaylists] subscribing to playlist resolve IPC')
    const offProgress = window.ytdl.onPlaylistResolveProgress((p) => {
      setPlaylistsProgress(`${p.index}/${p.total} · ${p.identifier}`)
    })
    const offRow = window.ytdl.onPlaylistResolveRow((p) => {
      setPlaylistRows((prev) => {
        const idx = p.index
        if (idx >= 0 && idx < prev.length) {
          const next = [...prev]
          next[idx] = p.row
          return next
        }
        const j = prev.findIndex((r) => r.identifier === p.row.identifier)
        if (j < 0) return prev
        const next = [...prev]
        next[j] = p.row
        return next
      })
    })
    const offDone = window.ytdl.onPlaylistResolveDone((p) => {
      setPlaylistsBusy(false)
      setPlaylistsProgress(null)
      if (!p.ok) {
        appendLog(`[ui] playlist metadata: ${p.error ?? 'failed'}\n`)
        return
      }
      if (p.rows?.length) setPlaylistRows(p.rows)
      appendLog(`[ui] playlist metadata: finished (${p.rows?.length ?? 0})\n`)
    })
    return () => {
      offProgress()
      offRow()
      offDone()
    }
  }, [appendLog])

  const refreshPlaylistMeta = useCallback(
    async (force?: boolean) => {
      setPlaylistsBusy(true)
      const ur = await window.ytdl.readPlaylistUrls()
      if (!ur.ok || !ur.urls?.length) {
        appendLog(`[ui] playlist metadata: ${ur.error ?? 'no lines in playlists.txt'}\n`)
        setPlaylistsBusy(false)
        setPlaylistsProgress(null)
        return
      }
      const urls = ur.urls
      setPlaylistRows(urlsToPlaceholderRows(urls))
      setPlaylistsProgress(`0/${urls.length}`)
      if (force) {
        appendLog('[ui] playlist metadata: refetch all (ignoring disk cache)\n')
      }
      console.log(`[usePlaylists] resolving ${urls.length} playlists, force=${Boolean(force)}`)
      const r = await window.ytdl.resolvePlaylistInfo({ force: Boolean(force) })
      if (!r.ok || !r.started) {
        appendLog(`[ui] playlist metadata: ${r.error ?? 'could not start'}\n`)
        setPlaylistsBusy(false)
        setPlaylistsProgress(null)
      }
    },
    [appendLog]
  )

  const lookUpPlaylist = useCallback(
    async (raw: string) => {
      setAddFormError(null)
      setAddPreview(null)
      setAddPreviewLoading(true)
      try {
        console.log('[usePlaylists] previewPlaylist request')
        const r = await window.ytdl.previewPlaylist(raw)
        if (!r.ok || !r.playlistUrl || !r.row) {
          const msg = r.error ?? 'Look up failed.'
          appendLog(`[ui] playlist look up: ${msg}\n`)
          setAddFormError(msg)
          console.warn('[usePlaylists] previewPlaylist failed', msg)
          return
        }
        setAddPreview({ playlistUrl: r.playlistUrl, row: r.row })
        appendLog(`[ui] playlist look up ok: ${r.row.displayName ?? r.playlistUrl.slice(0, 48)}\n`)
        console.log('[usePlaylists] previewPlaylist ok', r.playlistUrl.slice(0, 48))
      } finally {
        setAddPreviewLoading(false)
      }
    },
    [appendLog]
  )

  const cancelAddPreview = useCallback(() => {
    console.log('[usePlaylists] add playlist preview cancelled')
    setAddPreview(null)
    setAddFormError(null)
  }, [])

  const confirmAddPlaylist = useCallback(async (): Promise<boolean> => {
    if (!addPreview) return false
    setAddConfirmBusy(true)
    setAddFormError(null)
    try {
      const url = addPreview.playlistUrl
      console.log('[usePlaylists] addPlaylist confirm', url.slice(0, 48))
      const r = await window.ytdl.addPlaylist(url)
      if (!r.ok) {
        const msg = r.duplicate ? 'This playlist is already in playlists.txt.' : (r.error ?? 'Add failed.')
        appendLog(`[ui] add playlist: ${msg}\n`)
        setAddFormError(msg)
        console.warn('[usePlaylists] addPlaylist failed', msg)
        return false
      }
      appendLog(`[ui] added playlist ${url.slice(0, 64)}…\n`)
      setAddPreview(null)
      await loadPlaylistRows()
      console.log('[usePlaylists] addPlaylist done')
      return true
    } finally {
      setAddConfirmBusy(false)
    }
  }, [addPreview, appendLog, loadPlaylistRows])

  /** Drop one URL line from playlists.txt and reload from cache. */
  const removePlaylist = useCallback(
    async (playlistUrl: string): Promise<boolean> => {
      console.log('[usePlaylists] removePlaylist', playlistUrl.slice(0, 72))
      const r = await window.ytdl.removePlaylist(playlistUrl)
      if (!r.ok) {
        const msg = r.notFound ? 'Not in playlists.txt.' : (r.error ?? 'Remove failed.')
        appendLog(`[ui] remove playlist: ${msg}\n`)
        console.warn('[usePlaylists] removePlaylist failed', msg)
        return false
      }
      appendLog(`[ui] removed playlist from list\n`)
      await loadPlaylistRows()
      console.log('[usePlaylists] removePlaylist done')
      return true
    },
    [appendLog, loadPlaylistRows]
  )

  return {
    playlistRows,
    playlistsBusy,
    playlistsProgress,
    loadPlaylistRows,
    refreshPlaylistMeta,
    addPreview,
    addPreviewLoading,
    addConfirmBusy,
    addFormError,
    lookUpPlaylist,
    cancelAddPreview,
    confirmAddPlaylist,
    removePlaylist
  }
}
