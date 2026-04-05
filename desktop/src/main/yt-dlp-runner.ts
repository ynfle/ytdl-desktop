import { spawn } from 'child_process'
import { LOG } from './constants'
import { broadcastLog } from './broadcast'

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  const queue = [...items]
  const n = Math.min(concurrency, queue.length)
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (item === undefined) return
        await worker(item)
      }
    })
  )
}

/**
 * Run yt-dlp and capture stdout (for JSON / --print). Stderr goes to main log only so sync UI stays clean.
 */
export function runYtDlpCaptureStdout(args: string[], cwd: string): Promise<string> {
  console.info(LOG, 'yt-dlp capture', { args: args.slice(0, 6).join(' ') + (args.length > 6 ? ' …' : ''), cwd })
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    const child = spawn('yt-dlp', args, {
      cwd,
      env: { ...process.env },
      shell: false
    })
    child.stdout?.on('data', (buf: Buffer) => chunks.push(buf))
    child.stderr?.on('data', (buf: Buffer) => {
      const s = buf.toString()
      if (s.trim()) console.info(LOG, 'yt-dlp stderr', s.slice(0, 200))
    })
    child.on('error', (err) => {
      console.error(LOG, 'yt-dlp capture spawn error', err)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      const text = Buffer.concat(chunks).toString('utf-8')
      console.info(LOG, 'yt-dlp capture exit', code, 'stdout bytes', text.length)
      resolvePromise(text)
    })
  })
}

/** Spawn yt-dlp; stream stdout/stderr to renderer. */
export function runYtDlp(args: string[], cwd: string): Promise<{ code: number | null }> {
  console.info(LOG, 'spawn yt-dlp', { args, cwd })
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('yt-dlp', args, {
      cwd,
      env: { ...process.env },
      shell: false
    })
    child.stdout?.on('data', (buf: Buffer) => broadcastLog(buf.toString()))
    child.stderr?.on('data', (buf: Buffer) => broadcastLog(buf.toString()))
    child.on('error', (err) => {
      console.error(LOG, 'yt-dlp spawn error', err)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      console.info(LOG, 'yt-dlp exit', code)
      resolvePromise({ code })
    })
  })
}
