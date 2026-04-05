import { useCallback, useEffect, useRef, useState } from 'react'

const LOG_CAP = 200_000

/** Download sync state: channel + ytrec downloads, log accumulation, IPC subscriptions. */
export function useSync() {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [ytrecCount, setYtrecCount] = useState(5)
  const logEndRef = useRef<HTMLPreElement | null>(null)

  const appendLog = useCallback((chunk: string) => {
    setLog((prev) => (prev + chunk).slice(-LOG_CAP))
  }, [])

  /** Auto-scroll log terminal to bottom on new content. */
  useEffect(() => {
    const el = logEndRef.current?.parentElement
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  useEffect(() => {
    console.log('[useSync] subscribing to sync IPC events')
    const offLog = window.ytdl.onSyncLog(appendLog)
    const offDone = window.ytdl.onSyncDone((p) => {
      appendLog(
        p.ok ? '\n[ui] sync finished OK\n' : `\n[ui] sync finished with error: ${p.error ?? 'unknown'}\n`
      )
      setBusy(false)
    })
    return () => {
      offLog()
      offDone()
    }
  }, [appendLog])

  const runChannels = useCallback(async () => {
    setBusy(true)
    appendLog('\n[ui] starting channel sync…\n')
    const r = await window.ytdl.syncChannels()
    if (!r.ok) appendLog(`[ui] syncChannels invoke error: ${r.error}\n`)
    setBusy(false)
  }, [appendLog])

  const runYtrec = useCallback(async () => {
    setBusy(true)
    appendLog(`\n[ui] starting ytrec (${ytrecCount})…\n`)
    const r = await window.ytdl.syncYtrec(ytrecCount)
    if (!r.ok) appendLog(`[ui] syncYtrec invoke error: ${r.error}\n`)
    setBusy(false)
  }, [appendLog, ytrecCount])

  return {
    busy,
    log,
    appendLog,
    ytrecCount,
    setYtrecCount,
    runChannels,
    runYtrec,
    logEndRef
  }
}
