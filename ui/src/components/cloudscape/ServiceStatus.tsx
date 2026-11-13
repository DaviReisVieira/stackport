import type { ReactNode } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Popover from '@cloudscape-design/components/popover'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { serviceStatusDisplay } from '@/components/cloudscape/service-status-display'
import type { ClassifiedError, ServiceStats } from '@/lib/types'

type ServiceStatusFields = Pick<ServiceStats, 'status' | 'error' | 'errors'>

const PARTIAL_HEADER = "Some resource types weren't listed"

/** A failure's hint, and the original error text folded away for bug reports. */
export function ClassifiedErrorDetails({ error }: { error: ClassifiedError }) {
  if (!error.hint && !error.cause) return null
  return (
    <SpaceBetween size="xs">
      {error.hint && <Box>{error.hint}</Box>}
      {error.cause && (
        <ExpandableSection variant="inline" headerText="Original error">
          <Box variant="code">
            <pre className="whitespace-pre-wrap break-all text-xs">{error.cause}</pre>
          </Box>
        </ExpandableSection>
      )}
    </SpaceBetween>
  )
}

/**
 * An endpoint-wide failure from `/api/stats` (credentials, TLS, nothing
 * listening). Every service fails the same way, so it is said once, here.
 * `retrying` is whether the stats asked for again are still on their way.
 */
export function EndpointProblemAlert({
  problem,
  retrying,
  onRetry,
}: {
  problem: ClassifiedError
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <Alert
      type="error"
      header={problem.message}
      action={
        <Button onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      }
    >
      <ClassifiedErrorDetails error={problem} />
    </Alert>
  )
}

/**
 * What a popover says about a failure. It stays non-interactive (keyboard users
 * can't tab into a popover without a dismiss button), so the original error is
 * left to the alert on the service's own page.
 */
function ErrorSummary({ error }: { error: ClassifiedError }) {
  return (
    <SpaceBetween size="xs">
      <Box>{error.message}</Box>
      {error.hint && <Box color="text-body-secondary">{error.hint}</Box>}
    </SpaceBetween>
  )
}

function PartialFailures({ errors }: { errors: Record<string, ClassifiedError> }) {
  return (
    <SpaceBetween size="xs">
      {Object.entries(errors)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([resourceType, error]) => (
          <Box key={resourceType}>
            <Box variant="strong" display="inline">
              {resourceType}
            </Box>
            : {error.message}
          </Box>
        ))}
      <Box color="text-body-secondary" fontSize="body-s">
        They count as 0 resources.
      </Box>
    </SpaceBetween>
  )
}

function hasPartialFailures(service: ServiceStatusFields): service is ServiceStatusFields & {
  errors: Record<string, ClassifiedError>
} {
  return service.status === 'available' && Object.keys(service.errors ?? {}).length > 0
}

function popoverFor(service: ServiceStatusFields, label: string): { header: string; content: ReactNode } | null {
  if (hasPartialFailures(service)) {
    return { header: PARTIAL_HEADER, content: <PartialFailures errors={service.errors} /> }
  }
  if (service.status === 'available' || !service.error) return null
  return {
    header: service.status === 'unsupported' ? 'Not supported by this endpoint' : label,
    content: <ErrorSummary error={service.error} />,
  }
}

/**
 * A service's status from `/api/stats`. When the backend said why (a service
 * the endpoint doesn't implement, a failure, resource types that couldn't be
 * listed), the status opens a popover with the explanation.
 */
export function ServiceStatusIndicator({ name, service }: { name: string; service: ServiceStatusFields }) {
  const { type, label } = serviceStatusDisplay(service.status)
  const indicator = <StatusIndicator type={type}>{label}</StatusIndicator>
  const popover = popoverFor(service, label)
  if (!popover) return indicator

  return (
    <Popover
      triggerType="text"
      triggerAriaLabel={`${name} status: ${label}`}
      header={popover.header}
      content={popover.content}
      size="medium"
      position="top"
      dismissButton={false}
      renderWithPortal
    >
      {indicator}
    </Popover>
  )
}

/**
 * Why a service's resources may be missing or incomplete, for the page that
 * lists them. Renders nothing for a service that answered every list call.
 */
export function ServiceStatusAlert({ name, service }: { name: string; service: ServiceStatusFields | undefined }) {
  if (!service) return null
  if (hasPartialFailures(service)) {
    return (
      <Alert type="info" header={PARTIAL_HEADER}>
        <PartialFailures errors={service.errors} />
      </Alert>
    )
  }
  if (service.status === 'available' || !service.error) return null
  const unsupported = service.status === 'unsupported'
  return (
    <Alert
      type={unsupported ? 'info' : 'error'}
      header={unsupported ? `This endpoint doesn't support ${name}` : `StackPort couldn't list ${name} resources`}
    >
      <SpaceBetween size="xs">
        <Box>{service.error.message}</Box>
        <ClassifiedErrorDetails error={service.error} />
      </SpaceBetween>
    </Alert>
  )
}
