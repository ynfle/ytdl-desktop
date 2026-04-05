/**
 * Builds minimal controls inside a Document Picture-in-Picture window.
 * The {@link HTMLVideoElement} is moved into this window by the caller; cleanup only removes listeners.
 */
const SEEK_SEC = 10

export type DocumentPipChromeOptions = {
  /** User clicked "Close" — should close the PiP window (caller owns {@link Window#close}). */
  onRequestClose: () => void
}

/**
 * Appends custom seek / play / close controls and mounts {@link video} in a flex column layout.
 * @returns Teardown that removes play/pause sync listeners from {@link video} (does not move the node).
 */
export function mountDocumentPipChrome(
  pipWindow: Window,
  video: HTMLVideoElement,
  opts: DocumentPipChromeOptions
): () => void {
  const doc = pipWindow.document
  doc.body.style.cssText =
    'margin:0;background:#0a0a0a;color:#e8e8e8;font-family:system-ui,sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden;'

  const root = doc.createElement('div')
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;'

  const videoWrap = doc.createElement('div')
  videoWrap.style.cssText =
    'flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#000;'
  video.style.cssText = 'width:100%;height:100%;max-height:100%;object-fit:contain;'
  videoWrap.appendChild(video)

  const bar = doc.createElement('div')
  bar.style.cssText =
    'flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;background:#141414;border-top:1px solid #2a2a2a;'

  const mkBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = title
    b.style.cssText =
      'padding:8px 14px;border-radius:8px;border:1px solid #3a3a3a;background:#222;color:#eee;cursor:pointer;font-size:13px;'
    b.onmouseenter = (): void => {
      b.style.background = '#2e2e2e'
    }
    b.onmouseleave = (): void => {
      b.style.background = '#222'
    }
    b.onclick = onClick
    return b
  }

  let playPauseBtn: HTMLButtonElement
  const updatePlayLabel = (): void => {
    playPauseBtn.textContent = video.paused ? 'Play' : 'Pause'
  }
  playPauseBtn = mkBtn('Pause', 'Play / Pause', () => {
    void (video.paused ? video.play() : video.pause())
    updatePlayLabel()
  })

  const back = mkBtn('−10s', 'Seek back 10 seconds', () => {
    video.currentTime = Math.max(0, video.currentTime - SEEK_SEC)
  })
  const fwd = mkBtn('+10s', 'Seek forward 10 seconds', () => {
    const d = video.duration
    if (d > 0 && !Number.isNaN(d)) video.currentTime = Math.min(d, video.currentTime + SEEK_SEC)
    else video.currentTime = video.currentTime + SEEK_SEC
  })
  const closeBtn = mkBtn('Close', 'Return video to app', () => opts.onRequestClose())

  bar.append(back, playPauseBtn, fwd, closeBtn)
  root.append(videoWrap, bar)
  doc.body.appendChild(root)

  updatePlayLabel()
  const onPlay = (): void => {
    updatePlayLabel()
  }
  const onPause = (): void => {
    updatePlayLabel()
  }
  video.addEventListener('play', onPlay)
  video.addEventListener('pause', onPause)

  console.log('[documentPipChrome] mounted controls in document PiP window')

  return () => {
    video.removeEventListener('play', onPlay)
    video.removeEventListener('pause', onPause)
    console.log('[documentPipChrome] unmounted control listeners')
  }
}
