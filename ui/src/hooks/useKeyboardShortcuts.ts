import { useEffect, useCallback } from 'react'

type ShortcutHandler = (event: KeyboardEvent) => void

interface ShortcutConfig {
  key: string
  handler: ShortcutHandler
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  preventDefault?: boolean
}

interface SequenceConfig {
  sequence: string[]
  handler: ShortcutHandler
  preventDefault?: boolean
}

/**
 * Hook to register keyboard shortcuts.
 * Shortcuts are disabled when user is typing in input/textarea/select elements.
 */
export function useKeyboardShortcuts(
  shortcuts: ShortcutConfig[],
  sequences: SequenceConfig[] = [],
  options: { enabled?: boolean } = {}
) {
  const { enabled = true } = options

  // Track sequence state
  const sequenceBuffer = useCallback(() => {
    const buffer: string[] = []
    const maxLength = Math.max(...sequences.map(s => s.sequence.length), 2)
    return {
      push: (key: string) => {
        buffer.push(key)
        if (buffer.length > maxLength) buffer.shift()
      },
      matches: (seq: string[]) => {
        if (buffer.length < seq.length) return false
        return seq.every((key, i) => buffer[buffer.length - seq.length + i] === key)
      },
      clear: () => { buffer.length = 0 },
    }
  }, [sequences])

  useEffect(() => {
    if (!enabled) return

    const seqBuf = sequenceBuffer()
    let lastKeyTime = 0

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore shortcuts when user is typing
      const target = event.target as HTMLElement
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable

      if (isTyping) return

      const now = Date.now()
      // Reset sequence buffer if more than 1 second since last key
      if (now - lastKeyTime > 1000) {
        seqBuf.clear()
      }
      lastKeyTime = now

      // Check sequences first
      seqBuf.push(event.key)
      for (const seq of sequences) {
        if (seqBuf.matches(seq.sequence)) {
          if (seq.preventDefault !== false) event.preventDefault()
          seq.handler(event)
          seqBuf.clear()
          return
        }
      }

      // Check single-key shortcuts
      for (const shortcut of shortcuts) {
        const keyMatch = shortcut.key.toLowerCase() === event.key.toLowerCase()
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey
        const metaMatch = shortcut.meta ? event.metaKey : !event.metaKey
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey
        const altMatch = shortcut.alt ? event.altKey : !event.altKey

        if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
          if (shortcut.preventDefault !== false) event.preventDefault()
          shortcut.handler(event)
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts, sequences, enabled, sequenceBuffer])
}
