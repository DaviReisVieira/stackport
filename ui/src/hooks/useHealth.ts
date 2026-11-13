import { useCallback } from 'react'
import { useFetch } from './useFetch'
import { useEndpoint } from './useEndpoint'
import { fetchHealth } from '@/lib/api'
import type { HealthResponse } from '@/lib/types'

export function useHealth() {
  const { activeEndpoint, revision } = useEndpoint()
  const fetcher = useCallback(() => fetchHealth(activeEndpoint), [activeEndpoint])
  // Saving an endpoint changes what health reports (its TLS trust, the emulator found), so look again then
  return useFetch<HealthResponse>(fetcher, 30_000, { refreshKey: revision })
}
