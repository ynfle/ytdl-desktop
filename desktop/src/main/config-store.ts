import { app } from 'electron'
import { join, resolve, sep } from 'path'
import { promises as fs } from 'fs'
import { LOG } from './constants'
import { state } from './app-state'

export function configPath(): string {
  return join(app.getPath('userData'), 'ytdl-config.json')
}

export async function loadConfig(): Promise<void> {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    state.config = JSON.parse(raw) as typeof state.config
    console.info(LOG, 'loaded config', state.config)
  } catch {
    state.config = { dataDir: null }
    console.info(LOG, 'no config file; using defaults')
  }
}

export async function saveConfig(): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(state.config, null, 2), 'utf-8')
  console.info(LOG, 'saved config', state.config)
}

/**
 * Root folder containing channels.txt, downloaded.txt, and video subfolders.
 * Default: parent of the desktop app package (repo root when developing from /ytdl/desktop).
 */
function defaultDataDir(): string {
  const appPath = app.getAppPath()
  const parent = resolve(join(appPath, '..'))
  console.info(LOG, 'defaultDataDir appPath=', appPath, 'parent=', parent)
  return parent
}

export function getDataDir(): string {
  const d = state.config.dataDir
  if (d && d.length > 0) return resolve(d)
  return defaultDataDir()
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const r = resolve(root) + sep
  const c = resolve(candidate)
  return c === resolve(root) || c.startsWith(r)
}
