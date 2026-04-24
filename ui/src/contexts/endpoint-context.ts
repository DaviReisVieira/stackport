import { createContext } from 'react'
import type { Endpoint } from '@/lib/types'

export interface EndpointContextValue {
  activeEndpoint: string | null
  endpoints: Endpoint[]
  loading: boolean
  setActiveEndpoint: (name: string | null) => void
  refresh: () => void
}

export const EndpointContext = createContext<EndpointContextValue>({
  activeEndpoint: null,
  endpoints: [],
  loading: true,
  setActiveEndpoint: () => {},
  refresh: () => {},
})
