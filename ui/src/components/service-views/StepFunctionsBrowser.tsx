import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchStepFunctionsStateMachines,
  fetchStepFunctionsStateMachineDetail,
  fetchStepFunctionsExecutions,
  startStepFunctionsExecution,
  fetchStepFunctionsExecutionDetail,
  fetchStepFunctionsExecutionHistory,
  stopStepFunctionsExecution,
} from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import type {
  StepFunctionsStateMachine,
  StepFunctionsStateMachineDetail,
  StepFunctionsExecution,
  StepFunctionsExecutionDetail,
  StepFunctionsHistoryEvent,
} from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { JsonViewer } from '@/components/JsonViewer'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  Workflow,
  Search,
  Play,
  StopCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function calculateDuration(startDate: string, stopDate?: string): string {
  const start = new Date(startDate).getTime()
  const end = stopDate ? new Date(stopDate).getTime() : Date.now()
  const ms = end - start
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'RUNNING':
      return (
        <Badge variant="secondary" className="bg-blue-500 text-white">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />Running
        </Badge>
      )
    case 'SUCCEEDED':
      return (
        <Badge variant="secondary" className="bg-green-500 text-white">
          <CheckCircle2 className="h-3 w-3 mr-1" />Succeeded
        </Badge>
      )
    case 'FAILED':
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />Failed
        </Badge>
      )
    case 'TIMED_OUT':
      return (
        <Badge variant="secondary" className="bg-yellow-500 text-white">
          <Clock className="h-3 w-3 mr-1" />Timed Out
        </Badge>
      )
    case 'ABORTED':
      return (
        <Badge variant="outline">
          <AlertCircle className="h-3 w-3 mr-1" />Aborted
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={type === 'EXPRESS' ? 'secondary' : 'outline'} className={type === 'EXPRESS' ? 'bg-purple-500 text-white' : ''}>
      {type}
    </Badge>
  )
}

function PaginationBar({
  page, totalPages, totalItems, pageSize, onPageChange, onPageSizeChange,
}: {
  page: number; totalPages: number; totalItems: number; pageSize: number
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void
}) {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, totalItems)
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{start}–{end} of {totalItems}</span>
        <Separator orientation="vertical" className="h-4" />
        <span>Rows:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// --- Start Execution Sheet ---

