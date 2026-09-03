import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import Container from '@cloudscape-design/components/container'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Pagination from '@cloudscape-design/components/pagination'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import Toggle from '@cloudscape-design/components/toggle'
import { toast } from 'sonner'
import {
  createLogGroup,
  deleteLogGroup,
  deleteLogStream,
  fetchLogEvents,
  fetchLogGroups,
  fetchLogStreams,
  fetchResourceTags,
  setLogGroupRetention,
  updateResourceTags,
} from '@/lib/api'
import type { LogEvent, LogGroup, LogGroupsResponse, LogStream, LogStreamsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { exportData } from '@/lib/export'

const VALID_RETENTION_DAYS = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653]

const RETENTION_OPTIONS = [
  { label: 'Never expire', value: 'never' },
  ...VALID_RETENTION_DAYS.map((days) => ({ label: `${days} days`, value: String(days) })),
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diffSecs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSecs < 60) return `${diffSecs}s ago`
  const diffMins = Math.floor(diffSecs / 60)
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

function tryParseJSON(message: string): { isJSON: boolean; formatted: string } {
  try {
    const parsed: unknown = JSON.parse(message)
    if (typeof parsed === 'object' && parsed !== null) {
      return { isJSON: true, formatted: JSON.stringify(parsed, null, 2) }
    }
  } catch {
    // not JSON
  }
  return { isJSON: false, formatted: message }
}

function copyText(text: string, label: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied to clipboard`))
    .catch(() => toast.error(`Failed to copy ${label}`))
}

function LogEventRow({ event }: { event: LogEvent }) {
  const { isJSON, formatted } = tryParseJSON(event.message)
  return (
    <div className="border-b border-neutral-200/20 py-2 last:border-b-0">
      <SpaceBetween direction="horizontal" size="xs">
        <Box color="text-body-secondary" fontSize="body-s">
          {formatDate(event.timestamp)}
        </Box>
        <Box color="text-status-inactive" fontSize="body-s">
          {formatRelativeTime(event.timestamp)}
        </Box>
        {isJSON && <Badge color="blue">JSON</Badge>}
        <Button variant="inline-icon" iconName="copy" ariaLabel="Copy message" onClick={() => copyText(event.message, 'Message')} />
      </SpaceBetween>
      <Box variant="code">
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{formatted}</pre>
      </Box>
    </div>
  )
}

// --- Modals -----------------------------------------------------------------

function CreateLogGroupModal({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [retention, setRetention] = useState('never')
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>([])
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const retentionInDays = retention === 'never' ? null : Number(retention)
      const record = Object.fromEntries(tags.filter((t) => t.key.trim()).map((t) => [t.key.trim(), t.value]))
      await createLogGroup(name.trim(), retentionInDays, record, activeEndpoint)
      toast.success(`Log group '${name.trim()}' created`)
      onDone(name.trim())
    } catch (error) {
      toast.error(`Failed to create log group: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header="Create log group" size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={!name.trim()} data-testid="create-group-submit">
              Create log group
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Log group name">
            <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="/aws/lambda/my-function" autoFocus />
          </FormField>
          <FormField label="Retention">
            <Select
              selectedOption={RETENTION_OPTIONS.find((o) => o.value === retention) ?? RETENTION_OPTIONS[0]}
              onChange={({ detail }) => setRetention(detail.selectedOption.value as string)}
              options={RETENTION_OPTIONS}
            />
          </FormField>
          <FormField label="Tags">
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
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

function SetRetentionModal({
  logGroupName,
  currentRetention,
  onClose,
  onDone,
}: {
  logGroupName: string
  currentRetention: number | null
  onClose: () => void
  onDone: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [retention, setRetention] = useState(currentRetention ? String(currentRetention) : 'never')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const retentionInDays = retention === 'never' ? null : Number(retention)
      await setLogGroupRetention(logGroupName, retentionInDays, activeEndpoint)
      toast.success('Retention updated')
      onDone()
    } catch (error) {
      toast.error(`Failed to update retention: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Retention for ${logGroupName}`} size="small">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} data-testid="save-retention">
              Save
            </Button>
          </SpaceBetween>
        }
      >
        <FormField label="Retention">
          <Select
            selectedOption={RETENTION_OPTIONS.find((o) => o.value === retention) ?? RETENTION_OPTIONS[0]}
            onChange={({ detail }) => setRetention(detail.selectedOption.value as string)}
            options={RETENTION_OPTIONS}
          />
        </FormField>
      </Form>
    </Modal>
  )
}

