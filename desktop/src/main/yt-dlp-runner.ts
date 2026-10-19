import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { LOG } from './constants'
import { broadcastLog } from './broadcast'

/**
 * Skip certifi’s Mozilla bundle so Python uses the OS store and `SSL_CERT_FILE` /
 * `SSL_CERT_DIR` (corporate MITM CAs). Injected on every spawn below.
 */
export const YT_DLP_NO_CERTIFI_ARGS = ['--compat-options', 'no-certifi'] as const

/** Tracks whether we have logged the enriched child PATH at least once. */
let loggedChildPathOnce = false

/**
 * Builds an environment dictionary for spawning `yt-dlp` (and its child tools like `ffmpeg` / `deno`).
 * Standalone GUI launches (macOS Dock/Spotlight, Windows Start Menu) often omit shell-profile PATH
 * directories; this appends existing common binary paths without duplicating entries.
 */
export function buildChildProcessEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const existingPath = process.env.PATH ?? process.env.Path ?? ''
  const currentEntries = existingPath.split(delimiter).filter(Boolean)
  const seenNormalized = new Set(
    currentEntries.map((p) => (process.platform === 'win32' ? p.toLowerCase() : p))
  )

  // Candidate binary directories for macOS, Linux, and Windows GUI launches.
  const extraCandidates: string[] =
    process.platform === 'win32'
      ? [
          join(home, 'scoop', 'shims'),
          join(home, '.local', 'bin'),
          join(home, '.bun', 'bin'),
          join(home, '.deno', 'bin'),
          join(process.env.ProgramData ?? 'C:\\ProgramData', 'chocolatey', 'bin'),
          ...(process.env.LOCALAPPDATA
            ? [
                join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
                join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Launcher')
              ]
            : [])
        ]
      : [
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
          '/usr/local/bin',
          '/usr/local/sbin',
          join(home, '.local', 'bin'),
          join(home, '.bun', 'bin'),
          join(home, '.deno', 'bin')
        ]

  const appended: string[] = []
  for (const candidate of extraCandidates) {
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate
    if (!seenNormalized.has(key) && existsSync(candidate)) {
      seenNormalized.add(key)
      currentEntries.push(candidate)
      appended.push(candidate)
    }
  }

  const finalPath = currentEntries.join(delimiter)
  if (!loggedChildPathOnce) {
    loggedChildPathOnce = true
    console.info(LOG, 'buildChildProcessEnv: prepared child PATH', {
      platform: process.platform,
      appendedExtraDirs: appended,
      totalPathEntries: currentEntries.length
    })
  }

  const env: NodeJS.ProcessEnv = { ...process.env }
  // A plain object is case-sensitive. Drop every PATH spelling so Windows does not
  // keep a stale `Path` beside a new `PATH`.
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key]
  }
  env.PATH = finalPath
  if (process.platform === 'win32') env.Path = finalPath
  return env
}

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
      env: buildChildProcessEnv(),
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

/**
 * Prefix each complete line (and `\r` progress updates) so concurrent yt-dlp streams stay readable.
 * Leftover text without a terminator is flushed on close.
 */
function createLinePrefixer(prefix: string, write: (s: string) => void): {
  push: (chunk: string) => void
  flush: () => void
} {
  let pending = ''
  const emit = (line: string) => {
    write(`${prefix}${line}\n`)
  }
  return {
    push(chunk: string) {
      pending += chunk
      const parts = pending.split(/\r?\n|\r/)
      pending = parts.pop() ?? ''
      for (const line of parts) emit(line)
    },
    flush() {
      if (pending.length > 0) {
        emit(pending)
        pending = ''
      }
    }
  }
}

export type RunYtDlpOptions = {
  /** Prepended to each stdout/stderr line in the sync log (e.g. `[ytdl:@handle] `). */
  logPrefix?: string
}

/** Spawn yt-dlp; stream stdout/stderr to renderer. */
export function runYtDlp(
  args: string[],
  cwd: string,
  options?: RunYtDlpOptions
): Promise<{ code: number | null }> {
  const argv = withYtDlpNoCertifi(args)
  const logPrefix = options?.logPrefix
  console.info(LOG, 'spawn yt-dlp', { args: argv, cwd, logPrefix: logPrefix ?? null })
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('yt-dlp', argv, {
      cwd,
      env: buildChildProcessEnv(),
      shell: false
    })
    const prefixer = logPrefix ? createLinePrefixer(logPrefix, broadcastLog) : null
    const onData = (buf: Buffer) => {
      const s = buf.toString()
      if (prefixer) prefixer.push(s)
      else broadcastLog(s)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => {
      prefixer?.flush()
      console.error(LOG, 'yt-dlp spawn error', err)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      prefixer?.flush()
      console.info(LOG, 'yt-dlp exit', code, { logPrefix: logPrefix ?? null })
      resolvePromise({ code })
    })
  })
}
