import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import { fetchLogGroups, fetchLogStreams, fetchLogEvents } from '@/lib/api'
import type { LogEvent, LogGroupsResponse, LogStreamsResponse } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import { JsonViewer } from '@/components/JsonViewer'
import { useFetch } from '@/hooks/useFetch'
import { ScrollText, Search, FileText, Clock, Play, Pause, Copy, Filter, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return `${diffSecs}s ago`
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function tryParseJSON(message: string): { isJSON: boolean; parsed?: unknown } {
  try {
    const parsed = JSON.parse(message)
    return { isJSON: true, parsed }
  } catch {
    return { isJSON: false }
  }
}

function LogEventView({ event }: { event: LogEvent }) {
  const { isJSON, parsed } = tryParseJSON(event.message)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(event.message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-2 p-3">
        <div className="flex-shrink-0 text-xs text-muted-foreground font-mono w-44">
          <div>{formatDate(event.timestamp)}</div>
          <div className="text-[10px] mt-0.5">{formatRelativeTime(event.timestamp)}</div>
        </div>
        <div className="flex-1 min-w-0">
          {isJSON ? (
            <JsonViewer data={parsed} />
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-muted/50 p-2 rounded">
              {event.message}
            </pre>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={handleCopy}
          aria-label="Copy message"
        >
          {copied ? (
            <span className="text-xs text-green-500">✓</span>
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  )
}

export function LogsBrowser() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Read selected group and stream from URL params
  const selectedGroup = searchParams.get('group')
  const selectedStream = searchParams.get('stream')

  // Helpers to update URL params
  const setSelectedGroup = (group: string | null) => {
    if (group === null) {
      setSearchParams({})
    } else {
      setSearchParams({ group })
    }
  }

  const setSelectedStream = (stream: string | null) => {
    if (stream === null && selectedGroup) {
      setSearchParams({ group: selectedGroup })
    } else if (stream && selectedGroup) {
      setSearchParams({ group: selectedGroup, stream })
    } else {
      setSearchParams({})
    }
  }

  const [groupSearch, setGroupSearch] = useState('')
  const [streamSearch, setStreamSearch] = useState('')

  // Events state
  const [events, setEvents] = useState<LogEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsNextToken, setEventsNextToken] = useState<string | null>(null)
  const [filterPattern, setFilterPattern] = useState('')
  const [appliedFilterPattern, setAppliedFilterPattern] = useState('')
  const [tailMode, setTailMode] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  // Time range filters (0 = no filter)
  const [startTime, setStartTime] = useState(0)
  const [endTime, setEndTime] = useState(0)

  // Fetch log groups
  const groupsFetcher = useCallback(() => fetchLogGroups(groupSearch), [groupSearch])
  const { data: groupsData, loading: groupsLoading } = useFetch<LogGroupsResponse>(
    groupsFetcher,
    10000
  )

  // Fetch log streams (manual)
  const [streamsData, setStreamsData] = useState<LogStreamsResponse | null>(null)
  const [streamsLoading, setStreamsLoading] = useState(false)

  useEffect(() => {
    if (!selectedGroup) {
      setStreamsData(null)
      setSelectedStream(null)
      setEvents([])
      return
    }
    setStreamsLoading(true)
    fetchLogStreams(selectedGroup, streamSearch, 'LastEventTime', true, 50)
      .then(setStreamsData)
      .catch((err) => {
        toast.error(`Failed to load log streams: ${err.message}`)
        setStreamsData(null)
      })
      .finally(() => setStreamsLoading(false))
  }, [selectedGroup, streamSearch])

  // Fetch log events (manual)
  const loadEvents = useCallback(
    (append = false, nextToken = '') => {
      if (!selectedGroup || !selectedStream) return
      setEventsLoading(true)
      fetchLogEvents(selectedGroup, selectedStream, startTime, endTime, appliedFilterPattern, 100, nextToken)
        .then((res) => {
          setEvents((prev) => (append ? [...prev, ...res.events] : res.events))
          setEventsNextToken(res.next_token || null)
        })
        .catch((err) => {
          toast.error(`Failed to load log events: ${err.message}`)
          setEvents([])
        })
        .finally(() => setEventsLoading(false))
    },
    [selectedGroup, selectedStream, startTime, endTime, appliedFilterPattern]
  )

  useEffect(() => {
    if (selectedStream) {
      loadEvents()
    } else {
      setEvents([])
      setEventsNextToken(null)
    }
  }, [selectedStream, loadEvents])

  // Tail mode polling
  useEffect(() => {
    if (!tailMode || !selectedStream) return

    const interval = setInterval(() => {
      // Poll for new events — use last event timestamp + 1ms as start time
      if (events.length > 0) {
        const lastEventTime = events[events.length - 1].timestamp_millis
        if (!selectedGroup || !selectedStream) return
        fetchLogEvents(selectedGroup, selectedStream, lastEventTime + 1, 0, appliedFilterPattern, 100, '')
          .then((res) => {
            if (res.events.length > 0) {
              setEvents((prev) => [...prev, ...res.events])
              // Auto-scroll to bottom
              setTimeout(() => {
                const eventsContainer = document.getElementById('log-events-container')
                if (eventsContainer) {
                  eventsContainer.scrollTop = eventsContainer.scrollHeight
                }
              }, 100)
            }
          })
          .catch((err) => {
            console.error('Tail mode poll failed:', err)
          })
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [tailMode, selectedStream, events, selectedGroup, appliedFilterPattern])

  const applyFilter = () => {
    setAppliedFilterPattern(filterPattern)
    // Reload events with new filter
    if (selectedStream) {
      loadEvents()
    }
  }

  const setRelativeTimeRange = (hours: number) => {
    const now = Date.now()
    const start = now - hours * 60 * 60 * 1000
    setStartTime(start)
    setEndTime(0) // 0 = no end filter
    if (selectedStream) {
      loadEvents()
    }
  }

  const clearTimeRange = () => {
    setStartTime(0)
    setEndTime(0)
    if (selectedStream) {
      loadEvents()
    }
  }

  const filteredGroups = groupsData?.log_groups || []
  const filteredStreams = streamsData?.log_streams || []

  return (
    <div className="space-y-4 h-full flex flex-col">
      <Breadcrumb segments={[createHomeSegment(), { label: 'CloudWatch Logs', icon: ScrollText }]} />
      <div className="grid grid-cols-[300px,1fr,1fr] gap-4 flex-1 min-h-0">
      {/* Log Groups Panel */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Log Groups</CardTitle>
            <Badge variant="secondary" className="ml-auto">
              {filteredGroups.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search log groups..."
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              className="h-8 text-sm pl-8"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {groupsLoading && (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </>
            )}
            {!groupsLoading && filteredGroups.length === 0 && (
              <EmptyState
                icon={ScrollText}
                title="No log groups"
                description="No log groups found"
              />
            )}
            {!groupsLoading &&
              filteredGroups.map((group) => (
                <Card
                  key={group.name}
                  className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                    selectedGroup === group.name ? 'border-primary bg-muted' : ''
                  }`}
                  onClick={() => setSelectedGroup(group.name)}
                >
                  <CardContent className="p-3">
                    <div className="text-sm font-medium truncate" title={group.name}>
                      {group.name}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{formatBytes(group.stored_bytes)}</span>
                      {group.retention_days && (
                        <>
                          <Separator orientation="vertical" className="h-3" />
                          <span>{group.retention_days}d retention</span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Log Streams Panel */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Log Streams</CardTitle>
            {selectedGroup && (
              <Badge variant="secondary" className="ml-auto">
                {filteredStreams.length}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
          {!selectedGroup && (
            <EmptyState
              icon={FileText}
              title="No log group selected"
              description="Select a log group to view streams"
            />
          )}
          {selectedGroup && (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search streams..."
                  value={streamSearch}
                  onChange={(e) => setStreamSearch(e.target.value)}
                  className="h-8 text-sm pl-8"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {streamsLoading && (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                )}
                {!streamsLoading && filteredStreams.length === 0 && (
                  <EmptyState
                    icon={FileText}
                    title="No log streams"
                    description="No log streams found in this group"
                  />
                )}
                {!streamsLoading && filteredStreams.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stream Name</TableHead>
                        <TableHead>Last Event</TableHead>
                        <TableHead>Size</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStreams.map((stream) => (
                        <TableRow
                          key={stream.name}
                          className={`cursor-pointer ${
                            selectedStream === stream.name ? 'bg-muted' : ''
                          }`}
                          onClick={() => setSelectedStream(stream.name)}
                        >
                          <TableCell className="font-mono text-xs truncate max-w-[200px]" title={stream.name}>
                            {stream.name}
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatRelativeTime(stream.last_event_time)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatBytes(stream.stored_bytes)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Log Events Panel */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Log Events</CardTitle>
            {tailMode && (
              <Badge variant="default" className="ml-auto animate-pulse">
                Live
              </Badge>
            )}
            {!tailMode && events.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {events.length}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
          {!selectedStream && (
            <EmptyState
              icon={Clock}
              title="No log stream selected"
              description="Select a log stream to view events"
            />
          )}
          {selectedStream && (
            <>
              {/* Controls */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setShowFilters(!showFilters)}
                  >
                    <Filter className="h-3.5 w-3.5 mr-1.5" />
                    Filters
                    {showFilters ? (
                      <ChevronUp className="h-3.5 w-3.5 ml-1.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                    )}
                  </Button>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-muted-foreground">Tail mode</span>
                    <Switch checked={tailMode} onCheckedChange={setTailMode} />
                    {tailMode ? (
                      <Pause className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Play className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {showFilters && (
                  <div className="space-y-2 p-3 border rounded-md bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Filter pattern (CloudWatch syntax)"
                        value={filterPattern}
                        onChange={(e) => setFilterPattern(e.target.value)}
                        className="h-8 text-sm flex-1"
                      />
                      <Button size="sm" className="h-8" onClick={applyFilter}>
                        Apply
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Quick range:</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setRelativeTimeRange(1)}
                      >
                        1h
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setRelativeTimeRange(6)}
                      >
                        6h
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setRelativeTimeRange(24)}
                      >
                        24h
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={clearTimeRange}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Events List */}
              <div
                id="log-events-container"
                className="flex-1 overflow-y-auto border rounded-md bg-muted/20"
              >
                {eventsLoading && events.length === 0 && (
                  <div className="p-4 space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                )}
                {!eventsLoading && events.length === 0 && (
                  <EmptyState
                    icon={Clock}
                    title="No log events"
                    description="No events found for this stream"
                  />
                )}
                {events.length > 0 && (
                  <div>
                    {events.map((event, idx) => (
                      <LogEventView key={`${event.timestamp_millis}-${idx}`} event={event} />
                    ))}
                    {eventsNextToken && !tailMode && (
                      <div className="p-4 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => loadEvents(true, eventsNextToken)}
                          disabled={eventsLoading}
                        >
                          {eventsLoading ? 'Loading...' : 'Load More'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
