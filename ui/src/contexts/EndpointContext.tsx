import { useCallback, useEffect, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Endpoint, EndpointsResponse } from '@/lib/types'
import { fetchEndpoints } from '@/lib/api'
import { EndpointContext } from './endpoint-context'

const STORAGE_KEY = 'stackport:active-endpoint'

export function EndpointProvider({ children }: { children: ReactNode }) {
  const [activeEndpoint, setActiveEndpointState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [loading, setLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)

  const load = useCallback(() => {
    fetchEndpoints()
      .then((data: EndpointsResponse) => {
        setEndpoints(data.endpoints)
        const names = data.endpoints.map((e: Endpoint) => e.name)
        const needsReset = activeEndpoint === null || !names.includes(activeEndpoint)
        if (needsReset && data.endpoints.length > 0) {
          const defaultEp = data.endpoints.find((e: Endpoint) => e.active) ?? data.endpoints[0]
          setActiveEndpointState(defaultEp.name)
        }
      })
      .catch(() => { /* endpoint fetch failed — keep existing state */ })
      .finally(() => setLoading(false))
  }, [activeEndpoint])

  useEffect(() => {
    load()
  }, [load])

  // WebSocket connection to listen for endpoints_changed events
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      // Subscribe to receive messages
      ws.send(JSON.stringify({ type: 'subscribe', services: ['all'] }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'endpoints_changed') {
          // Refetch endpoints when they change
          load()
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onerror = () => {
      // Connection failed, but we can continue with HTTP-only mode
      ws.close()
    }

    return () => {
      ws.close()
    }
  }, [load])

  const setActiveEndpoint = useCallback((name: string | null) => {
    setActiveEndpointState(name)
    try {
      if (name === null) {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, name)
      }
    } catch { /* localStorage unavailable */ }
  }, [])

  return (
    <EndpointContext.Provider value={{ activeEndpoint, endpoints, loading, setActiveEndpoint, refresh: load }}>
      {children}
    </EndpointContext.Provider>
  )
}
