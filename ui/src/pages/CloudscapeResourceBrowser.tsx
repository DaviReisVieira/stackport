import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import Cards from '@cloudscape-design/components/cards'
import CollectionPreferences from '@cloudscape-design/components/collection-preferences'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import PropertyFilter from '@cloudscape-design/components/property-filter'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import type { TableProps } from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import { toast } from 'sonner'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { CLOUDSCAPE_SERVICE_VIEWS } from '@/components/cloudscape/views'
import {
  fetchResourceDetail,
  fetchResources,
  fetchResourceTags,
  fetchStats,
  fetchTagsSupported,
  updateResourceTags,
} from '@/lib/api'
import type { ResourceItem, ResourceListResponse, StatsResponse, TagsSupportedEntry } from '@/lib/types'
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

function ResourceTagsPanel({
  service,
  resourceType,
  resourceId,
  writable,
}: {
  service: string
  resourceType: string
  resourceId: string
  writable: boolean
}) {
  const { activeEndpoint } = useEndpoint()
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchResourceTags(service, resourceType, resourceId, activeEndpoint)
      .then((res) => {
        if (!cancelled) setTags(Object.entries(res.tags).map(([key, value]) => ({ key, value })))
      })
      .catch(() => {
        if (!cancelled) setTags([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [service, resourceType, resourceId, activeEndpoint])

  const save = async () => {
    setSaving(true)
    try {
      const record = Object.fromEntries(tags.filter((t) => t.key.trim()).map((t) => [t.key.trim(), t.value]))
      await updateResourceTags(service, resourceType, resourceId, record, activeEndpoint)
      toast.success('Tags updated')
    } catch (error) {
      toast.error(`Failed to update tags: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <StatusIndicator type="loading">Loading tags</StatusIndicator>

  if (!writable) {
    return tags.length === 0 ? (
      <Box color="text-status-inactive">No tags</Box>
    ) : (
      <SpaceBetween direction="horizontal" size="xs">
        {tags.map((t) => (
          <Badge key={t.key} color="grey">
            {t.key}: {t.value}
          </Badge>
        ))}
      </SpaceBetween>
    )
  }

  return (
    <SpaceBetween size="m">
      <AttributeEditor
        items={tags}
        onAddButtonClick={() => setTags([...tags, { key: '', value: '' }])}
        onRemoveButtonClick={({ detail }) => setTags(tags.filter((_, i) => i !== detail.itemIndex))}
        addButtonText="Add tag"
        removeButtonText="Remove"
        empty="No tags"
        definition={[
          {
            label: 'Key',
            control: (item, index) => (
              <Input
                value={item.key}
                onChange={({ detail }) => setTags(tags.map((t, i) => (i === index ? { ...t, key: detail.value } : t)))}
              />
            ),
          },
          {
            label: 'Value',
            control: (item, index) => (
              <Input
                value={item.value}
                onChange={({ detail }) => setTags(tags.map((t, i) => (i === index ? { ...t, value: detail.value } : t)))}
              />
            ),
          },
        ]}
      />
      <Button variant="primary" onClick={save} loading={saving} data-testid="save-resource-tags">
        Save tags
      </Button>
    </SpaceBetween>
  )
}

function DetailModal({
  service,
  resourceType,
  resourceId,
  tagSupport,
  onClose,
}: {
  service: string
  resourceType: string
  resourceId: string
  tagSupport: TagsSupportedEntry | null
  onClose: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(
    () => fetchResourceDetail(service, resourceType, resourceId, activeEndpoint),
    [service, resourceType, resourceId, activeEndpoint],
  )
  const { data, loading, error } = useFetch(fetcher)

  const detailsContent = (
    <>
      {loading && <StatusIndicator type="loading">Loading detail</StatusIndicator>}
      {!loading && error && <Alert type="error">{error}</Alert>}
      {!loading && data && (
        <Box variant="code">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(data.detail, null, 2)}
          </pre>
        </Box>
      )}
    </>
  )

  return (
    <Modal visible onDismiss={onClose} header={resourceId} size="large">
      {tagSupport ? (
        <Tabs
          tabs={[
            { id: 'details', label: 'Details', content: detailsContent },
            {
              id: 'tags',
              label: 'Tags',
              content: (
                <ResourceTagsPanel
                  service={service}
                  resourceType={resourceType}
                  resourceId={resourceId}
                  writable={tagSupport.writable}
                />
              ),
            },
          ]}
        />
      ) : (
        detailsContent
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

  // j/k/Enter keyboard navigation over the visible page, ported from the legacy browser.
  const [selectedRow, setSelectedRow] = useState(-1)
  const [prevItems, setPrevItems] = useState(items)
  if (prevItems !== items) {
    setPrevItems(items)
    setSelectedRow(-1)
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'j') {
        setSelectedRow((prev) => Math.min(prev + 1, pageItems.length - 1))
      } else if (e.key === 'k') {
        setSelectedRow((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        setSelectedRow((prev) => {
          if (prev >= 0 && prev < pageItems.length) onOpenDetail(resourceType, pageItems[prev].id)
          return prev
        })
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [pageItems, resourceType, onOpenDetail])

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
      selectionType="single"
      selectedItems={selectedRow >= 0 && selectedRow < pageItems.length ? [pageItems[selectedRow]] : []}
      onSelectionChange={({ detail }) => {
        const picked = detail.selectedItems[0]
        setSelectedRow(picked ? pageItems.findIndex((i) => i.id === picked.id) : -1)
      }}
      ariaLabels={{
        selectionGroupLabel: 'Resource selection',
        itemSelectionLabel: (_data, item) => `Select ${(item as ResourceItem).id}`,
      }}
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

  const tagsSupportedFetcher = useCallback(() => fetchTagsSupported(activeEndpoint), [activeEndpoint])
  const { data: tagsSupported } = useFetch(tagsSupportedFetcher)

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
          tagSupport={
            tagsSupported?.supported.find((s) => s.service === service && s.type === detail.resourceType) ?? null
          }
          onClose={() => setDetail(null)}
        />
      )}
    </CloudscapeShell>
  )
}
