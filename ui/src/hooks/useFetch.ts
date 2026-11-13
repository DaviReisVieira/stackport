import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import type { ClassifiedError, ErrorKind } from '@/lib/types'

/** Toast titles for failures the backend classified; anything else is DEFAULT_FAILURE_TITLE. */
const FAILURE_TITLES: Partial<Record<ErrorKind, string>> = {
  not_implemented: 'Not supported by this endpoint',
  credentials: 'Credentials problem',
  forbidden: 'Access denied',
  tls: 'Certificate not trusted',
  unreachable: "Can't reach the endpoint",
}
const DEFAULT_FAILURE_TITLE = 'Failed to fetch data'

function announceFailure(message: string, detail: ClassifiedError | null) {
  toast.error((detail && FAILURE_TITLES[detail.kind]) ?? DEFAULT_FAILURE_TITLE, {
    id: `fetch-error:${message}`,
    description: detail?.hint ? `${message} ${detail.hint}` : message,
  })
}

/**
 * `load`: the first fetch for a fetcher. `manual`: `refresh()`, which shows
 * loading and always announces its failure. `background`: an interval poll or a
 * `refreshKey` change, which keeps quiet about a failure already announced.
 */
type Trigger = 'load' | 'manual' | 'background'

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** What the hook shows, and the fetcher it belongs to: state left by a replaced fetcher doesn't count. */
interface FetchState<T> {
  source: () => Promise<T>
  data: T | null
  error: string | null
  errorDetail: ClassifiedError | null
  loading: boolean
}

/** One fetcher's requests, numbered as they start so answers that land out of order can be told apart. */
interface Session<T> {
  fetcher: () => Promise<T>
  /** False once the fetcher is replaced or the component unmounts: its answers no longer count. */
  active: boolean
  lastRequest: number
  /** Every request up to this one has been answered or overtaken by a newer answer. */
  settled: number
  /** The newest request that shows loading: the first fetch, or a manual refresh. */
  loadingRequest: number
}

export interface UseFetchOptions {
  /**
   * Refetch whenever this changes, keeping the current data until the answer lands.
   * When the fetcher changes with it, the new fetcher's first request is the refetch.
   */
  refreshKey?: unknown
}

/**
 * Fetch once, then every `intervalMs` when it's given.
 *
 * A new `fetcher` means other data (another endpoint, say): the hook starts over
 * and ignores whatever the previous fetcher still answers. Within one fetcher, an
 * answer that lands after a newer one is dropped too.
 *
 * `error` is the failure's message (for an `ApiError`, the backend's explanation),
 * for the view to render where the data would be, and `errorDetail` is the
 * backend's classification of it, when there is one. A toast announces each new
 * failure once: a poll that keeps failing the same way stays quiet instead of
 * stacking identical toasts, and hooks failing with the same message share one.
 * `refresh()` is someone asking again, so it shows loading and announces its
 * failure even when nothing changed.
 */
export function useFetch<T>(fetcher: () => Promise<T>, intervalMs?: number, { refreshKey }: UseFetchOptions = {}) {
  const [state, setState] = useState<FetchState<T>>(() => ({
    source: fetcher,
    data: null,
    error: null,
    errorDetail: null,
    loading: true,
  }))
  const sessionRef = useRef<Session<T> | null>(null)
  const announcedRef = useRef<string | null>(null)

  const settle = useCallback((session: Session<T>, request: number, trigger: Trigger, outcome: Outcome<T>) => {
    if (!session.active || request <= session.settled) return
    session.settled = request
    const source = session.fetcher
    // Still loading while a newer request that shows it is out
    const loading = request < session.loadingRequest

    if (outcome.ok) {
      announcedRef.current = null
      setState({ source, data: outcome.value, error: null, errorDetail: null, loading })
      return
    }
    const message = outcome.error instanceof Error ? outcome.error.message : 'Fetch failed'
    const detail = outcome.error instanceof ApiError ? outcome.error.classified : null
    setState((previous) => ({
      source,
      data: previous.source === source ? previous.data : null,
      error: message,
      errorDetail: detail,
      loading,
    }))
    if (trigger === 'manual' || announcedRef.current !== message) {
      announcedRef.current = message
      announceFailure(message, detail)
    }
  }, [])

  const request = useCallback(
    (session: Session<T>, trigger: Trigger): Promise<void> => {
      const id = ++session.lastRequest
      if (trigger !== 'background') session.loadingRequest = id
      // A fetcher that throws instead of rejecting fails the same way
      return new Promise<T>((resolve) => resolve(session.fetcher())).then(
        (value) => settle(session, id, trigger, { ok: true, value }),
        (error: unknown) => settle(session, id, trigger, { ok: false, error }),
      )
    },
    [settle],
  )

  useEffect(() => {
    const session: Session<T> = { fetcher, active: true, lastRequest: 0, settled: 0, loadingRequest: 0 }
    sessionRef.current = session
    announcedRef.current = null
    void request(session, 'load')
    return () => {
      session.active = false
    }
  }, [fetcher, request])

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return
    const id = setInterval(() => {
      if (sessionRef.current) void request(sessionRef.current, 'background')
    }, intervalMs)
    return () => clearInterval(id)
  }, [fetcher, intervalMs, request])

  const keyedRef = useRef({ fetcher, refreshKey })
  useEffect(() => {
    const previous = keyedRef.current
    keyedRef.current = { fetcher, refreshKey }
    // A new fetcher's session starts with a request of its own, which already reads the current state
    if (previous.fetcher !== fetcher || Object.is(previous.refreshKey, refreshKey)) return
    if (sessionRef.current) void request(sessionRef.current, 'background')
  }, [fetcher, refreshKey, request])

  const refresh = useCallback((): Promise<void> => {
    const session = sessionRef.current
    if (!session) return Promise.resolve()
    setState((previous) => (previous.source === session.fetcher ? { ...previous, loading: true } : previous))
    return request(session, 'manual')
  }, [request])

  // Until the current fetcher answers, there's nothing to show for it
  const current = state.source === fetcher ? state : null
  return {
    data: current ? current.data : null,
    loading: current ? current.loading : true,
    error: current ? current.error : null,
    errorDetail: current ? current.errorDetail : null,
    refresh,
  }
}