function TypeNameDeleteModal({
  header,
  targetName,
  warning,
  testId,
  onClose,
  onConfirm,
}: {
  header: string
  targetName: string
  warning: string
  testId: string
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [working, setWorking] = useState(false)

  const submit = async () => {
    setWorking(true)
    try {
      await onConfirm()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      visible
      onDismiss={onClose}
      header={header}
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void submit()}
              loading={working}
              disabled={confirmText !== targetName}
              data-testid={testId}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Alert type="warning">{warning}</Alert>
        <FormField label={`Type "${targetName}" to confirm`}>
          <Input value={confirmText} onChange={({ detail }) => setConfirmText(detail.value)} placeholder={targetName} />
        </FormField>
      </SpaceBetween>
    </Modal>
  )
}

// --- Tags tab ----------------------------------------------------------------

function LogGroupTagsPanel({ group }: { group: LogGroup }) {
  const { activeEndpoint } = useEndpoint()
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchResourceTags('logs', 'log_groups', group.arn, activeEndpoint)
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
  }, [group.arn, activeEndpoint])

  const save = async () => {
    setSaving(true)
    try {
      const record = Object.fromEntries(tags.filter((t) => t.key.trim()).map((t) => [t.key.trim(), t.value]))
      await updateResourceTags('logs', 'log_groups', group.arn, record, activeEndpoint)
      toast.success('Log group tags updated')
    } catch (error) {
      toast.error(`Failed to update tags: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <StatusIndicator type="loading">Loading tags</StatusIndicator>

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
      <Button variant="primary" onClick={save} loading={saving} data-testid="save-group-tags">
        Save tags
      </Button>
    </SpaceBetween>
  )
}

// --- Events panel --------------------------------------------------------------

function EventsPanel({ group, stream }: { group: string; stream: string }) {
  const { activeEndpoint } = useEndpoint()
  const [events, setEvents] = useState<LogEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [filterPattern, setFilterPattern] = useState('')
  const [appliedFilterPattern, setAppliedFilterPattern] = useState('')
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(0)
  const [tailMode, setTailMode] = useState(false)

  const loadEvents = useCallback(
    async (append = false, token = '') => {
      setLoading(true)
      try {
        const res = await fetchLogEvents(group, stream, startTime, endTime, appliedFilterPattern, 100, token, activeEndpoint)
        setEvents((prev) => (append ? [...prev, ...res.events] : res.events))
        setNextToken(res.next_token || null)
      } catch (err) {
        toast.error(`Failed to load log events: ${err instanceof Error ? err.message : err}`)
        setEvents([])
      } finally {
        setLoading(false)
      }
    },
    [group, stream, startTime, endTime, appliedFilterPattern, activeEndpoint],
  )

  useEffect(() => {
    if (group && stream) void loadEvents()
  }, [group, stream, loadEvents])

  // Latest event timestamp, used as the tail cursor without retriggering effects.
  const lastMillisRef = useRef(0)
  useEffect(() => {
    if (events.length > 0) {
      lastMillisRef.current = Math.max(lastMillisRef.current, events[events.length - 1].timestamp_millis)
    }
  }, [events])

  const appendEvents = useCallback((incoming: LogEvent[]) => {
    if (incoming.length === 0) return
    setEvents((prev) => [...prev, ...incoming])
    setTimeout(() => {
      const container = document.getElementById('cloudscape-log-events')
      if (container) container.scrollTop = container.scrollHeight
    }, 100)
  }, [])

  // Tail mode (#85): live events over WebSocket, with a 3s polling fallback
  // when the socket cannot be established.
  useEffect(() => {
    if (!tailMode) return
    let closedByUs = false
    let fallbackInterval: ReturnType<typeof setInterval> | null = null

    const startPollingFallback = () => {
      if (fallbackInterval) return
      fallbackInterval = setInterval(() => {
        const since = lastMillisRef.current
        if (since === 0) return
        fetchLogEvents(group, stream, since + 1, 0, appliedFilterPattern, 100, '', activeEndpoint)
          .then((res) => appendEvents(res.events))
          .catch(() => {
            // transient poll failure; next tick retries
          })
      }, 3000)
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    let ws: WebSocket | null = null
    try {
      ws = new WebSocket(`${protocol}://${window.location.host}/ws/logs/tail`)
    } catch {
      startPollingFallback()
    }
    if (ws) {
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            type: 'tail',
            group,
            stream,
            endpoint: activeEndpoint,
            filterPattern: appliedFilterPattern,
            since: lastMillisRef.current || undefined,
          }),
        )
      }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string)
          if (msg.type === 'events') appendEvents(msg.data.events as LogEvent[])
        } catch {
          // ignore malformed frames
        }
      }
      ws.onerror = () => startPollingFallback()
      ws.onclose = () => {
        if (!closedByUs) startPollingFallback()
      }
    }

    return () => {
      closedByUs = true
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop' }))
      }
      ws?.close()
      if (fallbackInterval) clearInterval(fallbackInterval)
    }
  }, [tailMode, group, stream, appliedFilterPattern, activeEndpoint, appendEvents])

  const setRelativeTimeRange = (hours: number) => {
    setStartTime(Date.now() - hours * 60 * 60 * 1000)
    setEndTime(0)
  }

  return (
    <Container
      header={
        <Header
          variant="h3"
          counter={tailMode ? undefined : events.length > 0 ? `(${events.length})` : undefined}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {tailMode && <Badge color="green">Live</Badge>}
              <Toggle checked={tailMode} onChange={({ detail }) => setTailMode(detail.checked)}>
                Tail mode
              </Toggle>
              {events.length > 0 && (
                <ButtonDropdown
                  items={[
                    { id: 'json', text: 'Export as JSON' },
                    { id: 'csv', text: 'Export as CSV' },
                  ]}
                  onItemClick={({ detail }) =>
                    exportData({
                      service: 'logs',
                      resourceType: 'events',
                      data: events as unknown as Record<string, unknown>[],
                      format: detail.id as 'json' | 'csv',
                    })
                  }
                >
                  Export
                </ButtonDropdown>
              )}
            </SpaceBetween>
          }
        >
          Log events
        </Header>
      }
    >
      <SpaceBetween size="s">
        <ExpandableSection headerText="Filters">
          <SpaceBetween size="s">
            <SpaceBetween direction="horizontal" size="xs">
              <Input
                value={filterPattern}
                onChange={({ detail }) => setFilterPattern(detail.value)}
                placeholder="Filter pattern (CloudWatch syntax)"
                ariaLabel="Filter pattern"
              />
              <Button onClick={() => setAppliedFilterPattern(filterPattern)} data-testid="apply-filter">
                Apply
              </Button>
            </SpaceBetween>
            <SpaceBetween direction="horizontal" size="xs">
              <Box color="text-body-secondary" fontSize="body-s">
                Quick range:
              </Box>
              <Button variant="inline-link" onClick={() => setRelativeTimeRange(1)}>
                1h
              </Button>
              <Button variant="inline-link" onClick={() => setRelativeTimeRange(6)}>
                6h
              </Button>
              <Button variant="inline-link" onClick={() => setRelativeTimeRange(24)}>
                24h
              </Button>
              <Button
                variant="inline-link"
                onClick={() => {
                  setStartTime(0)
                  setEndTime(0)
                }}
              >
                Clear
              </Button>
            </SpaceBetween>
          </SpaceBetween>
        </ExpandableSection>

        <div id="cloudscape-log-events" className="max-h-[32rem] overflow-y-auto">
          {loading && events.length === 0 && <StatusIndicator type="loading">Loading events</StatusIndicator>}
          {!loading && events.length === 0 && <Box color="text-status-inactive">No events found for this stream</Box>}
          {events.map((event, idx) => (
            <LogEventRow key={`${event.timestamp_millis}-${idx}`} event={event} />
          ))}
          {nextToken && !tailMode && events.length > 0 && (
            <Box textAlign="center" padding="s">
              <Button onClick={() => void loadEvents(true, nextToken)} loading={loading}>
                Load more
              </Button>
            </Box>
          )}
        </div>
      </SpaceBetween>
    </Container>
  )
}

