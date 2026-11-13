import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { toast } from 'sonner'
import { useFetch } from '@/hooks/useFetch'
import { ApiError } from '@/lib/api'
import type { ClassifiedError, ErrorKind } from '@/lib/types'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const toastError = vi.mocked(toast.error)

beforeEach(() => {
  toastError.mockClear()
})

/** A promise the test settles by hand, to control the order answers land in. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const unreachable: ClassifiedError = {
  kind: 'unreachable',
  message: "StackPort couldn't reach the endpoint.",
  hint: 'Check that the emulator is running and that the endpoint URL and port are right.',
}

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
    expect(result.current.errorDetail).toBeNull()
  })

  it('sets error on fetch failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe('Network error')
    expect(result.current.errorDetail).toBeNull()
    expect(result.current.data).toBeNull()
    expect(toastError).toHaveBeenCalledWith('Failed to fetch data', {
      id: 'fetch-error:Network error',
      description: 'Network error',
    })
  })

  it("uses an ApiError's message, which is the backend's explanation, and exposes its classification", async () => {
    const credentials: ClassifiedError = {
      kind: 'credentials',
      message: 'AWS Emulator rejected the credentials StackPort signed with.',
      code: 'AccessDenied',
    }
    const fetcher = vi.fn().mockRejectedValue(new ApiError(401, credentials.message, credentials))
    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe('AWS Emulator rejected the credentials StackPort signed with.')
    expect(result.current.errorDetail).toEqual(credentials)
  })

  it('clears the classification once a fetch succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(502, unreachable.message, unreachable))
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useFetch(fetcher))
    await waitFor(() => expect(result.current.errorDetail).toEqual(unreachable))

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.data).toEqual({ ok: true })
    expect(result.current.error).toBeNull()
    expect(result.current.errorDetail).toBeNull()
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

describe('useFetch failure toasts', () => {
  it.each<[ErrorKind, string]>([
    ['not_implemented', 'Not supported by this endpoint'],
    ['credentials', 'Credentials problem'],
    ['forbidden', 'Access denied'],
    ['tls', 'Certificate not trusted'],
    ['unreachable', "Can't reach the endpoint"],
    ['other', 'Failed to fetch data'],
  ])('titles a %s failure "%s" and adds its hint', async (kind, title) => {
    const detail: ClassifiedError = { kind, message: 'What went wrong.', hint: 'How to fix it.' }
    const fetcher = vi.fn().mockRejectedValue(new ApiError(502, detail.message, detail))
    renderHook(() => useFetch(fetcher))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith(title, {
      id: 'fetch-error:What went wrong.',
      description: 'What went wrong. How to fix it.',
    })
  })

  it('keeps the message alone when the failure has no hint', async () => {
    const detail: ClassifiedError = { kind: 'not_implemented', message: "This endpoint doesn't implement ListWorkGroups yet." }
    const fetcher = vi.fn().mockRejectedValue(new ApiError(501, detail.message, detail))
    renderHook(() => useFetch(fetcher))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith('Not supported by this endpoint', {
      id: "fetch-error:This endpoint doesn't implement ListWorkGroups yet.",
      description: "This endpoint doesn't implement ListWorkGroups yet.",
    })
  })
})

describe('useFetch manual refresh', () => {
  it('shows loading and announces a failure that repeats the last one', async () => {
    const retry = deferred<never>()
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(502, unreachable.message, unreachable))
      .mockImplementationOnce(() => retry.promise)
    const { result } = renderHook(() => useFetch(fetcher))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(toastError).toHaveBeenCalledTimes(1)

    let pending!: Promise<void>
    act(() => {
      pending = result.current.refresh()
    })
    expect(result.current.loading).toBe(true)

    await act(async () => {
      retry.reject(new ApiError(502, unreachable.message, unreachable))
      await pending
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(unreachable.message)
    expect(toastError).toHaveBeenCalledTimes(2)
    expect(toastError).toHaveBeenLastCalledWith("Can't reach the endpoint", {
      id: `fetch-error:${unreachable.message}`,
      description: `${unreachable.message} ${unreachable.hint}`,
    })
  })

  it('keeps the newest answer when an older request lands after it', async () => {
    const slow = deferred<string>()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValueOnce('third')
    const { result } = renderHook(() => useFetch(fetcher))
    await waitFor(() => expect(result.current.data).toBe('first'))

    let older!: Promise<void>
    act(() => {
      older = result.current.refresh()
    })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.data).toBe('third')
    expect(result.current.loading).toBe(false)

    await act(async () => {
      slow.resolve('second')
      await older
    })
    expect(result.current.data).toBe('third')
  })

  it('stays loading until the refresh it started lands, even when an older request lands first', async () => {
    const older = deferred<string>()
    const newer = deferred<string>()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)
    const { result } = renderHook(() => useFetch(fetcher))
    await waitFor(() => expect(result.current.data).toBe('first'))

    act(() => {
      void result.current.refresh()
      void result.current.refresh()
    })
    await act(async () => {
      older.resolve('second')
    })
    expect(result.current.data).toBe('second')
    expect(result.current.loading).toBe(true)

    await act(async () => {
      newer.resolve('third')
    })
    expect(result.current.data).toBe('third')
    expect(result.current.loading).toBe(false)
  })
})

describe('useFetch when the fetcher changes', () => {
  it("ignores the previous fetcher's answer when it lands after the new one", async () => {
    const previous = deferred<string>()
    const { result, rerender } = renderHook(({ fetcher }) => useFetch(fetcher), {
      initialProps: { fetcher: () => previous.promise },
    })
    rerender({ fetcher: () => Promise.resolve('B') })
    await waitFor(() => expect(result.current.data).toBe('B'))

    await act(async () => {
      previous.resolve('A')
    })
    expect(result.current.data).toBe('B')
  })

  it("ignores the previous fetcher's answer when it lands first", async () => {
    const previous = deferred<string>()
    const next = deferred<string>()
    const { result, rerender } = renderHook(({ fetcher }) => useFetch(fetcher), {
      initialProps: { fetcher: () => previous.promise },
    })
    rerender({ fetcher: () => next.promise })

    await act(async () => {
      previous.resolve('A')
    })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)

    await act(async () => {
      next.resolve('B')
    })
    expect(result.current.data).toBe('B')
    expect(result.current.loading).toBe(false)
  })

  it("ignores the previous fetcher's failure", async () => {
    const previous = deferred<string>()
    const { result, rerender } = renderHook(({ fetcher }) => useFetch(fetcher), {
      initialProps: { fetcher: () => previous.promise },
    })
    rerender({ fetcher: () => Promise.resolve('B') })
    await waitFor(() => expect(result.current.data).toBe('B'))

    await act(async () => {
      previous.reject(new ApiError(502, unreachable.message, unreachable))
    })
    expect(result.current.data).toBe('B')
    expect(result.current.error).toBeNull()
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('useFetch refreshKey', () => {
  it('refetches when the key changes, keeping the current data until the answer lands', async () => {
    const second = deferred<string>()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => second.promise)
    const { result, rerender } = renderHook(({ refreshKey }) => useFetch(fetcher, undefined, { refreshKey }), {
      initialProps: { refreshKey: 0 },
    })
    await waitFor(() => expect(result.current.data).toBe('first'))
    expect(fetcher).toHaveBeenCalledTimes(1)

    rerender({ refreshKey: 0 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    rerender({ refreshKey: 1 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBe('first')
    expect(result.current.loading).toBe(false)

    await act(async () => {
      second.resolve('second')
    })
    expect(result.current.data).toBe('second')
  })

  it('asks the new fetcher once when the key changes with it', async () => {
    // Settings' "Set default" switches the endpoint and bumps the revision in one render
    const first = vi.fn().mockResolvedValue('a')
    const second = vi.fn().mockResolvedValue('b')
    const { result, rerender } = renderHook(({ fetcher, refreshKey }) => useFetch(fetcher, undefined, { refreshKey }), {
      initialProps: { fetcher: first, refreshKey: 0 },
    })
    await waitFor(() => expect(result.current.data).toBe('a'))

    rerender({ fetcher: second, refreshKey: 1 })
    expect(second).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.data).toBe('b'))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    // The key still refetches for the new fetcher
    second.mockResolvedValueOnce('b again')
    rerender({ fetcher: second, refreshKey: 2 })
    await waitFor(() => expect(result.current.data).toBe('b again'))
    expect(second).toHaveBeenCalledTimes(2)
  })
})

describe('useFetch while polling', () => {
  const INTERVAL = 5000
  const NOT_IMPLEMENTED = "This endpoint doesn't implement ListStateMachines yet."
  const notImplemented = () =>
    new ApiError(501, NOT_IMPLEMENTED, {
      kind: 'not_implemented',
      message: NOT_IMPLEMENTED,
      operation: 'ListStateMachines',
    })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Let the in-flight fetch settle, then run `polls` more intervals. */
  async function poll(polls = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(polls * INTERVAL)
    })
  }

  it('announces a failure once while every poll fails the same way', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.reject(notImplemented()))
    const { result } = renderHook(() => useFetch(fetcher, INTERVAL))

    await poll(4)

    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(result.current.error).toBe(NOT_IMPLEMENTED)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Not supported by this endpoint', {
      id: `fetch-error:${NOT_IMPLEMENTED}`,
      description: NOT_IMPLEMENTED,
    })
  })

  it('stays quiet on later polls after a manual refresh announced the failure again', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.reject(notImplemented()))
    const { result } = renderHook(() => useFetch(fetcher, INTERVAL))
    await poll()

    await act(async () => {
      await result.current.refresh()
    })
    expect(toastError).toHaveBeenCalledTimes(2)

    await poll(3)
    expect(toastError).toHaveBeenCalledTimes(2)
  })

  it('clears the error when a poll recovers, and announces the next failure again', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(notImplemented())
      .mockRejectedValueOnce(notImplemented())
      .mockResolvedValueOnce({ stateMachines: [] })
      .mockRejectedValueOnce(notImplemented())
    const { result } = renderHook(() => useFetch(fetcher, INTERVAL))

    await poll(1)
    expect(result.current.error).toBe(NOT_IMPLEMENTED)
    expect(toastError).toHaveBeenCalledTimes(1)

    await poll(1)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual({ stateMachines: [] })

    await poll(1)
    expect(result.current.error).toBe(NOT_IMPLEMENTED)
    expect(toastError).toHaveBeenCalledTimes(2)
    const ids = toastError.mock.calls.map(([, options]) => options?.id)
    expect(new Set(ids).size).toBe(1)
  })

  it('announces a failure that changes', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(notImplemented())
      .mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useFetch(fetcher, INTERVAL))

    await poll(2)

    expect(result.current.error).toBe('Failed to fetch')
    expect(toastError.mock.calls.map(([, options]) => options?.id)).toEqual([
      `fetch-error:${NOT_IMPLEMENTED}`,
      'fetch-error:Failed to fetch',
    ])
  })

  it('gives hooks that fail the same way one toast', async () => {
    const statsFetcher = vi.fn().mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    const tagsFetcher = vi.fn().mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    renderHook(() => useFetch(statsFetcher, INTERVAL))
    renderHook(() => useFetch(tagsFetcher, INTERVAL))

    await poll(2)

    expect(toastError).toHaveBeenCalledTimes(2)
    expect(toastError.mock.calls.map(([, options]) => options?.id)).toEqual([
      'fetch-error:Failed to fetch',
      'fetch-error:Failed to fetch',
    ])
  })
})
