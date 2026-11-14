import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import CollectionPreferences from '@cloudscape-design/components/collection-preferences'
import type { CollectionPreferencesProps } from '@cloudscape-design/components/collection-preferences'
import Container from '@cloudscape-design/components/container'
import ContentLayout from '@cloudscape-design/components/content-layout'
import DateRangePicker from '@cloudscape-design/components/date-range-picker'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import type { TableProps } from '@cloudscape-design/components/table'
import TextFilter from '@cloudscape-design/components/text-filter'
import Toggle from '@cloudscape-design/components/toggle'
import { toast } from 'sonner'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { ClassifiedErrorDetails } from '@/components/cloudscape/ServiceStatus'
import { ActivityEventModal } from '@/components/cloudscape/activity/ActivityEventModal'
import { LookupFilter } from '@/components/cloudscape/activity/LookupFilter'
import {
  DEFAULT_LOOKUP,
  RELATIVE_OPTIONS,
  RELATIVE_UNITS,
  csvRow,
  describeLookup,
  firstPageQuery,
  formatEventTime,
  lookupParams,
  matchesText,
  parseLookup,
  parseRange,
  pickerValue,
  rangeFromPicker,
  rangeParams,
  resourceNames,
  validateRange,
} from '@/components/cloudscape/activity/activity'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { useHealth } from '@/hooks/useHealth'
import { usePageVisible } from '@/hooks/usePageVisible'
import { fetchActivityEvents } from '@/lib/api'
import { exportData } from '@/lib/export'
import type { ExportFormat } from '@/lib/export'
import type { ActivityEvent, ActivityLookup, ActivityPage } from '@/lib/types'

/**
 * How often auto-refresh looks again. On AWS, LookupEvents allows two calls a
 * second per account and Region, shared with every other tool using the
 * account, so the page stays well clear of it.
 */
const AUTO_REFRESH_MS = 10_000

/** Pages loaded after the first, for the first page they continue. */
interface OlderPages {
  after: ActivityPage
  pages: ActivityPage[]
}

/** The table's columns; `open` shows an event's details. */
function eventColumns(open: (event: ActivityEvent) => void): TableProps.ColumnDefinition<ActivityEvent>[] {
  return [
    { id: 'eventTime', header: 'Event time', width: 200, cell: (event) => formatEventTime(event.eventTime) },
    {
      id: 'eventName',
      header: 'Event name',
      width: 210,
      cell: (event) => (
        <Link
          href="#"
          onFollow={(followEvent) => {
            followEvent.preventDefault()
            open(event)
          }}
        >
          {event.eventName || '(no name)'}
        </Link>
      ),
    },
    { id: 'eventSource', header: 'Event source', width: 220, cell: (event) => event.eventSource || '-' },
    { id: 'username', header: 'User name', width: 150, cell: (event) => event.username || '-' },
    { id: 'resources', header: 'Resources', width: 200, cell: (event) => resourceNames(event) || '-' },
    {
      id: 'readOnly',
      header: 'Read-only',
      width: 110,
      cell: (event) => (event.readOnly === null ? '-' : String(event.readOnly)),
    },
    {
      id: 'errorCode',
      header: 'Error code',
      width: 240,
      cell: (event) => (event.errorCode ? <StatusIndicator type="error">{event.errorCode}</StatusIndicator> : '-'),
    },
    { id: 'sourceIpAddress', header: 'Source IP address', width: 160, cell: (event) => event.sourceIpAddress || '-' },
    { id: 'userAgent', header: 'User agent', width: 300, cell: (event) => event.userAgent || '-' },
    { id: 'accessKeyId', header: 'AWS access key', width: 200, cell: (event) => event.accessKeyId || '-' },
    { id: 'awsRegion', header: 'AWS region', width: 130, cell: (event) => event.awsRegion || '-' },
    { id: 'eventId', header: 'Event ID', width: 300, cell: (event) => event.eventId || '-' },
  ]
}

const HIDDEN_BY_DEFAULT = new Set(['userAgent', 'accessKeyId', 'awsRegion', 'eventId'])

function defaultPreferences(columns: TableProps.ColumnDefinition<ActivityEvent>[]): CollectionPreferencesProps.Preferences {
  return {
    contentDisplay: columns.map(({ id = '' }) => ({ id, visible: !HIDDEN_BY_DEFAULT.has(id) })),
    wrapLines: false,
  }
}

