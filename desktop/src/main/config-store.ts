import { app } from 'electron'
import { basename, dirname, join, resolve, sep } from 'path'
import { existsSync, mkdirSync, realpathSync, promises as fs } from 'fs'
import { LOG } from './constants'
import { state } from './app-state'

/**
 * Resolves a path to its canonical on-disk casing and symlink target when it exists on disk.
 * On Windows/macOS (case-insensitive filesystems), a path like `C:\Users\me\ytdl-desktop`
 * will match an existing `C:\Users\me\YTDL-Desktop` directory; `realpathSync.native` normalizes
 * it to the actual on-disk casing so comparisons against `fs.realpath()` never mismatch.
 */
function realpathExisting(targetPath: string): string {
  return typeof realpathSync.native === 'function'
    ? realpathSync.native(targetPath)
    : realpathSync(targetPath)
}

/**
 * Resolves a path to its canonical on-disk casing and symlink target.
 * Walks up to the nearest existing ancestor so a missing file still inherits
 * the real casing of its parent (Windows and default macOS volumes).
 */
export function canonicalizeExistingPath(targetPath: string): string {
  const resolved = resolve(targetPath)
  const missing: string[] = []
  let current = resolved
  while (true) {
    try {
      const real = realpathExisting(current)
      return missing.length === 0 ? real : join(real, ...missing.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolved
      missing.push(basename(current))
      current = parent
    }
  }
}

/** Known marker files or directories that indicate an existing YTDL data root. */
const DATA_ROOT_MARKERS = [
  'channels.txt',
  'playlists.txt',
  'podcasts.txt',
  'downloaded.txt',
  'podcast-downloaded.txt',
  'videos'
] as const

/**
 * Returns the absolute path to the user config JSON inside Electron's `userData` directory.
 */
export function configPath(): string {
  return join(app.getPath('userData'), 'ytdl-config.json')
}

/**
 * Loads the persisted app configuration from `userData/ytdl-config.json` into `state.config`.
 * Falls back to `{ dataDir: null }` when no config file exists yet.
 */
/**
 * NSIS Unicode installers write this file as UTF-16LE. Accept that and UTF-8.
 */
function decodeConfigText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    console.info(LOG, 'loadConfig: decoding UTF-16LE config (BOM)')
    return buf.subarray(2).toString('utf16le')
  }
  if (buf.length >= 4 && buf[1] === 0 && buf[3] === 0) {
    console.info(LOG, 'loadConfig: decoding UTF-16LE config (no BOM)')
    return buf.toString('utf16le')
  }
  return buf.toString('utf8')
}

export async function loadConfig(): Promise<void> {
  const cfgFile = configPath()
  console.info(LOG, 'loadConfig: reading config from', cfgFile, { isPackaged: app.isPackaged })
  try {
    const raw = decodeConfigText(await fs.readFile(cfgFile))
    state.config = JSON.parse(raw) as typeof state.config
    console.info(LOG, 'loaded config', state.config)
  } catch (err) {
    state.config = { dataDir: null }
    console.info(LOG, 'no usable config file; using defaults', state.config, err)
  }
}

/**
 * Writes the current `state.config` to `userData/ytdl-config.json`.
 */
export async function saveConfig(): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(state.config, null, 2), 'utf-8')
  console.info(LOG, 'saved config', state.config)
}

/**
 * Checks whether a candidate directory contains any known YTDL data root files or folders.
 */
function hasExistingDataMarkers(dirPath: string): boolean {
  if (!existsSync(dirPath)) return false
  for (const marker of DATA_ROOT_MARKERS) {
    if (existsSync(join(dirPath, marker))) {
      console.info(LOG, 'defaultDataDir: found existing data marker', { dirPath, marker })
      return true
    }
  }
  return false
}

/** Resolved once. Media range requests must not re-probe or mkdir the home folder. */
let cachedDefaultDataDir: string | null = null

/**
 * Resolves the default root folder containing `channels.txt`, `downloaded.txt`, and `videos/`.
 * - In development/preview (`!app.isPackaged`): uses the parent of the `desktop/` package (repo root).
 * - In a standalone packaged app (`app.isPackaged`): detects an existing `~/ytdl-desktop` or
 *   `~/YTDL-Desktop` folder with data markers, or defaults to `~/ytdl-desktop`.
 */
