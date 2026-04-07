import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useFetch } from '@/hooks/useFetch'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('useFetch', () => {
  it('returns loading initially then data', async () => {
    const fetcher = vi.fn().mockResolvedValue({ test: true })
    const { result } = renderHook(() => useFetch(fetcher))

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.data).toEqual({ test: true })
    expect(result.current.error).toBeNull()
  })

  it('sets error on fetch failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe('Network error')
    expect(result.current.data).toBeNull()
  })

  it('exposes refresh function', async () => {
    let callCount = 0
    const fetcher = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({ count: callCount })
    })

    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.data).toEqual({ count: 1 })

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.data).toEqual({ count: 2 })
  })
})
