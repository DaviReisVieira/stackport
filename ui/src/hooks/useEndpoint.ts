import { useContext } from 'react'
import { EndpointContext } from '@/contexts/endpoint-context'

export function useEndpoint() {
  return useContext(EndpointContext)
}
