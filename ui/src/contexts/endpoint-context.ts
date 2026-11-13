import { createContext } from 'react'
import type { Endpoint } from '@/lib/types'

export interface EndpointContextValue {
  activeEndpoint: string | null
  endpoints: Endpoint[]
  loading: boolean
  /**
   * Goes up each time the saved endpoints change (`refresh()` after a save here,
   * or the backend's `endpoints_changed`), for data that depends on their settings.
   */
  revision: number
  setActiveEndpoint: (name: string | null) => void
  /** Reload the endpoints after changing them. */
  refresh: () => void
}

export const EndpointContext = createContext<EndpointContextValue>({
  activeEndpoint: null,
  endpoints: [],
  loading: true,
  revision: 0,
  setActiveEndpoint: () => {},
  refresh: () => {},
})
