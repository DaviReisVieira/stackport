import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import Cards from '@cloudscape-design/components/cards'
import CollectionPreferences from '@cloudscape-design/components/collection-preferences'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import PropertyFilter from '@cloudscape-design/components/property-filter'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import type { TableProps } from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { CLOUDSCAPE_SERVICE_VIEWS } from '@/components/cloudscape/views'
import { fetchResourceDetail, fetchResources, fetchStats } from '@/lib/api'
import type { ResourceItem, ResourceListResponse, StatsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { exportData } from '@/lib/export'
import { getServiceIcon } from '@/lib/service-icons'

const MAX_COLUMNS = 8

function renderServiceHeader(service: string) {
  const Icon = getServiceIcon(service)
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-6 w-6" />
      {service}
    </span>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') {
    const json = JSON.stringify(value)
    return json.length > 80 ? `${json.slice(0, 77)}...` : json
  }
  return String(value)
}

function deriveColumns(items: ResourceItem[]): string[] {
  const keys = new Set<string>(['id'])
  for (const item of items) {
    for (const key of Object.keys(item)) keys.add(key)
  }
  return [...keys].slice(0, MAX_COLUMNS)
}

function DetailModal({
  service,
  resourceType,
  resourceId,
  onClose,
}: {
  service: string
  resourceType: string
  resourceId: string
  onClose: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(
    () => fetchResourceDetail(service, resourceType, resourceId, activeEndpoint),
    [service, resourceType, resourceId, activeEndpoint],
  )
  const { data, loading, error } = useFetch(fetcher)

  return (
    <Modal visible onDismiss={onClose} header={resourceId} size="large">
      {loading && <StatusIndicator type="loading">Loading detail</StatusIndicator>}
      {!loading && error && <Alert type="error">{error}</Alert>}
      {!loading && data && (
        <Box variant="code">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(data.detail, null, 2)}
          </pre>
        </Box>
      )}
    </Modal>
  )
}

function ResourceTable({
  resourceType,
  items,
  onOpenDetail,
}: {
  resourceType: string
  items: ResourceItem[]
  onOpenDetail: (resourceType: string, id: string) => void
}) {
  const [pageSize, setPageSize] = useState(25)
  const columns = useMemo(() => deriveColumns(items), [items])

  const filteringProperties = useMemo(
    () =>
      columns.map((key) => ({
        key,
        propertyLabel: key,
        groupValuesLabel: `${key} values`,
        operators: [':', '!:', '=', '!='],
      })),
    [columns],
  )

  const { items: pageItems, filteredItemsCount, collectionProps, propertyFilterProps, paginationProps } =
    useCollection(items, {
      propertyFiltering: { filteringProperties },
      pagination: { pageSize },
      sorting: {},
    })

  const columnDefinitions = useMemo<TableProps.ColumnDefinition<ResourceItem>[]>(
    () =>
      columns.map((key) => ({
        id: key,
        header: key,
        sortingField: key,
        cell: (item: ResourceItem) =>
          key === 'id' ? (
            <Link
              href={`#${item.id}`}
              onFollow={(event) => {
                event.preventDefault()
                onOpenDetail(resourceType, item.id)
              }}
            >
              {item.id}
            </Link>
          ) : (
            formatCell(item[key])
          ),
      })),
    [columns, resourceType, onOpenDetail],
  )

  return (
    <Table
      {...collectionProps}
      items={pageItems}
      columnDefinitions={columnDefinitions}
      trackBy="id"
      variant="borderless"
      stickyHeader
      resizableColumns
      empty={<Box textAlign="center">No {resourceType} found</Box>}
      filter={
        <PropertyFilter
          {...propertyFilterProps}
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          filteringPlaceholder={`Filter ${resourceType}`}
        />
      }
      pagination={<Pagination {...paginationProps} />}
      preferences={
        <CollectionPreferences
          title="Preferences"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          preferences={{ pageSize }}
          pageSizePreference={{
            title: 'Page size',
            options: [
              { value: 25, label: '25 resources' },
              { value: 50, label: '50 resources' },
              { value: 100, label: '100 resources' },
            ],
          }}
          onConfirm={({ detail }) => setPageSize(detail.pageSize ?? 25)}
        />
      }
    />
  )
}