// --- Tables ----------------------------------------------------------------------

function GroupsTable({
  groups,
  loading,
  counter,
  search,
  onSearch,
  onRefresh,
  onCreate,
  onOpen,
  onEditRetention,
  onDelete,
}: {
  groups: LogGroup[]
  loading: boolean
  counter?: string
  search: string
  onSearch: (value: string) => void
  onRefresh: () => void
  onCreate: () => void
  onOpen: (name: string) => void
  onEditRetention: (group: LogGroup) => void
  onDelete: (name: string) => void
}) {
  const { items, collectionProps, paginationProps } = useCollection(groups, {
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="name"
      loading={loading && groups.length === 0}
      loadingText="Loading log groups"
      variant="borderless"
      stickyHeader
      header={
        <Header
          variant="h2"
          counter={counter}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" onClick={onRefresh} loading={loading} ariaLabel="Refresh log groups" />
              <Button variant="primary" iconName="add-plus" onClick={onCreate}>
                Create log group
              </Button>
            </SpaceBetween>
          }
        >
          Log groups
        </Header>
      }
      filter={
        <Input
          type="search"
          value={search}
          onChange={({ detail }) => onSearch(detail.value)}
          placeholder="Search log groups..."
          ariaLabel="Search log groups"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" padding="l" color="text-status-inactive">
          No log groups found
        </Box>
      }
      columnDefinitions={[
        {
          id: 'name',
          header: 'Name',
          sortingField: 'name',
          cell: (g) => (
            <Link
              href={`?group=${encodeURIComponent(g.name)}`}
              onFollow={(event) => {
                event.preventDefault()
                onOpen(g.name)
              }}
            >
              {g.name}
            </Link>
          ),
        },
        { id: 'size', header: 'Stored', sortingField: 'stored_bytes', cell: (g) => formatBytes(g.stored_bytes) },
        {
          id: 'retention',
          header: 'Retention',
          sortingField: 'retention_days',
          cell: (g) => (g.retention_days ? `${g.retention_days} days` : 'Never expire'),
        },
        { id: 'created', header: 'Created', sortingField: 'creation_time', cell: (g) => formatDate(g.creation_time) },
        {
          id: 'actions',
          header: 'Actions',
          cell: (g) => (
            <SpaceBetween direction="horizontal" size="xxs">
              <Button variant="icon" iconName="settings" ariaLabel={`Edit retention for ${g.name}`} onClick={() => onEditRetention(g)} />
              <Button variant="icon" iconName="remove" ariaLabel={`Delete log group ${g.name}`} onClick={() => onDelete(g.name)} />
            </SpaceBetween>
          ),
        },
      ]}
    />
  )
}