function exportEvents(events: readonly ActivityEvent[], format: ExportFormat) {
  try {
    const data = format === 'csv' ? events.map(csvRow) : events.map((event) => ({ ...event }))
    exportData({ service: 'cloudtrail', resourceType: 'events', data, format })
  } catch (error) {
    toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function NoEvents({ lookup }: { lookup: ActivityLookup | null }) {
  const defaultLookup = lookup?.attribute === DEFAULT_LOOKUP.attribute && lookup.value === DEFAULT_LOOKUP.value
  return (
    <Box textAlign="center" color="inherit" padding="m">
      <SpaceBetween size="xxs">
        <Box variant="strong" color="inherit">
          No events
        </Box>
        <Box variant="p" color="inherit">
          {lookup ? `Nothing where ${describeLookup(lookup)} in this time range.` : 'Nothing in this time range.'}
          {defaultLookup && ' Calls that only read are left out: choose All events to see them too.'}
        </Box>
        <Box variant="p" color="text-body-secondary">
          Some emulators don't record the calls they serve, or only when asked to. On AWS, new events can take a few minutes to show up.
        </Box>
      </SpaceBetween>
    </Box>
  )
}

export default function CloudscapeActivity() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { activeEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const visible = usePageVisible()

  const rangeParam = searchParams.get('range')
  const startParam = searchParams.get('start')
  const endParam = searchParams.get('end')
  const range = useMemo(() => parseRange(rangeParam, startParam, endParam), [rangeParam, startParam, endParam])
  const attributeParam = searchParams.get('attribute')
  const valueParam = searchParams.get('value')
  const lookup = useMemo(() => parseLookup(attributeParam, valueParam), [attributeParam, valueParam])
  const filterText = searchParams.get('filter') ?? ''

  const updateParams = useCallback(
    (changes: Record<string, string | null>, replace = false) =>
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          for (const [name, value] of Object.entries(changes)) {
            if (value === null) next.delete(name)
            else next.set(name, value)
          }
          return next
        },
        { replace },
      ),
    [setSearchParams],
  )

  const [autoRefresh, setAutoRefresh] = useState(false)
  const fetcher = useCallback(
    () => fetchActivityEvents(firstPageQuery(range, lookup, Date.now()), activeEndpoint),
    [range, lookup, activeEndpoint],
  )
  const { data, loading, error, errorDetail, refresh } = useFetch(fetcher, autoRefresh && visible ? AUTO_REFRESH_MS : undefined)

  const [older, setOlder] = useState<OlderPages | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const pages = useMemo(() => (data ? [data, ...(older?.after === data ? older.pages : [])] : []), [data, older])
  const events = useMemo(() => pages.flatMap((page) => page.events), [pages])
  const nextToken = pages.length > 0 ? pages[pages.length - 1].nextToken : null

  const loadOlder = async () => {
    const first = data
    if (!first || !nextToken) return
    // A refresh starts over from the newest events, which would drop these
    setAutoRefresh(false)
    setLoadingOlder(true)
    try {
      const page = await fetchActivityEvents(
        { startTime: first.startTime, endTime: first.endTime, lookup, nextToken },
        activeEndpoint,
      )
      setOlder((current) => ({ after: first, pages: [...(current?.after === first ? current.pages : []), page] }))
    } catch (failure) {
      toast.error(`Couldn't load older events: ${failure instanceof Error ? failure.message : String(failure)}`)
    } finally {
      setLoadingOlder(false)
    }
  }

  const [selected, setSelected] = useState<ActivityEvent | null>(null)
  const columns = useMemo(() => eventColumns(setSelected), [])
  const [preferences, setPreferences] = useState(() => defaultPreferences(columns))

  const { items, filterProps, filteredItemsCount } = useCollection(events, {
    filtering: { defaultFilteringText: filterText, filteringFunction: matchesText },
  })

  const notSupported = errorDetail?.kind === 'not_implemented'
  const region = health?.region ? ` in ${health.region}` : ''
  const counter = data ? `(${filterProps.filteringText ? `${filteredItemsCount}/` : ''}${events.length}${nextToken ? '+' : ''})` : undefined

  return (
    <CloudscapeShell activeHref="/activity">
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={`Management events CloudTrail recorded${region}, newest first: who called which API, when, and how it went.`}
            actions={
              <SpaceBetween direction="horizontal" size="s" alignItems="center">
                <Toggle checked={autoRefresh} onChange={({ detail }) => setAutoRefresh(detail.checked)}>
                  Auto-refresh every 10 seconds
                </Toggle>
                <Button iconName="refresh" ariaLabel="Refresh events" loading={loading} onClick={() => void refresh()} />
              </SpaceBetween>
            }
          >
            Activity
          </Header>
        }
      >
        {notSupported ? (
          <Container header={<Header variant="h2">Not supported by this endpoint</Header>}>
            <SpaceBetween size="s">
              <Box variant="p">
                This endpoint doesn't implement CloudTrail's LookupEvents, so there's no event history to show. Activity works with AWS
                and with emulators that record the calls they serve.
              </Box>
              {errorDetail && <ClassifiedErrorDetails error={errorDetail} />}
            </SpaceBetween>
          </Container>
        ) : (
          <SpaceBetween size="l">
            {error && (
              <Alert type="error" header="Couldn't look up events" action={<Button onClick={() => void refresh()}>Retry</Button>}>
                <SpaceBetween size="xs">
                  <Box variant="code">
                    <span className="whitespace-pre-wrap break-all">{error}</span>
                  </Box>
                  {errorDetail && <ClassifiedErrorDetails error={errorDetail} />}
                </SpaceBetween>
              </Alert>
            )}
            <Table
              items={items}
              columnDefinitions={columns}
              columnDisplay={preferences.contentDisplay}
              wrapLines={preferences.wrapLines}
              loading={loading && !data}
              loadingText="Looking up events"
              variant="full-page"
              stickyHeader
              resizableColumns
              empty={data ? <NoEvents lookup={lookup} /> : null}
              header={
                <Header
                  variant="h2"
                  counter={counter}
                  description={lookup ? `Where ${describeLookup(lookup)}` : 'All events'}
                  actions={
                    <ButtonDropdown
                      disabled={items.length === 0}
                      items={[
                        { id: 'json', text: 'Export as JSON' },
                        { id: 'csv', text: 'Export as CSV' },
                      ]}
                      onItemClick={({ detail }) => exportEvents(items, detail.id === 'csv' ? 'csv' : 'json')}
                    >
                      Export
                    </ButtonDropdown>
                  }
                >
                  Events
                </Header>
              }
              filter={
                <SpaceBetween direction="horizontal" size="xs">
                  <LookupFilter
                    key={lookup ? `${lookup.attribute}=${lookup.value}` : 'none'}
                    lookup={lookup}
                    onApply={(next) => updateParams(lookupParams(next))}
                  />
                  <DateRangePicker
                    value={pickerValue(range)}
                    onChange={({ detail }) => updateParams(rangeParams(rangeFromPicker(detail.value)))}
                    relativeOptions={RELATIVE_OPTIONS}
                    customRelativeRangeUnits={RELATIVE_UNITS}
                    isValidRange={validateRange}
                    showClearButton={false}
                    placeholder="Choose a time range"
                    expandToViewport
                  />
                  <TextFilter
                    {...filterProps}
                    onChange={(event) => {
                      filterProps.onChange(event)
                      updateParams({ filter: event.detail.filteringText || null }, true)
                    }}
                    filteringPlaceholder="Find in loaded events"
                    filteringAriaLabel="Find in loaded events"
                    countText={`${filteredItemsCount ?? 0} matches`}
                  />
                </SpaceBetween>
              }
              footer={
                nextToken && (
                  <Box textAlign="center">
                    <Button onClick={() => void loadOlder()} loading={loadingOlder}>
                      Load older events
                    </Button>
                  </Box>
                )
              }
              preferences={
                <CollectionPreferences
                  title="Preferences"
                  confirmLabel="Confirm"
                  cancelLabel="Cancel"
                  preferences={preferences}
                  onConfirm={({ detail }) => setPreferences(detail)}
                  wrapLinesPreference={{ label: 'Wrap lines', description: 'Show long values, like user agents, in full.' }}
                  contentDisplayPreference={{
                    title: 'Columns',
                    options: columns.map(({ id = '', header }) => ({ id, label: String(header), alwaysVisible: id === 'eventName' })),
                  }}
                />
              }
            />
          </SpaceBetween>
        )}
      </ContentLayout>
      {selected && <ActivityEventModal event={selected} onDismiss={() => setSelected(null)} />}
    </CloudscapeShell>
  )
}
