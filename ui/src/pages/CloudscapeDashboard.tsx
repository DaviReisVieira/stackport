import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Cards from '@cloudscape-design/components/cards'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import SegmentedControl from '@cloudscape-design/components/segmented-control'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import TextFilter from '@cloudscape-design/components/text-filter'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { EndpointProblemAlert, ServiceStatusIndicator } from '@/components/cloudscape/ServiceStatus'
import { fetchStats } from '@/lib/api'
import type { ServiceStats, StatsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFavorites } from '@/hooks/useFavorites'
import { useHealth } from '@/hooks/useHealth'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useWebSocket } from '@/hooks/useWebSocket'
import { getServiceIcon } from '@/lib/service-icons'
import { formatUptime } from '@/lib/utils'

type ViewMode = 'grid' | 'list'

function getInitialViewMode(): ViewMode {
  return localStorage.getItem('stackport:view-mode') === 'list' ? 'list' : 'grid'
}

interface ServiceItem extends ServiceStats {
  name: string
  total: number
  favorite: boolean
}

function renderServiceName(item: ServiceItem, onNavigate: (service: string) => void) {
  const Icon = getServiceIcon(item.name)
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 flex-shrink-0" />
      <Link
        fontSize="heading-m"
        href={`/resources/${item.name}`}
        onFollow={(event) => {
          event.preventDefault()
          onNavigate(item.name)
        }}
      >
        {item.name}
      </Link>
    </div>
  )
}

function renderResourceBadges(item: ServiceItem) {
  if (item.total === 0) return <Box color="text-status-inactive">No resources</Box>
  return (
    <SpaceBetween direction="horizontal" size="xs">
      {Object.entries(item.resources)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => (
          <Badge key={type} color="grey">
            {type}: {count}
          </Badge>
        ))}
    </SpaceBetween>
  )
}