function StreamsTable({
  group,
  streams,
  loading,
  search,
  onSearch,
  onRefresh,
  onOpen,
  onDelete,
}: {
  group: string
  streams: LogStream[]
  loading: boolean
  search: string
  onSearch: (value: string) => void
  onRefresh: () => void
  onOpen: (name: string) => void
  onDelete: (name: string) => void
}) {
  const { items, collectionProps, paginationProps } = useCollection(streams, {
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="name"
      loading={loading && streams.length === 0}
      loadingText="Loading log streams"
      variant="borderless"
      stickyHeader
      header={
        <Header
          variant="h3"
          counter={`(${streams.length})`}
          actions={<Button iconName="refresh" onClick={onRefresh} loading={loading} ariaLabel="Refresh log streams" />}
        >
          Log streams
        </Header>
      }
      filter={
        <Input
          type="search"
          value={search}
          onChange={({ detail }) => onSearch(detail.value)}
          placeholder="Search streams..."
          ariaLabel="Search log streams"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" padding="l" color="text-status-inactive">
          No log streams found in this group
        </Box>
      }
      columnDefinitions={[
        {
          id: 'name',
          header: 'Stream name',
          sortingField: 'name',
          cell: (s) => (
            <Link
              href={`?group=${encodeURIComponent(group)}&stream=${encodeURIComponent(s.name)}`}
              onFollow={(event) => {
                event.preventDefault()
                onOpen(s.name)
              }}
            >
              {s.name}
            </Link>
          ),
        },
        { id: 'lastEvent', header: 'Last event', sortingField: 'last_event_time', cell: (s) => formatRelativeTime(s.last_event_time) },
        { id: 'size', header: 'Size', sortingField: 'stored_bytes', cell: (s) => formatBytes(s.stored_bytes) },
        {
          id: 'actions',
          header: 'Actions',
          cell: (s) => (
            <Button variant="icon" iconName="remove" ariaLabel={`Delete stream ${s.name}`} onClick={() => onDelete(s.name)} />
          ),
        },
      ]}
    />
  )
}

// --- Root ----------------------------------------------------------------------

export function CloudscapeLogsBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedGroup = searchParams.get('group')
  const selectedStream = searchParams.get('stream')

  const [groupSearch, setGroupSearch] = useState('')
  const [streamSearch, setStreamSearch] = useState('')

  const groupsFetcher = useCallback(() => fetchLogGroups(groupSearch, '', activeEndpoint), [groupSearch, activeEndpoint])
  const { data: groupsData, loading: groupsLoading, error: groupsError, refresh: refreshGroups } = useFetch<LogGroupsResponse>(groupsFetcher, 10000)

  const streamsFetcher = useCallback(
    () =>
      selectedGroup
        ? fetchLogStreams(selectedGroup, streamSearch, 'LastEventTime', true, 50, '', activeEndpoint)
        : Promise.resolve(null),
    [selectedGroup, streamSearch, activeEndpoint],
  )
  const { data: streamsData, loading: streamsLoading, refresh: refreshStreams } = useFetch<LogStreamsResponse | null>(streamsFetcher)

  const [creating, setCreating] = useState(false)
  const [retentionTarget, setRetentionTarget] = useState<LogGroup | null>(null)
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null)
  const [streamToDelete, setStreamToDelete] = useState<string | null>(null)

  const groups = groupsData?.log_groups ?? []
  const streams = streamsData?.log_streams ?? []
  const currentGroup = groups.find((g) => g.name === selectedGroup)

  const openGroup = (name: string | null) => {
    if (name === null) setSearchParams({})
    else setSearchParams({ group: name })
  }
  const openStream = (name: string | null) => {
    if (!selectedGroup) return
    if (name === null) setSearchParams({ group: selectedGroup })
    else setSearchParams({ group: selectedGroup, stream: name })
  }

  const confirmDeleteGroup = async () => {
    if (!groupToDelete) return
    try {
      await deleteLogGroup(groupToDelete, activeEndpoint)
      toast.success(`Log group "${groupToDelete}" deleted`)
      if (selectedGroup === groupToDelete) openGroup(null)
      setGroupToDelete(null)
      refreshGroups()
    } catch (error) {
      toast.error(`Failed to delete log group: ${error}`)
    }
  }

  const confirmDeleteStream = async () => {
    if (!selectedGroup || !streamToDelete) return
    try {
      await deleteLogStream(selectedGroup, streamToDelete, activeEndpoint)
      toast.success(`Log stream "${streamToDelete}" deleted`)
      if (selectedStream === streamToDelete) openStream(null)
      setStreamToDelete(null)
      refreshStreams()
    } catch (error) {
      toast.error(`Failed to delete log stream: ${error}`)
    }
  }

  const breadcrumbs = selectedGroup && (
    <BreadcrumbGroup
      ariaLabel="Log group path"
      items={[
        { text: 'Log groups', href: '?' },
        { text: selectedGroup, href: `?group=${encodeURIComponent(selectedGroup)}` },
        ...(selectedStream
          ? [{ text: selectedStream, href: `?group=${encodeURIComponent(selectedGroup)}&stream=${encodeURIComponent(selectedStream)}` }]
          : []),
      ]}
      onFollow={(event) => {
        event.preventDefault()
        const url = new URL(event.detail.href, window.location.origin)
        const group = url.searchParams.get('group')
        if (!group) openGroup(null)
        else openStream(url.searchParams.get('stream'))
      }}
    />
  )

  // Level 3: a stream's events, full width
  if (selectedGroup && selectedStream) {
    return (
      <SpaceBetween size="m">
        {breadcrumbs}
        <EventsPanel group={selectedGroup} stream={selectedStream} />
      </SpaceBetween>
    )
  }

  // Level 2: a group's streams and tags, full width
  if (selectedGroup) {
    return (
      <SpaceBetween size="m">
        {breadcrumbs}
        <Header
          variant="h2"
          description={
            currentGroup
              ? `${formatBytes(currentGroup.stored_bytes)} stored · retention ${currentGroup.retention_days ? `${currentGroup.retention_days} days` : 'never expires'}`
              : undefined
          }
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="settings" disabled={!currentGroup} onClick={() => currentGroup && setRetentionTarget(currentGroup)}>
                Edit retention
              </Button>
              <Button iconName="remove" onClick={() => setGroupToDelete(selectedGroup)}>
                Delete group
              </Button>
            </SpaceBetween>
          }
        >
          {selectedGroup}
        </Header>

        <Tabs
          tabs={[
            {
              id: 'streams',
              label: `Streams (${streams.length})`,
              content: (
                <StreamsTable
                  group={selectedGroup}
                  streams={streams}
                  loading={streamsLoading}
                  search={streamSearch}
                  onSearch={setStreamSearch}
                  onRefresh={() => refreshStreams()}
                  onOpen={openStream}
                  onDelete={setStreamToDelete}
                />
              ),
            },
            {
              id: 'tags',
              label: 'Tags',
              content: currentGroup ? (
                <LogGroupTagsPanel group={currentGroup} />
              ) : (
                <StatusIndicator type="loading">Loading group</StatusIndicator>
              ),
            },
          ]}
        />

        {retentionTarget && (
          <SetRetentionModal
            logGroupName={retentionTarget.name}
            currentRetention={retentionTarget.retention_days}
            onClose={() => setRetentionTarget(null)}
            onDone={() => {
              setRetentionTarget(null)
              refreshGroups()
            }}
          />
        )}
        {groupToDelete && (
          <TypeNameDeleteModal
            header="Delete log group"
            targetName={groupToDelete}
            warning="Deleting a log group permanently removes all of its streams and events. This cannot be undone."
            testId="confirm-delete-group"
            onClose={() => setGroupToDelete(null)}
            onConfirm={confirmDeleteGroup}
          />
        )}
        {streamToDelete && (
          <TypeNameDeleteModal
            header="Delete log stream"
            targetName={streamToDelete}
            warning="Deleting a log stream permanently removes all of its events. This cannot be undone."
            testId="confirm-delete-stream"
            onClose={() => setStreamToDelete(null)}
            onConfirm={confirmDeleteStream}
          />
        )}
      </SpaceBetween>
    )
  }

  // Level 1: all log groups, full width
  return (
    <SpaceBetween size="l">
      {!groupsLoading && groupsError && (
        <Alert type="error" header="Could not load log groups" action={<Button onClick={() => refreshGroups()}>Retry</Button>}>
          {groupsError}
        </Alert>
      )}

      <GroupsTable
        groups={groups}
        loading={groupsLoading}
        counter={groupsData ? `(${groups.length})` : undefined}
        search={groupSearch}
        onSearch={setGroupSearch}
        onRefresh={() => refreshGroups()}
        onCreate={() => setCreating(true)}
        onOpen={openGroup}
        onEditRetention={setRetentionTarget}
        onDelete={setGroupToDelete}
      />

      {creating && (
        <CreateLogGroupModal
          onClose={() => setCreating(false)}
          onDone={(name) => {
            setCreating(false)
            refreshGroups()
            openGroup(name)
          }}
        />
      )}
      {retentionTarget && (
        <SetRetentionModal
          logGroupName={retentionTarget.name}
          currentRetention={retentionTarget.retention_days}
          onClose={() => setRetentionTarget(null)}
          onDone={() => {
            setRetentionTarget(null)
            refreshGroups()
          }}
        />
      )}
      {groupToDelete && (
        <TypeNameDeleteModal
          header="Delete log group"
          targetName={groupToDelete}
          warning="Deleting a log group permanently removes all of its streams and events. This cannot be undone."
          testId="confirm-delete-group"
          onClose={() => setGroupToDelete(null)}
          onConfirm={confirmDeleteGroup}
        />
      )}
      {streamToDelete && (
        <TypeNameDeleteModal
          header="Delete log stream"
          targetName={streamToDelete}
          warning="Deleting a log stream permanently removes all of its events. This cannot be undone."
          testId="confirm-delete-stream"
          onClose={() => setStreamToDelete(null)}
          onConfirm={confirmDeleteStream}
        />
      )}
    </SpaceBetween>
  )
}
