import { useCallback } from 'react'
import { useFetch } from './useFetch'
import { fetchHealth } from '@/lib/api'
import type { HealthResponse } from '@/lib/types'

export function useHealth() {
  const fetcher = useCallback(() => fetchHealth(), [])
  return useFetch<HealthResponse>(fetcher, 30_000)
}