export default function CloudscapeDashboard() {
  const navigate = useNavigate()
  const { activeEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const statsFetcher = useCallback(() => fetchStats(activeEndpoint), [activeEndpoint])
  const { data: stats, loading, error, connected, refresh } = useWebSocket<StatsResponse>({
    fallbackFetcher: statsFetcher,
    fallbackInterval: 5000,
    messageType: 'stats',
    endpoint: activeEndpoint,
  })
  const { toggleFavorite, isFavorite } = useFavorites()
  const [filterText, setFilterText] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode)

  useEffect(() => {
    localStorage.setItem('stackport:view-mode', viewMode)
  }, [viewMode])

  useKeyboardShortcuts([
    { key: 'r', handler: () => refresh() },
    { key: 'v', handler: () => setViewMode((m) => (m === 'grid' ? 'list' : 'grid')) },
  ])

  const services = useMemo<ServiceItem[]>(() => {
    if (!stats) return []
    return Object.entries(stats.services)
      .map(([name, svc]) => ({
        ...svc,
        name,
        total: Object.values(svc.resources).reduce((a, b) => a + b, 0),
        favorite: isFavorite(name),
      }))
      .filter((svc) => svc.name.toLowerCase().includes(filterText.toLowerCase()))
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          b.total - a.total ||
          // Services the endpoint doesn't implement go after the ones it does.
          Number(a.status === 'unsupported') - Number(b.status === 'unsupported') ||
          a.name.localeCompare(b.name),
      )
  }, [stats, filterText, isFavorite])

  const statusCounts = useMemo(() => {
    const counts: Record<ServiceStats['status'], number> = { available: 0, unavailable: 0, unsupported: 0 }
    for (const svc of Object.values(stats?.services ?? {})) {
      // A status a newer backend added isn't counted as any of these
      if (Object.hasOwn(counts, svc.status)) counts[svc.status] += 1
    }
    return counts
  }, [stats])
  // Out of the services the endpoint implements: one it lacks isn't a failure
  const implementedCount = statusCounts.available + statusCounts.unavailable
  const problem = stats?.problem
  const endpointLabel = activeEndpoint ?? health?.endpoint_url ?? null
  // Only claim a connection the stats confirm
  const connectionConfirmed = Boolean(stats) && !problem
  const endpointSummary = endpointLabel
    ? connectionConfirmed
      ? `Connected to ${endpointLabel}`
      : `Endpoint: ${endpointLabel}`
    : 'Using the default endpoint'
  // Health follows the active endpoint, so the emulator it names is the one behind it
  const emulatorName = health?.emulator?.name
  const goToService = useCallback((service: string) => navigate(`/resources/${service}`), [navigate])

  const favoriteButton = (item: ServiceItem) => (
    <Button
      variant="inline-icon"
      iconName={item.favorite ? 'star-filled' : 'star'}
      ariaLabel={item.favorite ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
      onClick={() => toggleFavorite(item.name)}
    />
  )

  const listHeader = (
    <Header
      variant="h2"
      counter={stats ? `(${services.length})` : undefined}
      actions={
        <SegmentedControl
          selectedId={viewMode}
          onChange={({ detail }) => setViewMode(detail.selectedId as ViewMode)}
          label="View mode"
          options={[
            { id: 'grid', text: 'Grid' },
            { id: 'list', text: 'List' },
          ]}
        />
      }
    >
      Services
    </Header>
  )

  const filter = (
    <TextFilter
      filteringText={filterText}
      filteringPlaceholder="Find a service"
      onChange={({ detail }) => setFilterText(detail.filteringText)}
    />
  )

  return (
    <CloudscapeShell activeHref="/">
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={emulatorName ? `${endpointSummary} · ${emulatorName}` : endpointSummary}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <StatusIndicator type={connected ? 'success' : 'in-progress'}>
                  {connected ? 'Live' : 'Polling'}
                </StatusIndicator>
                <Button iconName="refresh" onClick={() => refresh()} loading={loading}>
                  Refresh
                </Button>
              </SpaceBetween>
            }
          >
            Dashboard
          </Header>
        }
      >
        <SpaceBetween size="l">
          {!stats && error && (
            <Alert
              type="error"
              header="Could not load service stats"
              action={
                <Button onClick={() => refresh()} loading={loading}>
                  Retry
                </Button>
              }
            >
              {error}
            </Alert>
          )}

          {problem && <EndpointProblemAlert problem={problem} retrying={loading} onRetry={() => refresh()} />}

          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Services available</Box>
              <Box fontSize="display-l" fontWeight="bold">
                {stats ? (implementedCount > 0 ? `${statusCounts.available}/${implementedCount}` : '0') : '—'}
              </Box>
              {statusCounts.unsupported > 0 && (
                <Box color="text-body-secondary">{statusCounts.unsupported} not supported by this endpoint</Box>
              )}
            </div>
            <div>
              <Box variant="awsui-key-label">Total resources</Box>
              <Box fontSize="display-l" fontWeight="bold">
                {stats ? stats.total_resources : '—'}
              </Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Uptime</Box>
              <Box fontSize="display-l" fontWeight="bold">
                {stats ? formatUptime(stats.uptime_seconds) : '—'}
              </Box>
            </div>
          </ColumnLayout>

          {/* With an endpoint-wide problem every service fails the same way: the alert says it once. */}
          {problem ? null : viewMode === 'grid' ? (
            <Cards
              items={services}
              loading={loading && !stats}
              loadingText="Probing services"
              trackBy="name"
              cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }, { minWidth: 900, cards: 3 }]}
              header={listHeader}
              filter={filter}
              cardDefinition={{
                header: (item) => (
                  <div className="flex items-center justify-between gap-2">
                    {renderServiceName(item, goToService)}
                    {favoriteButton(item)}
                  </div>
                ),
                sections: [
                  {
                    id: 'status',
                    content: (item) => <ServiceStatusIndicator name={item.name} service={item} />,
                  },
                  { id: 'resources', header: 'Resources', content: (item) => renderResourceBadges(item) },
                ],
              }}
              empty={<Box textAlign="center">No services match the filter</Box>}
            />
          ) : (
            <Table
              items={services}
              loading={loading && !stats}
              loadingText="Probing services"
              trackBy="name"
              header={listHeader}
              filter={filter}
              variant="container"
              columnDefinitions={[
                {
                  id: 'favorite',
                  header: '',
                  width: 60,
                  cell: (item) => favoriteButton(item),
                },
                {
                  id: 'service',
                  header: 'Service',
                  cell: (item) => renderServiceName(item, goToService),
                  sortingField: 'name',
                },
                {
                  id: 'status',
                  header: 'Status',
                  cell: (item) => <ServiceStatusIndicator name={item.name} service={item} />,
                },
                { id: 'resources', header: 'Resources', cell: (item) => renderResourceBadges(item) },
                { id: 'total', header: 'Total', width: 90, cell: (item) => item.total },
              ]}
              empty={<Box textAlign="center">No services match the filter</Box>}
            />
          )}
        </SpaceBetween>
      </ContentLayout>
    </CloudscapeShell>
  )
}
