import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator'
import { lookup } from '@/lib/utils'
import type { ServiceStats } from '@/lib/types'

export interface ServiceStatusDisplay {
  type: StatusIndicatorProps.Type
  label: string
}

/**
 * `unsupported` is grey, not red: the endpoint lacking a service is a fact about
 * the endpoint, not something that broke.
 */
const STATUS_DISPLAY: Record<ServiceStats['status'], ServiceStatusDisplay> = {
  available: { type: 'success', label: 'Available' },
  unavailable: { type: 'error', label: 'Unavailable' },
  unsupported: { type: 'stopped', label: 'Not supported' },
}

/** How a service's status from `/api/stats` looks. A status this UI doesn't know yet is shown as it is. */
export function serviceStatusDisplay(status: string): ServiceStatusDisplay {
  return lookup(STATUS_DISPLAY, status) ?? { type: 'info', label: status }
}
