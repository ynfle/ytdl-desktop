import { useEffect, useRef, useState } from 'react'

/**
 * Resolve a data-relative path to the loopback `http://127.0.0.1:…` URL from main (`library:mediaUrl`).
 * Supersedes stale async results when `relPath` changes quickly.
 */
export function useLoopbackMediaUrl(relPath: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const genRef = useRef(0)

  useEffect(() => {
    if (!relPath) {
      setUrl(null)
      return
    }
    const gen = ++genRef.current
    void window.ytdl.mediaUrl(relPath).then((r) => {
      if (genRef.current !== gen) {
        console.info('[useLoopbackMediaUrl] stale result ignored', relPath)
        return
      }
      if (r.ok && r.url) {
        console.info('[useLoopbackMediaUrl] ok', relPath)
        setUrl(r.url)
        return
      }
      console.warn('[useLoopbackMediaUrl] failed', relPath, r.ok ? '' : r.error)
      setUrl(null)
    })
  }, [relPath])

  return url
}
