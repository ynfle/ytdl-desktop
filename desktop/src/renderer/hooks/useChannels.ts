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

  return {
    channelRows,
    channelsBusy,
    channelsProgress,
    loadChannelIdentifiers,
    refreshChannelNames
  }
}
