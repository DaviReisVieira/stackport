import { useCallback, useEffect, useState } from 'react'
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
