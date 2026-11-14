import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function isVisible(): boolean {
  return document.visibilityState !== 'hidden'
}

/** Whether the page is showing: false while its tab is in the background or the window is minimized. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, isVisible, () => true)
}
