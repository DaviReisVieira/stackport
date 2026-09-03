import { useCallback } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { fetchHealth } from '@/lib/api'
import type { HealthResponse } from '@/lib/types'
import { formatUptime } from '@/lib/utils'

const LINKS = [
  { label: 'GitHub Repository', url: 'https://github.com/DaviReisVieira/stackport' },
  { label: 'Report an Issue', url: 'https://github.com/DaviReisVieira/stackport/issues' },
]

function field(label: string, value: React.ReactNode) {
  return (
    <div key={label}>
      <Box variant="awsui-key-label">{label}</Box>
      <Box fontSize="body-s">{value}</Box>
    </div>
  )
}

export default function CloudscapeAbout() {
  const { activeEndpoint } = useEndpoint()
  const healthFetcher = useCallback(() => fetchHealth(activeEndpoint), [activeEndpoint])
  const { data: health, error, refresh } = useFetch<HealthResponse>(healthFetcher, 10000)

  return (
    <CloudscapeShell activeHref="/about">
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="System information and project details"
          actions={<Button iconName="refresh" onClick={() => refresh()} ariaLabel="Refresh system info" />}
        >
          About
        </Header>

        {error && !health && (
          <Alert type="error" header="Failed to load system info" action={<Button onClick={() => refresh()}>Retry</Button>}>
            {error}
          </Alert>
        )}

        {!health && !error && <StatusIndicator type="loading">Loading system info</StatusIndicator>}

        {health && (
          <ColumnLayout columns={3}>
            <Container header={<Header variant="h3">Project</Header>}>
              <SpaceBetween size="s">
                {field('Name', 'StackPort')}
                {field('Version', <Badge color="blue">{health.version}</Badge>)}
                {field('License', 'MIT')}
                <Box color="text-body-secondary" fontSize="body-s">
                  Universal AWS resource browser for local emulators
                </Box>
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h3">Connection</Header>}>
              <SpaceBetween size="s">
                {field(
                  'Mode',
                  health.connection_type === 'local' ? (
                    <Badge color="grey">Local Emulator</Badge>
                  ) : (
                    <Badge color="severity-medium">Real AWS</Badge>
                  ),
                )}
                {field('Endpoint', health.endpoint_url ?? 'AWS (default)')}
                {field('Region', health.region)}
                {field('Services', String(health.services_count))}
                {field(
                  'Writes',
                  health.writes_enabled ? (
                    <StatusIndicator type="success">Enabled</StatusIndicator>
                  ) : (
                    <StatusIndicator type="stopped">Disabled</StatusIndicator>
                  ),
                )}
                {field('Uptime', formatUptime(health.uptime_seconds))}
                {field(
                  'Status',
                  health.status === 'ok' ? (
                    <StatusIndicator type="success">ok</StatusIndicator>
                  ) : (
                    <StatusIndicator type="error">{health.status}</StatusIndicator>
                  ),
                )}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h3">Links</Header>}>
              <SpaceBetween size="s">
                {LINKS.map((link) => (
                  <Link key={link.url} href={link.url} external>
                    {link.label}
                  </Link>
                ))}
              </SpaceBetween>
            </Container>
          </ColumnLayout>
        )}
      </SpaceBetween>
    </CloudscapeShell>
  )
}
