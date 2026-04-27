/**
 * Turn yt-dlp `--restrict-filenames` output (underscores, no spaces) into a readable label
 * for window titles and transport UI when no embedded / JSON title exists.
 */
export function humanizeRestrictFilename(fileName: string): string {
  const stem = fileName.replace(/\.[^/.]+$/, '')
  let s = stem.replace(/_/g, ' ').replace(/\+/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 0 ? s : fileName.trim()
}
