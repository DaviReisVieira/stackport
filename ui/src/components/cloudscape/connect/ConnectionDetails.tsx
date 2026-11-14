import { useCallback } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { CliSetupBlock } from '@/components/cloudscape/learn/CliSetupBlock'
import { CopyableCode } from '@/components/cloudscape/learn/CopyableCode'
import { fetchConnectionDetails } from '@/lib/api'
import type { ConnectionDetailsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

/**
 * How code on this machine connects to a resource: the address to use, commands
 * and connection strings to copy (passwords left as placeholders), and what to
 * know when the emulator's addresses need more than that.
 */
export function ConnectionDetails({
  service,
  resourceType,
  resourceId,
}: {
  service: string
  resourceType: string
  resourceId: string
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(
    () => fetchConnectionDetails(service, resourceType, resourceId, activeEndpoint),
    [service, resourceType, resourceId, activeEndpoint],
  )
  const { data, loading, error } = useFetch<ConnectionDetailsResponse>(fetcher)

  if (loading && !data) return <StatusIndicator type="loading">Loading connection details</StatusIndicator>
  if (error && !data) return <Alert type="error">{error}</Alert>
  if (!data) return null

  return (
    <SpaceBetween size="m">
      {data.problem && <Box color="text-body-secondary">{data.problem}</Box>}
      {data.cliSetup && data.connections.length > 0 && <CliSetupBlock setup={data.cliSetup} />}
      {data.connections.map((connection) => (
        <SpaceBetween key={connection.label} size="xs">
          <Box variant="awsui-key-label">{connection.label}</Box>
          <CopyToClipboard
            variant="inline"
            textToCopy={connection.address}
            copyButtonAriaLabel={`Copy ${connection.label}`}
            copySuccessText="Copied"
            copyErrorText="Could not copy"
          />
          {connection.returned && (
            <Box fontSize="body-s" color="text-body-secondary">
              The endpoint returned {connection.returned}
            </Box>
          )}
          {connection.snippets.map((snippet) => (
            <SpaceBetween key={snippet.label} size="xxs">
              <Box fontSize="body-s" color="text-body-secondary">
                {snippet.label}
              </Box>
              <CopyableCode text={snippet.text} copyLabel={snippet.label} />
            </SpaceBetween>
          ))}
        </SpaceBetween>
      ))}
      {data.notes.map((note) => (
        <Alert key={note} type="info">
          {note}
        </Alert>
      ))}
    </SpaceBetween>
  )
}

/** The Connect tab of an ElastiCache cluster's generic detail. */
export function CacheClusterConnection({ resourceId }: { resourceId: string }) {
  return <ConnectionDetails service="elasticache" resourceType="cache_clusters" resourceId={resourceId} />
}

/** The Connect tab of an OpenSearch domain's generic detail. */
export function SearchDomainConnection({ resourceId }: { resourceId: string }) {
  return <ConnectionDetails service="es" resourceType="domains" resourceId={resourceId} />
}

/** The Connect tab of an MSK cluster's generic detail. */
export function KafkaClusterConnection({ resourceId }: { resourceId: string }) {
  return <ConnectionDetails service="kafka" resourceType="clusters" resourceId={resourceId} />
}
