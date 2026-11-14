import { useHealth } from './useHealth'
import type { EmulatorLimit } from '@/lib/types'

/** What the active endpoint's emulator refuses in one service, from its profile; empty when nothing is known. */
export function useEmulatorLimits(service: string): EmulatorLimit[] {
  const { data: health } = useHealth()
  return health?.emulator?.profile?.limits.filter((limit) => limit.service === service) ?? []
}
