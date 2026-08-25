import { spawn } from 'child_process'
import { LOG } from './constants'
import { broadcastLog } from './broadcast'

/**
 * Skip certifi’s Mozilla bundle so Python uses the OS store and `SSL_CERT_FILE` /
 * `SSL_CERT_DIR` (corporate MITM CAs). Injected on every spawn below.
 */
export const YT_DLP_NO_CERTIFI_ARGS = ['--compat-options', 'no-certifi'] as const

/** True when argv already requests the `no-certifi` compat option (flag or `=value`). */
function argsAlreadyHaveNoCertifi(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--compat-options=') && a.includes('no-certifi')) {
      return true
    }
    if (a === '--compat-options') {
      const value = args[i + 1]
      if (typeof value === 'string' && value.split(',').includes('no-certifi')) return true
    }
  }
  return false
}

/** Prepend `--compat-options no-certifi` unless the caller already set it. */
function withYtDlpNoCertifi(args: string[]): string[] {
  if (argsAlreadyHaveNoCertifi(args)) {
    console.info(LOG, 'yt-dlp argv already includes no-certifi; leaving as-is')
    return args
  }
  console.info(LOG, 'yt-dlp injecting --compat-options no-certifi')
  return [...YT_DLP_NO_CERTIFI_ARGS, ...args]
}

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
  const argv = withYtDlpNoCertifi(args)
  console.info(LOG, 'yt-dlp capture', { args: argv.slice(0, 8).join(' ') + (argv.length > 8 ? ' …' : ''), cwd })
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    const child = spawn('yt-dlp', argv, {
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
  const argv = withYtDlpNoCertifi(args)
  console.info(LOG, 'spawn yt-dlp', { args: argv, cwd })
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('yt-dlp', argv, {
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
