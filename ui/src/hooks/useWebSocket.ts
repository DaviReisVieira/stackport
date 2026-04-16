import { useEffect, useRef, useState } from 'react'
import { useFetch } from './useFetch'

interface UseWebSocketOptions<T> {
  /** HTTP fetcher to use as fallback when WebSocket fails */
  fallbackFetcher: () => Promise<T>
  /** Polling interval for HTTP fallback (ms) */
  fallbackInterval?: number
  /** Message type to filter on (e.g., 'stats') */
  messageType: string
}

/**
 * WebSocket hook with automatic reconnection and HTTP polling fallback.
 *
 * Connects to ws://host/ws, listens for messages of the given type,
 * and falls back to HTTP polling after 3 failed reconnection attempts.
 */
export function useWebSocket<T>({ fallbackFetcher, fallbackInterval = 5000, messageType }: UseWebSocketOptions<T>) {
  const [wsData, setWsData] = useState<T | null>(null)
  const [connected, setConnected] = useState(false)
  const [failed, setFailed] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRef = useRef<() => void>()
  const maxRetries = 3

  useEffect(() => {
    let disposed = false

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
        ws.send(JSON.stringify({ type: 'subscribe', services: ['all'] }))
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === messageType && msg.data) {
            setWsData(msg.data as T)
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
    }
  }, [messageType])

  // HTTP polling fallback — always fetches once for initial data,
  // then continues polling only when WebSocket has failed
  const fallback = useFetch<T>(fallbackFetcher, failed ? fallbackInterval : undefined)

  // Prefer WebSocket data when available, otherwise use HTTP data
  const data = wsData ?? fallback.data
  const loading = !data && fallback.loading

  return {
    data,
    loading,
    error: failed ? fallback.error : null,
    connected,
    refresh: fallback.refresh,
  }
}
