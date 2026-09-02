import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '@cloudscape-design/components/app-layout'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Cards from '@cloudscape-design/components/cards'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import SideNavigation from '@cloudscape-design/components/side-navigation'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import TextFilter from '@cloudscape-design/components/text-filter'
import { applyMode, Mode } from '@cloudscape-design/global-styles'
import '@cloudscape-design/global-styles/index.css'
import { fetchStats } from '@/lib/api'
import type { StatsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { useHealth } from '@/hooks/useHealth'
import { getServiceIcon } from '@/lib/service-icons'
import { formatUptime } from '@/lib/utils'

interface ServiceCard {
  name: string
  status: 'available' | 'unavailable'
  resources: Record<string, number>
  total: number
}

export default function CloudscapePreview() {
  const navigate = useNavigate()
  const { activeEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const statsFetcher = useCallback(() => fetchStats(activeEndpoint), [activeEndpoint])
  const { data: stats, loading, refresh } = useFetch<StatsResponse>(statsFetcher, 5000)
  const [filterText, setFilterText] = useState('')
  const [navOpen, setNavOpen] = useState(true)

  // Match Cloudscape's mode to the app's current theme
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark')
    applyMode(isDark ? Mode.Dark : Mode.Light)
  }, [])

  const services = useMemo<ServiceCard[]>(() => {
    if (!stats) return []
    return Object.entries(stats.services)
      .map(([name, svc]) => ({
        name,
        status: svc.status,
        resources: svc.resources,
        total: Object.values(svc.resources).reduce((a, b) => a + b, 0),
      }))
      .filter((svc) => svc.name.toLowerCase().includes(filterText.toLowerCase()))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [stats, filterText])

  const availableCount = stats ? Object.values(stats.services).filter((s) => s.status === 'available').length : 0

  return (
    <AppLayout
      toolsHide
      navigationOpen={navOpen}
      onNavigationChange={({ detail }) => setNavOpen(detail.open)}
      navigation={
        <SideNavigation
          header={{ text: 'StackPort', href: '/cloudscape' }}
          activeHref="/cloudscape"
          onFollow={(event) => {
            if (!event.detail.external) {
              event.preventDefault()
              navigate(event.detail.href)
            }
          }}
          items={[
            { type: 'link', text: 'Dashboard', href: '/cloudscape' },
            { type: 'link', text: 'Resources', href: '/resources' },
            { type: 'link', text: 'Settings', href: '/settings' },
            { type: 'link', text: 'About', href: '/about' },
            { type: 'divider' },
            { type: 'link', text: 'Back to current UI', href: '/' },
            {
              type: 'link',
              text: 'Cloudscape RFC (#133)',
              href: 'https://github.com/DaviReisVieira/stackport/discussions/133',
              external: true,
            },
          ]}
        />
      }
      content={
        <ContentLayout
          header={
            <Header
              variant="h1"
              description={
                activeEndpoint
                  ? `Connected to ${activeEndpoint}`
                  : health?.endpoint_url
                    ? `Connected to ${health.endpoint_url}`
                    : 'Using the default endpoint'
              }
              actions={
                <Button iconName="refresh" onClick={() => refresh()} loading={loading}>
                  Refresh
                </Button>
              }
            >
              Dashboard{' '}
              <Badge color="blue">Cloudscape preview</Badge>
            </Header>
          }
        >
          <SpaceBetween size="l">
            <ColumnLayout columns={3} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">Services available</Box>
                <Box fontSize="display-l" fontWeight="bold">
                  {stats ? `${availableCount}/${Object.keys(stats.services).length}` : '—'}
                </Box>
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

            <Cards
              items={services}
              loading={loading && !stats}
              loadingText="Probing services"
              trackBy="name"
              cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }, { minWidth: 900, cards: 3 }]}
              header={
                <Header variant="h2" counter={stats ? `(${services.length})` : undefined}>
                  Services
                </Header>
              }
              filter={
                <TextFilter
                  filteringText={filterText}
                  filteringPlaceholder="Find a service"
                  onChange={({ detail }) => setFilterText(detail.filteringText)}
                />
              }
              cardDefinition={{
                header: (svc) => {
                  const Icon = getServiceIcon(svc.name)
                  return (
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      <Link
                        fontSize="heading-m"
                        onFollow={(event) => {
                          event.preventDefault()
                          navigate(`/resources/${svc.name}`)
                        }}
                        href={`/resources/${svc.name}`}
                      >
                        {svc.name}
                      </Link>
                    </div>
                  )
                },
                sections: [
                  {
                    id: 'status',
                    content: (svc) => (
                      <StatusIndicator type={svc.status === 'available' ? 'success' : 'error'}>
                        {svc.status === 'available' ? 'Available' : 'Unavailable'}
                      </StatusIndicator>
                    ),
                  },
                  {
                    id: 'resources',
                    header: 'Resources',
                    content: (svc) =>
                      svc.total === 0 ? (
                        <Box color="text-status-inactive">No resources</Box>
                      ) : (
                        <SpaceBetween direction="horizontal" size="xs">
                          {Object.entries(svc.resources)
                            .filter(([, count]) => count > 0)
                            .map(([type, count]) => (
                              <Badge key={type} color="grey">
                                {type}: {count}
                              </Badge>
                            ))}
                        </SpaceBetween>
                      ),
                  },
                ],
              }}
              empty={<Box textAlign="center">No services match the filter</Box>}
            />
          </SpaceBetween>
        </ContentLayout>
      }
    />
  )
}
