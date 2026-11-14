import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useExplorerHistory } from '@/hooks/useExplorerHistory'

const STORAGE_KEY = 'stackport:explorer-history'

function stored(): { at: string }[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as { at: string }[]
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useExplorerHistory', () => {
  it('keeps saving new requests after one too large for storage', () => {
    // Storage that holds about a megabyte, like a browser's quota but smaller
    const setItem = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (value.length > 1_000_000) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      setItem(key, value)
    })
    const { result } = renderHook(() => useExplorerHistory())
    const body = 'x'.repeat(1_500_000)

    act(() => result.current.record({ service: 's3', operation: 'PutObject', params: { Body: body }, status: 200, at: '1' }))
    act(() => result.current.record({ service: 'sqs', operation: 'ListQueues', params: {}, status: 200, at: '2' }))

    expect(result.current.entries.map((entry) => entry.at)).toEqual(['2', '1'])
    expect(stored().map((entry) => entry.at)).toEqual(['2'])
  })

  it('works without storage', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    const { result } = renderHook(() => useExplorerHistory())
    act(() => result.current.record({ service: 'sqs', operation: 'ListQueues', params: {}, status: 200, at: '1' }))
    expect(result.current.entries).toHaveLength(1)
  })
})
