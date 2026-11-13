import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetch } from './useFetch'

interface UseWebSocketOptions<T> {
  /** HTTP fetcher to use as fallback when WebSocket fails */
  fallbackFetcher: () => Promise<T>
  /** Polling interval for HTTP fallback (ms) */
  fallbackInterval?: number
  /** Message type to filter on (e.g., 'stats') */
  messageType: string
  /** Endpoint name to subscribe to */
  endpoint?: string | null
}

/** Data from the socket or over HTTP, numbered in the order it arrived. */
interface Answer<T> {
  data: T
  arrival: number
}

/**
 * WebSocket hook with automatic reconnection and HTTP polling fallback.
 *
 * Connects to ws://host/ws, listens for messages of the given type,
 * and falls back to HTTP polling after 3 failed reconnection attempts.
 *
 * `data` is the newest answer, from the socket or over HTTP, so a `refresh()`
 * replaces an older snapshot the socket pushed. `loading` is whether the first
 * HTTP fetch or a `refresh()` is still on its way.
 */
export function useWebSocket<T>({ fallbackFetcher, fallbackInterval = 5000, messageType, endpoint }: UseWebSocketOptions<T>) {
  const [wsAnswer, setWsAnswer] = useState<Answer<T> | null>(null)
  const arrivalsRef = useRef(0)
  const [connected, setConnected] = useState(false)
  const [failed, setFailed] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRef = useRef<() => void>()
  const maxRetries = 3

  useEffect(() => {
    let disposed = false
    retriesRef.current = 0

    function connect() {
      if (disposed) return
      if (wsRef.current?.readyState === WebSocket.OPEN) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        if (disposed) { ws.close(); return }
        setConnected(true)
        retriesRef.current = 0
        ws.send(JSON.stringify({ type: 'subscribe', services: ['all'], endpoint: endpoint ?? undefined }))
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === messageType && msg.data) {
            setWsAnswer({ data: msg.data as T, arrival: ++arrivalsRef.current })
          }
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        // Don't reconnect if the effect was cleaned up (e.g. StrictMode remount)
        if (disposed) return

        retriesRef.current++
        if (retriesRef.current >= maxRetries) {
          setFailed(true)
        } else {
          // Exponential backoff: 1s, 2s, 4s (max 30s)
          const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 30000)
          reconnectTimerRef.current = setTimeout(() => connectRef.current?.(), delay)
        }
      }

      ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnection
        ws.close()
      }
    }

    connectRef.current = connect
    connect()

    return () => {
      disposed = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
      setWsAnswer(null)
      setFailed(false)
    }
  }, [messageType, endpoint])

  // Numbered on the same count as the socket's messages, so the two can be told apart by age
  const numberedFetcher = useCallback(
    () => fallbackFetcher().then((data): Answer<T> => ({ data, arrival: ++arrivalsRef.current })),
    [fallbackFetcher],
  )
  // HTTP polling fallback — always fetches once for initial data,
  // then continues polling only when WebSocket has failed
  const fallback = useFetch<Answer<T>>(numberedFetcher, failed ? fallbackInterval : undefined)

  const httpAnswer = fallback.data
  const newest = wsAnswer && (!httpAnswer || wsAnswer.arrival > httpAnswer.arrival) ? wsAnswer : httpAnswer

  return {
    data: newest ? newest.data : null,
    loading: fallback.loading,
    error: failed ? fallback.error : null,
    connected,
    refresh: fallback.refresh,
  }
}
