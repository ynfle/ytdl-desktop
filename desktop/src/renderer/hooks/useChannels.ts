import { useCallback, useEffect, useState } from 'react'
import type { ChannelInfoRow } from '../../../shared/ytdl-api'

/** Placeholder rows from raw identifiers (before network resolve). */
function identifiersToPlaceholderRows(identifiers: string[]): ChannelInfoRow[] {
  return identifiers.map((identifier) => ({
    identifier,
    videosUrl: `https://www.youtube.com/${identifier}/videos`,
    displayName: null,
    channelPageUrl: null,
    error: null,
    logoUrl: null
  }))
}

/** Channel list management: read, hydrate from cache, resolve via yt-dlp, IPC subscriptions. */
export function useChannels(appendLog: (chunk: string) => void, dataDir: string) {
  const [channelRows, setChannelRows] = useState<ChannelInfoRow[]>([])
  const [channelsBusy, setChannelsBusy] = useState(false)
  const [channelsProgress, setChannelsProgress] = useState<string | null>(null)

  /** Validated row from Look up, before user confirms Add to channels.txt. */
  const [addPreview, setAddPreview] = useState<{ identifier: string; row: ChannelInfoRow } | null>(null)
  const [addPreviewLoading, setAddPreviewLoading] = useState(false)
  const [addConfirmBusy, setAddConfirmBusy] = useState(false)
  const [addFormError, setAddFormError] = useState<string | null>(null)

  const loadChannelIdentifiers = useCallback(async () => {
    console.log('[useChannels] hydrating channel rows from cache')
    const r = await window.ytdl.hydrateChannelRowsFromCache()
    if (!r.ok) {
      appendLog(`[ui] channels table: ${r.error}\n`)
      setChannelRows([])
      return
    }
    setChannelRows(r.rows ?? [])
    console.log(`[useChannels] loaded ${r.rows?.length ?? 0} channel rows`)
  }, [appendLog])

  /** Load channels on mount and when dataDir changes. */
  useEffect(() => {
    void loadChannelIdentifiers()
  }, [dataDir, loadChannelIdentifiers])

  /** Drop add-channel draft when switching data root. */
  useEffect(() => {
    console.log('[useChannels] dataDir changed, clearing add-channel preview')
    setAddPreview(null)
    setAddPreviewLoading(false)
    setAddConfirmBusy(false)
    setAddFormError(null)
  }, [dataDir])

  /** Subscribe to channel resolve IPC events. */
  useEffect(() => {
    console.log('[useChannels] subscribing to channel resolve IPC')
    const offProgress = window.ytdl.onChannelResolveProgress((p) => {
      setChannelsProgress(`${p.index}/${p.total} · ${p.identifier}`)
    })
    const offRow = window.ytdl.onChannelResolveRow((p) => {
      setChannelRows((prev) => {
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
    const offDone = window.ytdl.onChannelResolveDone((p) => {
      setChannelsBusy(false)
      setChannelsProgress(null)
      if (!p.ok) {
        appendLog(`[ui] channel names: ${p.error ?? 'failed'}\n`)
        return
      }
      if (p.rows?.length) setChannelRows(p.rows)
      appendLog(`[ui] channel names: finished (${p.rows?.length ?? 0})\n`)
    })
    return () => {
      offProgress()
      offRow()
      offDone()
    }
  }, [appendLog])

  const refreshChannelNames = useCallback(
    async (force?: boolean) => {
      setChannelsBusy(true)
      const idr = await window.ytdl.readChannelIdentifiers()
      if (!idr.ok || !idr.identifiers?.length) {
        appendLog(`[ui] channel names: ${idr.error ?? 'no lines in channels.txt'}\n`)
        setChannelsBusy(false)
        setChannelsProgress(null)
        return
      }
      const ids = idr.identifiers
      setChannelRows(identifiersToPlaceholderRows(ids))
      setChannelsProgress(`0/${ids.length}`)
      if (force) {
        appendLog('[ui] channel names: refetch all (ignoring disk cache)\n')
      }
      console.log(`[useChannels] resolving ${ids.length} channels, force=${Boolean(force)}`)
      const r = await window.ytdl.resolveChannelInfo({ force: Boolean(force) })
      if (!r.ok || !r.started) {
        appendLog(`[ui] channel names: ${r.error ?? 'could not start'}\n`)
        setChannelsBusy(false)
        setChannelsProgress(null)
      }
    },
    [appendLog]
  )

  const lookUpChannel = useCallback(
    async (raw: string) => {
      setAddFormError(null)
      setAddPreview(null)
      setAddPreviewLoading(true)
      try {
        console.log('[useChannels] previewChannel request')
        const r = await window.ytdl.previewChannel(raw)
        if (!r.ok || !r.identifier || !r.row) {
          const msg = r.error ?? 'Look up failed.'
          appendLog(`[ui] channel look up: ${msg}\n`)
          setAddFormError(msg)
          console.warn('[useChannels] previewChannel failed', msg)
          return
        }
        setAddPreview({ identifier: r.identifier, row: r.row })
        appendLog(`[ui] channel look up ok: ${r.row.displayName ?? r.identifier}\n`)
        console.log('[useChannels] previewChannel ok', r.identifier)
      } finally {
        setAddPreviewLoading(false)
      }
    },
    [appendLog]
  )

  const cancelAddPreview = useCallback(() => {
    console.log('[useChannels] add channel preview cancelled')
    setAddPreview(null)
    setAddFormError(null)
  }, [])

  const confirmAddChannel = useCallback(async (): Promise<boolean> => {
    if (!addPreview) return false
    setAddConfirmBusy(true)
    setAddFormError(null)
    try {
      const id = addPreview.identifier
      console.log('[useChannels] addChannel confirm', id)
      const r = await window.ytdl.addChannel(id)
      if (!r.ok) {
        const msg = r.duplicate ? 'This channel is already in channels.txt.' : (r.error ?? 'Add failed.')
        appendLog(`[ui] add channel: ${msg}\n`)
        setAddFormError(msg)
        console.warn('[useChannels] addChannel failed', msg)
        return false
      }
      appendLog(`[ui] added channel ${id}\n`)
      setAddPreview(null)
      await loadChannelIdentifiers()
      console.log('[useChannels] addChannel done', id)
      return true
    } finally {
      setAddConfirmBusy(false)
    }
  }, [addPreview, appendLog, loadChannelIdentifiers])

  /** Drop one identifier from channels.txt and reload the table from cache. */
  const removeChannel = useCallback(
    async (identifier: string): Promise<boolean> => {
      console.log('[useChannels] removeChannel', identifier)
      if (typeof window.ytdl.removeChannel !== 'function') {
        const msg = 'removeChannel is missing from preload (rebuild or restart dev after preload changes).'
        appendLog(`[ui] remove channel: ${msg}\n`)
        window.alert(msg)
        return false
      }
      try {
        const r = await window.ytdl.removeChannel(identifier)
        if (!r.ok) {
          const msg = r.notFound ? 'Not in channels.txt (line may differ from the table row).' : (r.error ?? 'Remove failed.')
          appendLog(`[ui] remove channel: ${msg}\n`)
          console.warn('[useChannels] removeChannel failed', msg)
          window.alert(msg)
          return false
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        appendLog(`[ui] remove channel: ${msg}\n`)
        console.error('[useChannels] removeChannel invoke error', e)
        window.alert(`Remove channel failed: ${msg}`)
        return false
      }
      appendLog(`[ui] removed channel from list\n`)
      await loadChannelIdentifiers()
      console.log('[useChannels] removeChannel done', identifier)
      return true
    },
    [appendLog, loadChannelIdentifiers]
  )

  return {
    channelRows,
    channelsBusy,
    channelsProgress,
    loadChannelIdentifiers,
    refreshChannelNames,
    addPreview,
    addPreviewLoading,
    addConfirmBusy,
    addFormError,
    lookUpChannel,
    cancelAddPreview,
    confirmAddChannel,
    removeChannel
  }
}
