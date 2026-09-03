import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import BarChart from '@cloudscape-design/components/bar-chart'
import Box from '@cloudscape-design/components/box'
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import LineChart from '@cloudscape-design/components/line-chart'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  fetchCloudWatchAlarms,
  fetchCloudWatchDashboard,
  fetchCloudWatchDashboards,
  fetchMetricData,
} from '@/lib/api'
import type {
  CloudWatchAlarm,
  CloudWatchDashboardDetail,
  CloudWatchDashboardEntry,
  CloudWatchWidget,
  MetricDataQueryInput,
  MetricSeries,
} from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

const RANGE_OPTIONS = [
  { label: 'Last 15 minutes', value: '15' },
  { label: 'Last hour', value: '60' },
  { label: 'Last 3 hours', value: '180' },
  { label: 'Last 12 hours', value: '720' },
  { label: 'Last 24 hours', value: '1440' },
]

const COMPARISON_SYMBOLS: Record<string, string> = {
  GreaterThanThreshold: '>',
  GreaterThanOrEqualToThreshold: '>=',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '<=',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function alarmStateIndicator(state: CloudWatchAlarm['state']) {
  if (state === 'OK') return <StatusIndicator type="success">OK</StatusIndicator>
  if (state === 'ALARM') return <StatusIndicator type="error">ALARM</StatusIndicator>
  return <StatusIndicator type="pending">INSUFFICIENT_DATA</StatusIndicator>
}

function alarmCondition(alarm: CloudWatchAlarm): string {
  if (!alarm.metricName || alarm.threshold === null) return '—'
  const symbol = COMPARISON_SYMBOLS[alarm.comparisonOperator ?? ''] ?? alarm.comparisonOperator ?? ''
  return `${alarm.statistic ?? ''} ${alarm.metricName} ${symbol} ${alarm.threshold}`.trim()
}

// --- Dashboard widget parsing --------------------------------------------------

interface ParsedMetric {
  id: string
  namespace: string
  metricName: string
  dimensions: Array<{ name: string; value: string }>
  stat: string
  label: string
}

interface ParsedWidget {
  key: string
  title: string
  kind: 'line' | 'bar' | 'text' | 'unsupported'
  markdown?: string
  metrics: ParsedMetric[]
}

/**
 * Parse the CloudWatch dashboard metrics array format:
 *   ["Namespace", "MetricName", "DimName", "DimValue", ..., { stat, label }]
 * Expression entries and cross-widget references are skipped.
 */
function parseWidgets(body: CloudWatchDashboardDetail['body']): ParsedWidget[] {
  const widgets = body.widgets ?? []
  return widgets.map((widget: CloudWatchWidget, widgetIndex: number) => {
    const props = widget.properties ?? {}
    const title = (props.title as string) || `Widget ${widgetIndex + 1}`
    if (widget.type === 'text') {
      return { key: `w${widgetIndex}`, title, kind: 'text' as const, markdown: (props.markdown as string) ?? '', metrics: [] }
    }
    if (widget.type && widget.type !== 'metric') {
      return { key: `w${widgetIndex}`, title, kind: 'unsupported' as const, metrics: [] }
    }

    const view = (props.view as string) ?? 'timeSeries'
    const rawMetrics = (props.metrics as unknown[][]) ?? []
    const metrics: ParsedMetric[] = []
    rawMetrics.forEach((entry, metricIndex) => {
      if (!Array.isArray(entry)) return
      const strings = entry.filter((part): part is string => typeof part === 'string')
      const options = (entry.find((part) => typeof part === 'object' && part !== null && !Array.isArray(part)) ?? {}) as Record<string, unknown>
      if (strings.length < 2 || typeof options.expression === 'string') return
      const [namespace, metricName, ...dimParts] = strings
      const dimensions: Array<{ name: string; value: string }> = []
      for (let i = 0; i + 1 < dimParts.length; i += 2) {
        dimensions.push({ name: dimParts[i], value: dimParts[i + 1] })
      }
      metrics.push({
        id: `w${widgetIndex}m${metricIndex}`,
        namespace,
        metricName,
        dimensions,
        stat: (options.stat as string) ?? 'Average',
        label: (options.label as string) ?? metricName,
      })
    })

    return {
      key: `w${widgetIndex}`,
      title,
      kind: view === 'bar' ? ('bar' as const) : ('line' as const),
      metrics,
    }
  })
}

function toChartSeries(widget: ParsedWidget, seriesById: Map<string, MetricSeries>) {
  return widget.metrics
    .map((metric) => {
      const series = seriesById.get(metric.id)
      if (!series) return null
      return {
        title: metric.label,
        type: 'line' as const,
        data: series.timestamps.map((ts, i) => ({ x: new Date(ts), y: series.values[i] ?? 0 })),
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
}

function WidgetCard({ widget, seriesById }: { widget: ParsedWidget; seriesById: Map<string, MetricSeries> }) {
  if (widget.kind === 'text') {
    return (
      <Container header={<Header variant="h3">{widget.title}</Header>}>
        <Box color="text-body-secondary">
          <pre className="whitespace-pre-wrap break-words text-sm font-sans">{widget.markdown}</pre>
        </Box>
      </Container>
    )
  }
  if (widget.kind === 'unsupported') {
    return (
      <Container header={<Header variant="h3">{widget.title}</Header>}>
        <Box color="text-status-inactive">Unsupported widget type</Box>
      </Container>
    )
  }

  const series = toChartSeries(widget, seriesById)
  const empty = (
    <Box textAlign="center" color="text-status-inactive">
      No datapoints in the selected range
    </Box>
  )

  return (
    <Container header={<Header variant="h3">{widget.title}</Header>}>
      {widget.kind === 'bar' ? (
        <BarChart
          series={series.map((s) => ({ ...s, type: 'bar' as const }))}
          height={220}
          xScaleType="categorical"
          hideFilter
          empty={empty}
          ariaLabel={widget.title}
        />
      ) : (
        <LineChart
          series={series}
          height={220}
          xScaleType="time"
          hideFilter
          empty={empty}
          ariaLabel={widget.title}
        />
      )}
    </Container>
  )
}

// --- Dashboard view -------------------------------------------------------------

function DashboardView({ name, onBack }: { name: string; onBack: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const detailFetcher = useCallback(() => fetchCloudWatchDashboard(name, activeEndpoint), [name, activeEndpoint])
  const { data: detail, loading, error, refresh } = useFetch<CloudWatchDashboardDetail>(detailFetcher)

  const [rangeMinutes, setRangeMinutes] = useState('180')
  const [seriesById, setSeriesById] = useState<Map<string, MetricSeries>>(new Map())
  const [loadingData, setLoadingData] = useState(false)

  const widgets = useMemo(() => (detail ? parseWidgets(detail.body) : []), [detail])

  const loadMetricData = useCallback(async () => {
    const queries: MetricDataQueryInput[] = widgets.flatMap((widget) =>
      widget.metrics.map((metric) => ({
        id: metric.id,
        namespace: metric.namespace,
        metricName: metric.metricName,
        dimensions: metric.dimensions,
        stat: metric.stat,
        period: 60,
      })),
    )
    if (queries.length === 0) return
    setLoadingData(true)
    try {
      const { results } = await fetchMetricData(queries, Number(rangeMinutes), activeEndpoint)
      setSeriesById(new Map(results.map((series) => [series.id, series])))
    } catch (err) {
      toast.error(`Failed to load metric data: ${err}`)
    } finally {
      setLoadingData(false)
    }
  }, [widgets, rangeMinutes, activeEndpoint])

  useEffect(() => {
    if (widgets.length > 0) void loadMetricData()
  }, [widgets, loadMetricData])

  if (loading && !detail) return <StatusIndicator type="loading">Loading dashboard</StatusIndicator>
  if (error && !detail) {
    return (
      <Alert type="error" header="Could not load dashboard" action={<Button onClick={() => refresh()}>Retry</Button>}>
        {error}
      </Alert>
    )
  }
  if (!detail) return null

  return (
    <SpaceBetween size="m">
      <BreadcrumbGroup
        ariaLabel="Dashboard path"
        items={[
          { text: 'Dashboards', href: '?' },
          { text: name, href: `?dashboard=${encodeURIComponent(name)}` },
        ]}
        onFollow={(event) => {
          event.preventDefault()
          if (!new URL(event.detail.href, window.location.origin).searchParams.get('dashboard')) onBack()
        }}
      />
      <Header
        variant="h2"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Select
              selectedOption={RANGE_OPTIONS.find((o) => o.value === rangeMinutes) ?? RANGE_OPTIONS[2]}
              onChange={({ detail: d }) => setRangeMinutes(d.selectedOption.value as string)}
              options={RANGE_OPTIONS}
              ariaLabel="Time range"
            />
            <Button iconName="refresh" onClick={() => void loadMetricData()} loading={loadingData} ariaLabel="Refresh metric data" />
          </SpaceBetween>
        }
      >
        {name}
      </Header>

      {widgets.length === 0 ? (
        <Box textAlign="center" padding="l" color="text-status-inactive">
          This dashboard has no widgets
        </Box>
      ) : (
        <ColumnLayout columns={2}>
          {widgets.map((widget) => (
            <WidgetCard key={widget.key} widget={widget} seriesById={seriesById} />
          ))}
        </ColumnLayout>
      )}
    </SpaceBetween>
  )
}

// --- Alarms ----------------------------------------------------------------------

function AlarmDetailModal({ alarm, onClose }: { alarm: CloudWatchAlarm; onClose: () => void }) {
  const fields: Array<[string, string]> = [
    ['Namespace', alarm.namespace ?? '—'],
    ['Metric', alarm.metricName ?? '—'],
    ['Condition', alarmCondition(alarm)],
    ['Evaluation periods', alarm.evaluationPeriods !== null ? `${alarm.evaluationPeriods} × ${alarm.period ?? '—'}s` : '—'],
    ['State updated', formatDate(alarm.stateUpdated)],
    ['Description', alarm.description || '—'],
  ]
  return (
    <Modal visible onDismiss={onClose} header={alarm.name} size="medium">
      <SpaceBetween size="m">
        <SpaceBetween direction="horizontal" size="xs">{alarmStateIndicator(alarm.state)}</SpaceBetween>
        {alarm.stateReason && <Alert type={alarm.state === 'ALARM' ? 'error' : 'info'}>{alarm.stateReason}</Alert>}
        <ColumnLayout columns={2} variant="text-grid">
          {fields.map(([label, value]) => (
            <div key={label}>
              <Box variant="awsui-key-label">{label}</Box>
              <Box fontSize="body-s">{value}</Box>
            </div>
          ))}
        </ColumnLayout>
        {alarm.dimensions.length > 0 && (
          <>
            <Header variant="h3">Dimensions</Header>
            <ColumnLayout columns={2} variant="text-grid">
              {alarm.dimensions.map((d) => (
                <div key={d.name}>
                  <Box variant="awsui-key-label">{d.name}</Box>
                  <Box fontSize="body-s">{d.value}</Box>
                </div>
              ))}
            </ColumnLayout>
          </>
        )}
      </SpaceBetween>
    </Modal>
  )
}

function AlarmsTab({ alarms, loading, onRefresh }: { alarms: CloudWatchAlarm[]; loading: boolean; onRefresh: () => void }) {
  const [viewing, setViewing] = useState<CloudWatchAlarm | null>(null)
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(alarms, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <>
      <Table
        {...collectionProps}
        items={items}
        trackBy="name"
        loading={loading && alarms.length === 0}
        loadingText="Loading alarms"
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h3"
            counter={`(${alarms.length})`}
            actions={<Button iconName="refresh" onClick={onRefresh} loading={loading} ariaLabel="Refresh alarms" />}
          >
            Alarms
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find alarms"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" padding="l" color="text-status-inactive">
            No alarms configured
          </Box>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (a) => (
              <Link
                href={`#${a.name}`}
                onFollow={(event) => {
                  event.preventDefault()
                  setViewing(a)
                }}
              >
                {a.name}
              </Link>
            ),
          },
          { id: 'state', header: 'State', sortingField: 'state', cell: (a) => alarmStateIndicator(a.state) },
          { id: 'metric', header: 'Metric', cell: (a) => (a.namespace ? `${a.namespace} / ${a.metricName}` : '—') },
          { id: 'condition', header: 'Condition', cell: (a) => alarmCondition(a) },
          { id: 'updated', header: 'State updated', sortingField: 'stateUpdated', cell: (a) => formatDate(a.stateUpdated) },
        ]}
      />
      {viewing && <AlarmDetailModal alarm={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}

// --- Root -------------------------------------------------------------------------

export function CloudscapeMonitoringBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedDashboard = searchParams.get('dashboard')

  const alarmsFetcher = useCallback(() => fetchCloudWatchAlarms(activeEndpoint), [activeEndpoint])
  const { data: alarmsData, loading: alarmsLoading, error: alarmsError, refresh: refreshAlarms } = useFetch(alarmsFetcher, 10000)

  const dashboardsFetcher = useCallback(() => fetchCloudWatchDashboards(activeEndpoint), [activeEndpoint])
  const { data: dashboardsData, loading: dashboardsLoading, refresh: refreshDashboards } = useFetch(dashboardsFetcher, 10000)

  const alarms = alarmsData?.alarms ?? []
  const dashboards = dashboardsData?.dashboards ?? []

  if (selectedDashboard) {
    return <DashboardView name={selectedDashboard} onBack={() => setSearchParams({})} />
  }

  return (
    <SpaceBetween size="l">
      {!alarmsLoading && alarmsError && (
        <Alert type="error" header="Could not load alarms" action={<Button onClick={() => refreshAlarms()}>Retry</Button>}>
          {alarmsError}
        </Alert>
      )}

      <Tabs
        tabs={[
          {
            id: 'dashboards',
            label: `Dashboards (${dashboards.length})`,
            content: (
              <DashboardsTab
                dashboards={dashboards}
                loading={dashboardsLoading}
                onRefresh={() => refreshDashboards()}
                onOpen={(name) => setSearchParams({ dashboard: name })}
              />
            ),
          },
          {
            id: 'alarms',
            label: `Alarms (${alarms.length})`,
            content: <AlarmsTab alarms={alarms} loading={alarmsLoading} onRefresh={() => refreshAlarms()} />,
          },
        ]}
      />
    </SpaceBetween>
  )
}

function DashboardsTab({
  dashboards,
  loading,
  onRefresh,
  onOpen,
}: {
  dashboards: CloudWatchDashboardEntry[]
  loading: boolean
  onRefresh: () => void
  onOpen: (name: string) => void
}) {
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(dashboards, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="name"
      loading={loading && dashboards.length === 0}
      loadingText="Loading dashboards"
      variant="borderless"
      stickyHeader
      header={
        <Header
          variant="h3"
          counter={`(${dashboards.length})`}
          actions={<Button iconName="refresh" onClick={onRefresh} loading={loading} ariaLabel="Refresh dashboards" />}
        >
          Dashboards
        </Header>
      }
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Find dashboards"
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" padding="l" color="text-status-inactive">
          No dashboards yet
        </Box>
      }
      columnDefinitions={[
        {
          id: 'name',
          header: 'Name',
          sortingField: 'name',
          cell: (d) => (
            <Link
              href={`?dashboard=${encodeURIComponent(d.name)}`}
              onFollow={(event) => {
                event.preventDefault()
                onOpen(d.name)
              }}
            >
              {d.name}
            </Link>
          ),
        },
        { id: 'modified', header: 'Last modified', sortingField: 'lastModified', cell: (d) => formatDate(d.lastModified) },
        { id: 'size', header: 'Size', sortingField: 'size', cell: (d) => `${d.size} B` },
      ]}
    />
  )
}
