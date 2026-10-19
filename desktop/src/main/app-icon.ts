import { existsSync } from 'fs'
import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { LOG } from './constants'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Cached NativeImage instance so we only load the icon file once per process. */
let cachedAppIcon: NativeImage | null | undefined

/**
 * Resolves the absolute filesystem path to the bundled app icon (`icon.ico` on Windows, `icon.png` elsewhere).
 * Checks both packaged locations (`resources/` and `app.asar.unpacked/build/`) and unpackaged `desktop/build/`.
 */
export function resolveAppIconPath(): string | null {
  const preferredFiles =
    process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png', 'icon.ico']

  const candidateDirs = [
    // Unpackaged (`out/main` -> `../../build`) or inside unpacked asar
    join(__dirname, '../../build'),
    join(app.getAppPath(), 'build'),
    join(process.resourcesPath, 'app.asar.unpacked', 'build'),
    process.resourcesPath
  ]

  for (const dir of candidateDirs) {
    for (const file of preferredFiles) {
      const candidate = join(dir, file)
      if (existsSync(candidate)) {
        console.info(LOG, 'resolveAppIconPath: found app icon at', candidate)
        return candidate
      }
    }
  }

  console.warn(LOG, 'resolveAppIconPath: no icon file found in candidates', candidateDirs)
  return null
}

/**
 * Loads the application icon as an Electron `NativeImage` for `BrowserWindow` taskbar / titlebar / Dock usage.
 * Returns `undefined` if no icon file is present on disk.
 */
export function getAppWindowIcon(): NativeImage | undefined {
  if (cachedAppIcon !== undefined) {
    return cachedAppIcon ?? undefined
  }
  const iconPath = resolveAppIconPath()
  if (!iconPath) {
    cachedAppIcon = null
    return undefined
  }
  try {
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) {
      console.warn(LOG, 'getAppWindowIcon: nativeImage was empty for path', iconPath)
      cachedAppIcon = null
      return undefined
    }
    console.info(LOG, 'getAppWindowIcon: loaded NativeImage', {
      iconPath,
      size: img.getSize()
    })
    cachedAppIcon = img
    return img
  } catch (e) {
    console.warn(LOG, 'getAppWindowIcon: failed to load NativeImage', e)
    cachedAppIcon = null
    return undefined
  }
}

/**
 * Applies OS-level taskbar / Dock identity (Windows AppUserModelID + macOS Dock badge/icon).
 */
export function applyOsAppIdentity(): void {
  if (process.platform === 'win32') {
    // Matches `appId` in `electron-builder.yml` so Windows groups taskbar icons properly.
    app.setAppUserModelId('com.ytdl.desktop')
    console.info(LOG, 'applyOsAppIdentity: set Windows AppUserModelId to com.ytdl.desktop')
  }
  if (process.platform === 'darwin' && app.dock) {
    const icon = getAppWindowIcon()
    if (icon) {
      try {
        app.dock.setIcon(icon)
        console.info(LOG, 'applyOsAppIdentity: set macOS dock icon')
      } catch (e) {
        console.warn(LOG, 'applyOsAppIdentity: failed to set macOS dock icon', e)
      }
    }
  }
}
