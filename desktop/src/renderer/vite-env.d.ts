/// <reference types="vite/client" />

import type { YtdlApi } from '../../shared/ytdl-api'

/** Chromium Document Picture-in-Picture (not yet in all lib.dom builds). */
interface DocumentPictureInPictureOptions {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
}

interface DocumentPictureInPicture extends EventTarget {
  readonly window: Window | null
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
  addEventListener(
    type: 'enter',
    listener: (ev: DocumentPictureInPictureEnterEvent) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: 'leave',
    listener: (this: DocumentPictureInPicture, ev: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  removeEventListener(
    type: 'enter',
    listener: (ev: DocumentPictureInPictureEnterEvent) => void,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: 'leave',
    listener: (this: DocumentPictureInPicture, ev: Event) => void,
    options?: boolean | EventListenerOptions
  ): void
}

interface DocumentPictureInPictureEnterEvent extends Event {
  readonly window: Window
}

declare global {
  interface Window {
    ytdl: YtdlApi
    readonly documentPictureInPicture?: DocumentPictureInPicture
  }
}

export {}
