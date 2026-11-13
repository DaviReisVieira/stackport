import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useWebSocket } from '@/hooks/useWebSocket'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

/** Stands in for the browser WebSocket so tests can open it and push the backend's messages. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly OPEN = 1
  readyState = 0
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor() {
    FakeWebSocket.instances.push(this)
  }

  send(message: string) {
    this.sent.push(JSON.parse(message))
  }

  close() {
    this.readyState = 3
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

/** What the tests' stats look like: where each answer came from. */
interface Snapshot {
  source: string
}

/** A promise the test settles by hand, to control when an answer lands. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function socket(): FakeWebSocket {
  const last = FakeWebSocket.instances.at(-1)
  if (!last) throw new Error('no WebSocket opened')
  return last
}

function renderStats(fetcher: () => Promise<Snapshot>) {
  return renderHook(() =>
    useWebSocket<Snapshot>({ fallbackFetcher: fetcher, messageType: 'stats', endpoint: 'default' }),
  )
}

/** Render, let the first fetch land, then connect the socket and have it push a snapshot. */
async function renderConnected(fetcher: () => Promise<Snapshot>) {
  const hook = renderStats(fetcher)
  await waitFor(() => expect(hook.result.current.data).toEqual({ source: 'first fetch' }))
  act(() => {
    socket().open()
    socket().emit({ type: 'stats', data: { source: 'socket' } })
  })
  expect(hook.result.current.connected).toBe(true)
  expect(socket().sent).toEqual([{ type: 'subscribe', services: ['all'], endpoint: 'default' }])
  expect(hook.result.current.data).toEqual({ source: 'socket' })
  return hook
}

describe('useWebSocket while the socket is connected', () => {
  it("shows a refresh's answer over the socket's older snapshot, then the socket's next one", async () => {
    const fetcher = vi
      .fn<() => Promise<Snapshot>>()
      .mockResolvedValueOnce({ source: 'first fetch' })
      .mockResolvedValueOnce({ source: 'refresh' })
    const { result } = await renderConnected(fetcher)

    await act(async () => {
      await result.current.refresh()
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current.data).toEqual({ source: 'refresh' })

    act(() => socket().emit({ type: 'stats', data: { source: 'next snapshot' } }))
    expect(result.current.data).toEqual({ source: 'next snapshot' })
  })

  it("keeps the socket's snapshot when a refresh fails", async () => {
    const fetcher = vi
      .fn<() => Promise<Snapshot>>()
      .mockResolvedValueOnce({ source: 'first fetch' })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = await renderConnected(fetcher)

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.data).toEqual({ source: 'socket' })
  })

  it('shows loading while a refresh is on its way, with the snapshot still on screen', async () => {
    const retry = deferred<Snapshot>()
    const fetcher = vi
      .fn<() => Promise<Snapshot>>()
      .mockResolvedValueOnce({ source: 'first fetch' })
      .mockImplementationOnce(() => retry.promise)
    const { result } = await renderConnected(fetcher)
    expect(result.current.loading).toBe(false)

    let pending!: Promise<void>
    act(() => {
      pending = result.current.refresh()
    })
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toEqual({ source: 'socket' })

    await act(async () => {
      retry.resolve({ source: 'refresh' })
      await pending
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual({ source: 'refresh' })
  })
})

describe('useWebSocket before the socket answers', () => {
  it('shows the first fetch when it lands after the snapshot the socket sent on connecting', async () => {
    const first = deferred<Snapshot>()
    const { result } = renderStats(() => first.promise)
    expect(result.current.loading).toBe(true)

    act(() => {
      socket().open()
      socket().emit({ type: 'stats', data: { source: 'socket' } })
    })
    expect(result.current.data).toEqual({ source: 'socket' })

    await act(async () => {
      first.resolve({ source: 'first fetch' })
    })
    expect(result.current.data).toEqual({ source: 'first fetch' })
    expect(result.current.loading).toBe(false)
  })
})