function ServicePicker({ stats, onSelect }: { stats: StatsResponse | null; onSelect: (service: string) => void }) {
  const services = useMemo(
    () =>
      Object.entries(stats?.services ?? {})
        .map(([name, svc]) => ({
          name,
          status: svc.status,
          total: Object.values(svc.resources).reduce((a, b) => a + b, 0),
        }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    [stats],
  )

  return (
    <Cards
      items={services}
      trackBy="name"
      cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 3 }, { minWidth: 900, cards: 4 }]}
      header={<Header variant="h2" counter={`(${services.length})`}>Pick a service</Header>}
      cardDefinition={{
        header: (item) => {
          const Icon = getServiceIcon(item.name)
          return (
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 flex-shrink-0" />
              <Link
                href={`/cloudscape/resources/${item.name}`}
                onFollow={(event) => {
                  event.preventDefault()
                  onSelect(item.name)
                }}
              >
                {item.name}
              </Link>
            </div>
          )
        },
        sections: [
          {
            id: 'meta',
            content: (item) => (
              <SpaceBetween direction="horizontal" size="xs">
                <StatusIndicator type={item.status === 'available' ? 'success' : 'error'}>
                  {item.status}
                </StatusIndicator>
                <Box color="text-body-secondary">{item.total} resources</Box>
              </SpaceBetween>
            ),
          },
        ],
      }}
      empty={<Box textAlign="center">No services available</Box>}
    />
  )
}

export default function CloudscapeResourceBrowser() {
  const navigate = useNavigate()
  const { service } = useParams<{ service?: string }>()
  const { activeEndpoint } = useEndpoint()
  const [detail, setDetail] = useState<{ resourceType: string; id: string } | null>(null)

  const statsFetcher = useCallback(() => fetchStats(activeEndpoint), [activeEndpoint])
  const { data: stats } = useFetch<StatsResponse>(statsFetcher)

  const resourcesFetcher = useCallback(
    () => (service ? fetchResources(service, undefined, activeEndpoint) : Promise.resolve(null)),
    [service, activeEndpoint],
  )
  const { data: resources, loading, error, refresh } = useFetch<ResourceListResponse | null>(resourcesFetcher)

  const servicesNav = useMemo(
    () => [
      {
        type: 'section' as const,
        text: 'Services',
        items: Object.keys(stats?.services ?? {})
          .sort()
          .map((name) => ({
            type: 'link' as const,
            text: name,
            href: `/cloudscape/resources/${name}`,
          })),
      },
    ],
    [stats],
  )

  const resourceTypes = useMemo(
    () => Object.entries(resources?.resources ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [resources],
  )

  const openDetail = useCallback((resourceType: string, id: string) => setDetail({ resourceType, id }), [])

  const CustomView = service ? CLOUDSCAPE_SERVICE_VIEWS[service] : undefined

  return (
    <CloudscapeShell
      activeHref={service ? `/cloudscape/resources/${service}` : '/cloudscape/resources'}
      extraNavItems={servicesNav}
    >
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={service ? 'Live resource state from the selected endpoint' : 'Browse resources by service'}
            actions={
              service && !CustomView ? (
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" onClick={() => refresh()} loading={loading}>
                    Refresh
                  </Button>
                </SpaceBetween>
              ) : undefined
            }
          >
            {service ? renderServiceHeader(service) : 'Resources'}
          </Header>
        }
      >
        {!service && <ServicePicker stats={stats} onSelect={(name) => navigate(`/cloudscape/resources/${name}`)} />}

        {service && CustomView && <CustomView />}

        {service && !CustomView && (
          <SpaceBetween size="l">
            {!loading && error && (
              <Alert type="error" header="Could not load resources" action={<Button onClick={() => refresh()}>Retry</Button>}>
                {error}
              </Alert>
            )}
            {!loading && resources && resourceTypes.length === 0 && (
              <Box textAlign="center" padding="xxl">
                No resources found for {service}
              </Box>
            )}
            {resources && resourceTypes.length > 0 && (
              <Tabs
                tabs={resourceTypes.map(([type, items]) => ({
                  id: type,
                  label: `${type} (${items.length})`,
                  content: (
                    <SpaceBetween size="m">
                      <Box float="right">
                        <ButtonDropdown
                          items={[
                            { id: 'json', text: 'Export as JSON' },
                            { id: 'csv', text: 'Export as CSV' },
                          ]}
                          onItemClick={({ detail: click }) =>
                            exportData({
                              service,
                              resourceType: type,
                              data: items as unknown as Record<string, unknown>[],
                              format: click.id as 'json' | 'csv',
                            })
                          }
                        >
                          Export
                        </ButtonDropdown>
                      </Box>
                      <ResourceTable resourceType={type} items={items} onOpenDetail={openDetail} />
                    </SpaceBetween>
                  ),
                }))}
              />
            )}
          </SpaceBetween>
        )}
      </ContentLayout>

      {service && detail && (
        <DetailModal
          service={service}
          resourceType={detail.resourceType}
          resourceId={detail.id}
          onClose={() => setDetail(null)}
        />
      )}
    </CloudscapeShell>
  )
}
