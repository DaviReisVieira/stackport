import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    // Clear all event listeners (if tracking them)
    const w = window as unknown as Record<string, unknown>
    const listeners = w.eventListeners as Record<string, EventListener[]> | undefined
    if (listeners) {
      for (const type in listeners) {
        listeners[type].forEach((listener: EventListener) => {
          window.removeEventListener(type, listener)
        })
      }
    }
  })

  it('registers single-key shortcuts', () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts([{ key: 'r', handler }])
    )

    const event = new KeyboardEvent('keydown', { key: 'r' })
    window.dispatchEvent(event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  it('registers shortcuts with modifiers', () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts([{ key: '?', handler, shift: true }])
    )

    // Should not trigger without shift
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
    expect(handler).not.toHaveBeenCalled()

    // Should trigger with shift
    const eventWithShift = new KeyboardEvent('keydown', { key: '?', shiftKey: true })
    window.dispatchEvent(eventWithShift)
    expect(handler).toHaveBeenCalledWith(eventWithShift)
  })

  it('does not trigger when typing in input elements', () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts([{ key: 'r', handler }])
    )

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true })
    input.dispatchEvent(event)

    expect(handler).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('registers key sequences', () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts([], [{ sequence: ['g', 'd'], handler }])
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))

    expect(handler).toHaveBeenCalled()
  })

  it('resets sequence after timeout', async () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts([], [{ sequence: ['g', 'd'], handler }])
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))

    // Wait for more than 1 second (sequence timeout)
    await new Promise(resolve => setTimeout(resolve, 1100))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))

    // Should not trigger because sequence timed out
    expect(handler).not.toHaveBeenCalled()
  })

  it('can be disabled', () => {
    const handler = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => useKeyboardShortcuts([{ key: 'r', handler }], [], { enabled }),
      { initialProps: { enabled: true } }
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    expect(handler).toHaveBeenCalledTimes(1)

    rerender({ enabled: false })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    expect(handler).toHaveBeenCalledTimes(1) // Should not increment
  })

  it('prevents default when preventDefault is true', () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts([{ key: 'r', handler, preventDefault: true }])
    )

    const event = new KeyboardEvent('keydown', { key: 'r', cancelable: true })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  it('does not prevent default when preventDefault is false', () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts([{ key: 'r', handler, preventDefault: false }])
    )

    const event = new KeyboardEvent('keydown', { key: 'r', cancelable: true })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })
})