function StartExecutionSheet({
  stateMachineArn, open, onOpenChange, onSuccess,
}: {
  stateMachineArn: string; open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [input, setInput] = useState('{}')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStart = async () => {
    setError(null)
    let parsedInput
    try {
      parsedInput = JSON.parse(input)
    } catch {
      setError('Input must be valid JSON')
      return
    }

    setStarting(true)
    try {
      await startStepFunctionsExecution(stateMachineArn, { name: name || undefined, input: parsedInput }, activeEndpoint)
      toast.success('Execution started')
      setName('')
      setInput('{}')
      onSuccess()
    } catch (err) {
      toast.error(`Failed to start execution: ${err}`)
    } finally {
      setStarting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Start Execution
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Execution Name (optional)</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated if empty"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Input (JSON)</label>
            <Textarea
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(null) }}
              placeholder='{"key": "value"}'
              className="font-mono text-xs h-64"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button onClick={handleStart} disabled={starting} className="w-full">
            <Play className="h-4 w-4 mr-2" />
            {starting ? 'Starting...' : 'Start Execution'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// --- Execution Detail Sheet ---

function ExecutionDetailSheet({
  executionArn, open, onOpenChange, onStopped,
}: {
  executionArn: string; open: boolean; onOpenChange: (open: boolean) => void; onStopped: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [execution, setExecution] = useState<StepFunctionsExecutionDetail | null>(null)
  const [history, setHistory] = useState<StepFunctionsHistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    if (!executionArn) return
    setLoading(true)
    Promise.all([
      fetchStepFunctionsExecutionDetail(executionArn, activeEndpoint),
      fetchStepFunctionsExecutionHistory(executionArn, 100, false, activeEndpoint),
    ])
      .then(([detail, historyData]) => {
        setExecution(detail)
        setHistory(historyData.events)
      })
      .catch((err) => toast.error(`Failed to load execution: ${err}`))
      .finally(() => setLoading(false))
  }, [executionArn, activeEndpoint])

  const handleStop = async () => {
    setStopping(true)
    try {
      await stopStepFunctionsExecution(executionArn, { error: 'UserInitiated', cause: 'Stopped by user' }, activeEndpoint)
      toast.success('Execution stopped')
      onStopped()
      onOpenChange(false)
    } catch (err) {
      toast.error(`Failed to stop execution: ${err}`)
    } finally {
      setStopping(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {execution?.name || 'Execution Detail'}
            {execution && <StatusBadge status={execution.status} />}
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 py-6">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : execution ? (
          <div className="py-4">
            <Tabs defaultValue="overview">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="history">History ({history.length})</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm">Execution Info</CardTitle>
                    {execution.status === 'RUNNING' && (
                      <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopping}>
                        <StopCircle className="h-3.5 w-3.5 mr-1.5" />
                        {stopping ? 'Stopping...' : 'Stop'}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <div className="text-muted-foreground">Status</div>
                      <div><StatusBadge status={execution.status} /></div>
                      <div className="text-muted-foreground">Started</div>
                      <div>{formatDate(execution.startDate)}</div>
                      {execution.stopDate && (
                        <>
                          <div className="text-muted-foreground">Stopped</div>
                          <div>{formatDate(execution.stopDate)}</div>
                        </>
                      )}
                      <div className="text-muted-foreground">Duration</div>
                      <div>{calculateDuration(execution.startDate, execution.stopDate)}</div>
                      {execution.error && (
                        <>
                          <div className="text-muted-foreground">Error</div>
                          <div className="text-destructive font-mono text-xs">{execution.error}</div>
                        </>
                      )}
                      {execution.cause && (
                        <>
                          <div className="text-muted-foreground">Cause</div>
                          <div className="text-destructive text-xs">{execution.cause}</div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Input</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border p-3 bg-muted/50">
                      <JsonViewer data={execution.input} />
                    </div>
                  </CardContent>
                </Card>

                {execution.output && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Output</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border p-3 bg-muted/50">
                        <JsonViewer data={execution.output} />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                {history.length === 0 ? (
                  <EmptyState icon={Clock} title="No History Events" description="No events recorded for this execution." />
                ) : (
                  <div className="space-y-2">
                    {history.map((event) => {
                      const detailKeys = Object.keys(event).filter(
                        (k) => !['id', 'type', 'timestamp', 'previousEventId'].includes(k)
                      )
                      return (
                        <div key={event.id} className="flex gap-3 text-sm border-b last:border-0 py-2">
                          <div className="flex-shrink-0 w-8 text-xs text-muted-foreground font-mono text-right">
                            #{event.id}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate">{event.type}</span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(event.timestamp)}</span>
                            </div>
                            {detailKeys.length > 0 && (
                              <div className="mt-1 rounded border p-2 bg-muted/50">
                                <pre className="text-xs font-mono overflow-auto whitespace-pre-wrap text-muted-foreground">
                                  {JSON.stringify(
                                    Object.fromEntries(detailKeys.map((k) => [k, event[k]])),
                                    null, 2
                                  )}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <div className="rounded-md border p-3 bg-muted/50">
                  <JsonViewer data={execution} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

// --- Main Component ---

export function StepFunctionsBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()

  const machinesFetcher = useCallback(() => fetchStepFunctionsStateMachines(activeEndpoint), [activeEndpoint])
  const { data: machinesData, loading: machinesLoading, refresh: refreshMachines } = useFetch<{ stateMachines: StepFunctionsStateMachine[] }>(
    machinesFetcher, 10000
  )

  const selectedMachineArn = searchParams.get('machine')
  const setSelectedMachine = (arn: string | null) => {
    if (arn === null) {
      setSearchParams({})
    } else {
      setSearchParams({ machine: arn })
    }
  }

  const [machineDetail, setMachineDetail] = useState<StepFunctionsStateMachineDetail | null>(null)
  const [executions, setExecutions] = useState<StepFunctionsExecution[]>([])
  const [executionsLoading, setExecutionsLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [refreshing, setRefreshing] = useState(false)
  const [startSheetOpen, setStartSheetOpen] = useState(false)
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null)

  const refreshDetail = useCallback(() => {
    if (!selectedMachineArn) return
    Promise.all([
      fetchStepFunctionsStateMachineDetail(selectedMachineArn, activeEndpoint),
      fetchStepFunctionsExecutions(selectedMachineArn, statusFilter === 'ALL' ? undefined : statusFilter, 100, activeEndpoint),
    ])
      .then(([detail, execData]) => {
        setMachineDetail(detail)
        setExecutions(execData.executions)
      })
      .catch((err) => toast.error(`Failed to load state machine: ${err}`))
  }, [selectedMachineArn, activeEndpoint, statusFilter])

  const refreshExecutions = useCallback(() => {
    if (!selectedMachineArn) return
    setExecutionsLoading(true)
    fetchStepFunctionsExecutions(selectedMachineArn, statusFilter === 'ALL' ? undefined : statusFilter, 100, activeEndpoint)
      .then((data) => setExecutions(data.executions))
      .catch((err) => toast.error(`Failed to load executions: ${err}`))
      .finally(() => setExecutionsLoading(false))
  }, [selectedMachineArn, activeEndpoint, statusFilter])

  useEffect(() => {
    if (!selectedMachineArn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMachineDetail(null)
      setExecutions([])
      return
    }
    refreshDetail()
  }, [selectedMachineArn, refreshDetail])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedMachineArn) refreshExecutions()
  }, [statusFilter, refreshExecutions, selectedMachineArn])

  const machines = machinesData?.stateMachines ?? []
  const filteredMachines = machines.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
  const totalPages = Math.max(1, Math.ceil(filteredMachines.length / pageSize))
  const paginatedMachines = filteredMachines.slice(page * pageSize, (page + 1) * pageSize)

  // --- Loading state ---
  if (machinesLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    )
  }

  // --- Empty state ---
  if (!machinesData || machines.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No State Machines"
        description="No Step Functions state machines found in this environment."
      />
    )
  }

  // --- Detail View ---
  if (selectedMachineArn && machineDetail) {
    return (
      <div className="space-y-6 p-6">
        <Breadcrumb segments={[
          createHomeSegment(),
          { label: 'Step Functions', href: '/resources?service=stepfunctions', icon: getServiceIcon('stepfunctions') },
          { label: machineDetail.name },
        ]} />

        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <Workflow className="h-6 w-6" />
              {machineDetail.name}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 font-mono">{machineDetail.stateMachineArn}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setStartSheetOpen(true)}>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Start Execution
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TypeBadge type={machineDetail.type} />
          <Badge variant="outline">{machineDetail.status}</Badge>
        </div>

        <Tabs defaultValue="executions" className="w-full">
          <TabsList>
            <TabsTrigger value="executions">Executions</TabsTrigger>
            <TabsTrigger value="definition">Definition</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          <TabsContent value="executions" className="space-y-4">
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0) }}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="RUNNING">Running</SelectItem>
                  <SelectItem value="SUCCEEDED">Succeeded</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="TIMED_OUT">Timed Out</SelectItem>
                  <SelectItem value="ABORTED">Aborted</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="outline">{executions.length}</Badge>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={refreshExecutions}
                title="Refresh executions"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${executionsLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {executions.length === 0 ? (
              <EmptyState
                icon={Play}
                title="No Executions"
                description={statusFilter === 'ALL' ? 'Start a new execution to see it here.' : `No executions with status "${statusFilter}".`}
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executions.map((exec) => (
                        <TableRow
                          key={exec.executionArn}
                          className="cursor-pointer hover:bg-accent/50"
                          onClick={() => setSelectedExecution(exec.executionArn)}
                        >
                          <TableCell className="font-mono text-xs">{exec.name}</TableCell>
                          <TableCell><StatusBadge status={exec.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(exec.startDate)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {calculateDuration(exec.startDate, exec.stopDate)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="definition" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Amazon States Language (ASL)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border p-3 bg-muted/50">
                  <JsonViewer data={machineDetail.definition} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="text-muted-foreground">ARN</div>
                  <div className="font-mono text-xs break-all">{machineDetail.stateMachineArn}</div>
                  <div className="text-muted-foreground">Type</div>
                  <div><TypeBadge type={machineDetail.type} /></div>
                  <div className="text-muted-foreground">Status</div>
                  <div>{machineDetail.status}</div>
                  <div className="text-muted-foreground">Role ARN</div>
                  <div className="font-mono text-xs break-all">{machineDetail.roleArn}</div>
                  <div className="text-muted-foreground">Created</div>
                  <div>{formatDate(machineDetail.creationDate)}</div>
                </div>
              </CardContent>
            </Card>

            {machineDetail.loggingConfiguration && machineDetail.loggingConfiguration.level !== 'OFF' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Logging</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-muted-foreground">Level</div>
                    <div>{machineDetail.loggingConfiguration.level || 'OFF'}</div>
                    <div className="text-muted-foreground">Include Execution Data</div>
                    <div>{machineDetail.loggingConfiguration.includeExecutionData ? 'Yes' : 'No'}</div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <StartExecutionSheet
          stateMachineArn={selectedMachineArn}
          open={startSheetOpen}
          onOpenChange={setStartSheetOpen}
          onSuccess={() => { setStartSheetOpen(false); refreshExecutions() }}
        />

        {selectedExecution && (
          <ExecutionDetailSheet
            executionArn={selectedExecution}
            open={true}
            onOpenChange={() => setSelectedExecution(null)}
            onStopped={refreshExecutions}
          />
        )}
      </div>
    )
  }

  // --- List View ---
  return (
    <div className="space-y-6 p-6">
      <Breadcrumb segments={[createHomeSegment(), { label: 'Step Functions', icon: getServiceIcon('stepfunctions') }]} />
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search state machines..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            className="pl-9"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={async () => { setRefreshing(true); await refreshMachines(); setRefreshing(false) }}
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedMachines.map((machine) => (
                <TableRow
                  key={machine.stateMachineArn}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setSelectedMachine(machine.stateMachineArn)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{machine.name}</span>
                    </div>
                  </TableCell>
                  <TableCell><TypeBadge type={machine.type} /></TableCell>
                  <TableCell><Badge variant="outline">{machine.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(machine.creationDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={filteredMachines.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(0) }}
        />
      )}
    </div>
  )
}