function defaultDataDir(): string {
  if (cachedDefaultDataDir) return cachedDefaultDataDir
  const resolved = computeDefaultDataDir()
  cachedDefaultDataDir = resolved
  console.info(LOG, 'defaultDataDir cached', resolved)
  return resolved
}

function computeDefaultDataDir(): string {
  const appPath = app.getAppPath()

  // When running from source (`bun run dev` or `bun run start`), parent of `desktop/` is the repo root.
  if (!app.isPackaged) {
    const parent = resolve(join(appPath, '..'))
    console.info(LOG, 'defaultDataDir (unpackaged): appPath=', appPath, 'parent=', parent)
    return parent
  }

  // Packaged app: appPath points inside `resources/app.asar`, so resolve relative to user home.
  const homeDir = app.getPath('home')
  const lowerCandidate = resolve(join(homeDir, 'ytdl-desktop'))
  const upperCandidate = resolve(join(homeDir, 'YTDL-Desktop'))

  console.info(LOG, 'defaultDataDir (packaged): probing home candidates', {
    homeDir,
    lowerCandidate,
    upperCandidate
  })

  // Prefer whichever folder already holds channels/videos data (checking lowercase first).
  if (hasExistingDataMarkers(lowerCandidate)) {
    const canonical = canonicalizeExistingPath(lowerCandidate)
    console.info(LOG, 'defaultDataDir (packaged): selected existing data dir', canonical)
    return canonical
  }
  if (hasExistingDataMarkers(upperCandidate)) {
    const canonical = canonicalizeExistingPath(upperCandidate)
    console.info(LOG, 'defaultDataDir (packaged): selected existing repo data dir', canonical)
    return canonical
  }
  if (existsSync(lowerCandidate)) {
    const canonical = canonicalizeExistingPath(lowerCandidate)
    console.info(LOG, 'defaultDataDir (packaged): using existing home data directory', canonical)
    return canonical
  }
  if (existsSync(upperCandidate)) {
    const canonical = canonicalizeExistingPath(upperCandidate)
    console.info(LOG, 'defaultDataDir (packaged): using existing ~/YTDL-Desktop directory', canonical)
    return canonical
  }

  // Neither exists yet; ensure `~/ytdl-desktop` is created so scans/adds have a valid folder.
  try {
    mkdirSync(lowerCandidate, { recursive: true })
    console.info(LOG, 'defaultDataDir (packaged): created default data dir', lowerCandidate)
  } catch (err) {
    console.warn(LOG, 'defaultDataDir (packaged): failed to create ~/ytdl-desktop', err)
  }
  return canonicalizeExistingPath(lowerCandidate)
}

/**
 * Returns the active data directory (explicitly configured in Settings/installer, or `defaultDataDir()`).
 * Logged only when the resolved path changes.
 */
/** Last path logged by {@link getDataDir}, so media requests do not spam the console. */
let lastLoggedDataDir: string | null = null

export function getDataDir(): string {
  const d = state.config.dataDir
  const resolved = d && d.length > 0 ? canonicalizeExistingPath(d) : defaultDataDir()
  if (resolved !== lastLoggedDataDir) {
    lastLoggedDataDir = resolved
    console.info(LOG, 'getDataDir', { configured: d ?? null, resolved })
  }
  return resolved
}

/**
 * Checks whether `candidate` resolves inside `root` (or equals `root`).
 * Uses case-insensitive comparison on Windows (`win32`) so drive-letter or directory-name
 * casing differences between config and `fs.realpath` do not cause false negatives.
 */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = canonicalizeExistingPath(root)
  const resolvedCandidate = canonicalizeExistingPath(candidate)
  if (process.platform === 'win32') {
    const rLower = resolvedRoot.toLowerCase()
    const cLower = resolvedCandidate.toLowerCase()
    return cLower === rLower || cLower.startsWith(rLower + sep)
  }
  const r = resolvedRoot + sep
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(r)
}
