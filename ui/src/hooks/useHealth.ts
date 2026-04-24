import { useCallback } from 'react'
import { useFetch } from './useFetch'
import { useEndpoint } from './useEndpoint'
import { fetchHealth } from '@/lib/api'
import type { HealthResponse } from '@/lib/types'

export function useHealth() {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchHealth(activeEndpoint), [activeEndpoint])
  return useFetch<HealthResponse>(fetcher, 30_000)
}
