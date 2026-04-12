import type { ApplePodcastSearchResult } from '../../shared/ytdl-api'
import { LOG } from './constants'

type ItunesPodcastJson = {
  collectionId?: number
  collectionName?: string
  feedUrl?: string
  artworkUrl600?: string
  artworkUrl100?: string
  artistName?: string
}

function pickArtwork(j: ItunesPodcastJson): string | null {
  const a600 = j.artworkUrl600
  const a100 = j.artworkUrl100
  if (typeof a600 === 'string' && a600.startsWith('http')) return a600
  if (typeof a100 === 'string' && a100.startsWith('http')) return a100
  return null
}

/** Search Apple’s catalog for podcasts (public iTunes Search API). */
export async function searchApplePodcastsItunes(term: string): Promise<ApplePodcastSearchResult[]> {
  const q = term.trim()
  if (!q) return []
  const url = new URL('https://itunes.apple.com/search')
  url.searchParams.set('term', q)
  url.searchParams.set('media', 'podcast')
  url.searchParams.set('entity', 'podcast')
  url.searchParams.set('limit', '25')
  console.info(LOG, 'podcast itunes search', { termPreview: q.slice(0, 40) })
  const res = await fetch(url.toString(), { redirect: 'follow' })
  if (!res.ok) {
    console.warn(LOG, 'podcast itunes search HTTP', res.status)
    throw new Error(`iTunes search failed (${res.status})`)
  }
  const body = (await res.json()) as { results?: ItunesPodcastJson[] }
  const results = Array.isArray(body.results) ? body.results : []
  const out: ApplePodcastSearchResult[] = []
  for (const j of results) {
    const id = j.collectionId
    const feed = j.feedUrl
    const title = j.collectionName
    if (typeof id !== 'number' || typeof feed !== 'string' || !feed.startsWith('http')) continue
    if (typeof title !== 'string' || !title.trim()) continue
    out.push({
      collectionId: id,
      title: title.trim(),
      artistName: typeof j.artistName === 'string' ? j.artistName.trim() : null,
      feedUrl: feed.trim(),
      artworkUrl: pickArtwork(j)
    })
  }
  console.info(LOG, 'podcast itunes search done', { hits: out.length })
  return out
}

/** Resolve a show by Apple collection id (from podcasts.apple.com link). */
export async function lookupApplePodcastFeed(collectionId: string): Promise<{
  feedUrl: string | null
  title: string | null
  artworkUrl: string | null
}> {
  const url = new URL('https://itunes.apple.com/lookup')
  url.searchParams.set('id', collectionId)
  url.searchParams.set('entity', 'podcast')
  console.info(LOG, 'podcast itunes lookup', { collectionId })
  const res = await fetch(url.toString(), { redirect: 'follow' })
  if (!res.ok) {
    console.warn(LOG, 'podcast itunes lookup HTTP', res.status)
    throw new Error(`iTunes lookup failed (${res.status})`)
  }
  const body = (await res.json()) as { results?: ItunesPodcastJson[] }
  const results = Array.isArray(body.results) ? body.results : []
  const j = results[0]
  if (!j) {
    console.info(LOG, 'podcast itunes lookup empty results', { collectionId })
    return { feedUrl: null, title: null, artworkUrl: null }
  }
  const feed = typeof j.feedUrl === 'string' && j.feedUrl.startsWith('http') ? j.feedUrl.trim() : null
  const title =
    typeof j.collectionName === 'string' && j.collectionName.trim() ? j.collectionName.trim() : null
  const artworkUrl = pickArtwork(j)
  console.info(LOG, 'podcast itunes lookup ok', {
    collectionId,
    hasFeed: Boolean(feed),
    titlePreview: title?.slice(0, 40)
  })
  return { feedUrl: feed, title, artworkUrl }
}
