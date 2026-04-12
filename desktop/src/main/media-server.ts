import { createReadStream } from 'fs'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import { join, normalize } from 'path'
import { promises as fs } from 'fs'
import { getDataDir, isPathInsideRoot } from './config-store'
import {
  channelLogoFilePath,
  isPathInsideChannelLogos,
  pathExists,
  peekImageMime
} from './channel-logos'
import { isPathInsidePodcastLogos, podcastLogoFilePath } from './podcast-logos'
import { LOG } from './constants'
import { mimeForFile } from './mime-utils'

/** Loopback HTTP server so <video> gets a real http:// URL (Chromium blocks custom schemes here). */
let mediaServer: http.Server | null = null
let mediaPort = 0
let mediaSecret = ''

export function getMediaAuth(): { port: number; secret: string } | null {
  if (mediaPort <= 0 || !mediaSecret) return null
  return { port: mediaPort, secret: mediaSecret }
}

/** Public loopback URL for `<img src>`; token is reversible only for our own hash lookup. */
export function channelLogoLoopbackUrl(identifier: string): string | null {
  if (mediaPort <= 0 || !mediaSecret) return null
  const token = Buffer.from(identifier, 'utf8').toString('base64url')
  return `http://127.0.0.1:${mediaPort}/${mediaSecret}/logo/${token}`
}

/** Loopback URL for podcast cover art in userData (`podcast-logos/<folderId>.cover`). */
export function podcastLogoLoopbackUrl(folderId: string): string | null {
  if (mediaPort <= 0 || !mediaSecret) return null
  const token = Buffer.from(folderId, 'utf8').toString('base64url')
  return `http://127.0.0.1:${mediaPort}/${mediaSecret}/podcast-logo/${token}`
}

/** Only our loopback media port may load in the floating player window. */
export function isAllowedFloatingMediaUrl(url: string): boolean {
  if (mediaPort <= 0) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    const loopback =
      host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
    if (!loopback) return false
    const urlPort = u.port === '' ? '80' : u.port
    return urlPort === String(mediaPort)
  } catch {
    return false
  }
}

export function stopMediaServer(): void {
  if (mediaServer) {
    console.info(LOG, 'closing loopback media server')
    mediaServer.close()
    mediaServer = null
    mediaPort = 0
    mediaSecret = ''
  }
}

export function startMediaServer(): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    stopMediaServer()
    mediaSecret = randomBytes(24).toString('hex')
    const server = http.createServer((req, res) => {
      void handleMediaHttp(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        mediaPort = addr.port
        mediaServer = server
        console.info(LOG, 'loopback media server listening', { host: '127.0.0.1', port: mediaPort })
        resolvePromise()
      } else {
        rejectPromise(new Error('media server: could not read bind address'))
      }
    })
    server.on('error', (err) => {
      console.error(LOG, 'media server listen error', err)
      rejectPromise(err)
    })
  })
}

async function handleMediaHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2 || parts[0] !== mediaSecret) {
      console.warn(LOG, 'media request rejected', { url: req.url })
      res.writeHead(403)
      res.end()
      return
    }

    /** Podcast cover: GET /secret/podcast-logo/<base64url(folderId)> */
    if (parts.length === 3 && parts[1] === 'podcast-logo') {
      let folderId: string
      try {
        folderId = Buffer.from(parts[2], 'base64url').toString('utf8')
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const full = podcastLogoFilePath(folderId)
      if (!isPathInsidePodcastLogos(full)) {
        res.writeHead(403)
        res.end()
        return
      }
      if (!(await pathExists(full))) {
        res.writeHead(404)
        res.end()
        return
      }
      const st = await fs.stat(full)
      if (!st.isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      const mime = await peekImageMime(full)
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': String(st.size), 'Content-Type': mime })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Length': String(st.size), 'Content-Type': mime })
      createReadStream(full)
        .on('error', (err) => {
          console.warn(LOG, 'podcast cover stream error', err)
          res.destroy()
        })
        .pipe(res)
      return
    }

    /** Cached channel avatar: GET /secret/logo/<base64url(identifier)> */
    if (parts.length === 3 && parts[1] === 'logo') {
      let identifier: string
      try {
        identifier = Buffer.from(parts[2], 'base64url').toString('utf8')
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const root = getDataDir()
      const full = channelLogoFilePath(root, identifier)
      if (!isPathInsideChannelLogos(full)) {
        res.writeHead(403)
        res.end()
        return
      }
      if (!(await pathExists(full))) {
        res.writeHead(404)
        res.end()
        return
      }
      const st = await fs.stat(full)
      if (!st.isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      const mime = await peekImageMime(full)
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': String(st.size), 'Content-Type': mime })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Length': String(st.size), 'Content-Type': mime })
      createReadStream(full)
        .on('error', (err) => {
          console.warn(LOG, 'channel logo stream error', err)
          res.destroy()
        })
        .pipe(res)
      return
    }

    if (parts.length !== 2) {
      console.warn(LOG, 'media request bad path', { url: req.url })
      res.writeHead(403)
      res.end()
      return
    }

    let rel: string
    try {
      rel = Buffer.from(parts[1], 'base64url').toString('utf8')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const root = getDataDir()
    const full = normalize(join(root, rel))
    if (!isPathInsideRoot(root, full)) {
      res.writeHead(403)
      res.end()
      return
    }
    await fs.access(full)
    const st = await fs.stat(full)
    if (!st.isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    const mime = mimeForFile(full)
    const range = req.headers.range
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': String(st.size),
        'Content-Type': mime,
        'Accept-Ranges': 'bytes'
      })
      res.end()
      return
    }
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(range)
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` })
        res.end()
        return
      }
      let start = m[1] !== '' ? parseInt(m[1], 10) : 0
      let end = m[2] !== '' ? parseInt(m[2], 10) : st.size - 1
      if (Number.isNaN(start)) start = 0
      if (Number.isNaN(end)) end = st.size - 1
      if (start >= st.size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` })
        res.end()
        return
      }
      end = Math.min(end, st.size - 1)
      const chunkLen = end - start + 1
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkLen),
        'Content-Type': mime
      })
      createReadStream(full, { start, end })
        .on('error', (err) => {
          console.warn(LOG, 'media stream read error', err)
          res.destroy()
        })
        .pipe(res)
      return
    }
    res.writeHead(200, {
      'Content-Length': String(st.size),
      'Content-Type': mime,
      'Accept-Ranges': 'bytes'
    })
    createReadStream(full)
      .on('error', (err) => {
        console.warn(LOG, 'media stream read error', err)
        res.destroy()
      })
      .pipe(res)
  } catch (e) {
    console.error(LOG, 'media http handler error', e)
    if (!res.headersSent) {
      res.writeHead(404)
      res.end()
    } else {
      res.destroy()
    }
  }
}
