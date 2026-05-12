import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
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
  PanelLeftClose,
  PanelRightClose,
  Copy,
  Check,
} from 'lucide-react'
import {
  StatusBadge,
  TypeBadge,
  PaginationBar,
  formatDate,
  calculateDuration,
  buildExecutionTrace,
} from './stepfunctions'
import { ExecutionTimeline } from './stepfunctions/ExecutionTimeline'

const StateMachineGraph = lazy(() => import('./stepfunctions/StateMachineGraph'))

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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-generated if empty" />
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
  executionArn, open, onOpenChange, onStopped, definition,
}: {
  executionArn: string; open: boolean; onOpenChange: (open: boolean) => void
  onStopped: () => void; definition?: Record<string, unknown> | string
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

  const trace = history.length > 0 ? buildExecutionTrace(history) : undefined

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
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                {/* Status + Stop button */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm">Execution</CardTitle>
                    {execution.status === 'RUNNING' && (
                      <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopping}>
                        <StopCircle className="h-3.5 w-3.5 mr-1.5" />
                        {stopping ? 'Stopping...' : 'Stop'}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
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
                    </div>
                  </CardContent>
                </Card>

                {/* Mini graph with trace */}
                {definition && (
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Execution Path</CardTitle></CardHeader>
                    <CardContent>
                      <Suspense fallback={<Skeleton className="h-[250px]" />}>
                        <StateMachineGraph definition={definition} trace={trace} />
                      </Suspense>
                    </CardContent>
                  </Card>
                )}

                {/* Input/Output */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader><CardTitle className="text-sm">Input</CardTitle></CardHeader>
                    <CardContent>
                      <div className="rounded-md border p-2 bg-muted/50 max-h-[200px] overflow-auto">
                        <JsonViewer data={execution.input} />
                      </div>
                    </CardContent>
                  </Card>
                  {execution.output && (
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Output</CardTitle></CardHeader>
                      <CardContent>
                        <div className="rounded-md border p-2 bg-muted/50 max-h-[200px] overflow-auto">
                          <JsonViewer data={execution.output} />
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="timeline" className="mt-4">
                <ExecutionTimeline events={history} executionStartTime={execution.startDate} />
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
    if (arn === null) setSearchParams({})
    else setSearchParams({ machine: arn })
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
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      </div>
    )
  }

  // --- Empty state ---
  if (!machinesData || machines.length === 0) {
    return <EmptyState icon={Workflow} title="No State Machines" description="No Step Functions state machines found in this environment." />
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

          {/* Executions Tab */}
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
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refreshExecutions} title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${executionsLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {executions.length === 0 ? (
              <EmptyState icon={Play} title="No Executions" description={statusFilter === 'ALL' ? 'Start a new execution to see it here.' : `No executions with status "${statusFilter}".`} />
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
                          <TableCell className="text-xs text-muted-foreground">{calculateDuration(exec.startDate, exec.stopDate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Definition Tab — Side by Side */}
          <TabsContent value="definition">
            <DefinitionPanel definition={machineDetail.definition} />
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Configuration</CardTitle></CardHeader>
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
                <CardHeader><CardTitle className="text-lg">Logging</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-muted-foreground">Level</div>
                    <div>{machineDetail.loggingConfiguration.level}</div>
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
            definition={machineDetail.definition}
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

// --- Definition Panel (Diagram + JSON side-by-side with collapsible panels and click-to-scroll) ---

function DefinitionPanel({ definition: rawDefinition }: { definition: Record<string, unknown> | string }) {
  const definition: Record<string, unknown> = typeof rawDefinition === 'string' ? JSON.parse(rawDefinition) : rawDefinition
  const [diagramVisible, setDiagramVisible] = useState(true)
  const [jsonVisible, setJsonVisible] = useState(true)
  const [highlightedState, setHighlightedState] = useState<string | null>(null)
  const jsonContainerRef = useRef<HTMLDivElement>(null)

  const handleNodeClick = useCallback((stateName: string) => {
    setHighlightedState(stateName)
    if (!jsonVisible) setJsonVisible(true)
    setTimeout(() => {
      const el = jsonContainerRef.current?.querySelector(`[data-state="${stateName}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setTimeout(() => setHighlightedState(null), 2000)
      }
    }, 50)
  }, [jsonVisible])

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 320px)', minHeight: '500px' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant={diagramVisible ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setDiagramVisible(!diagramVisible)}
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
          Diagram
        </Button>
        <Button
          variant={jsonVisible ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setJsonVisible(!jsonVisible)}
        >
          <PanelRightClose className="h-3.5 w-3.5" />
          JSON
        </Button>
      </div>

      {/* Panels */}
      <div className="flex-1 flex gap-3 min-h-0">
        {diagramVisible && (
          <div className={`flex-1 min-w-0 ${!jsonVisible ? 'w-full' : ''}`}>
            <Card className="h-full flex flex-col">
              <CardContent className="flex-1 p-3 min-h-0">
                <Suspense fallback={<Skeleton className="h-full w-full" />}>
                  <StateMachineGraph definition={definition} onNodeClick={handleNodeClick} />
                </Suspense>
              </CardContent>
            </Card>
          </div>
        )}

        {jsonVisible && (
          <div className={`flex-1 min-w-0 ${!diagramVisible ? 'w-full' : ''}`}>
            <Card className="h-full flex flex-col">
              <CardContent className="flex-1 p-0 min-h-0 overflow-hidden">
                <div ref={jsonContainerRef} className="h-full overflow-auto p-3">
                  <AslJsonViewer definition={definition} highlightedState={highlightedState} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

function AslJsonViewer({ definition, highlightedState }: { definition: Record<string, unknown>; highlightedState: string | null }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(definition, null, 2)
  const states = (definition as { States?: Record<string, unknown> }).States || {}
  const stateNames = Object.keys(states)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lines = json.split('\n')
  const stateLineMap = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    for (const name of stateNames) {
      if (lines[i].includes(`"${name}"`) && lines[i].trim().startsWith(`"${name}"`)) {
        stateLineMap.set(name, i)
        break
      }
    }
  }

  return (
    <div className="relative group">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <pre className="text-xs font-mono leading-relaxed text-muted-foreground whitespace-pre">
        {lines.map((line, i) => {
          const stateName = [...stateLineMap.entries()].find(([, lineIdx]) => lineIdx === i)?.[0]
          const isHighlighted = stateName === highlightedState
          return (
            <span
              key={i}
              data-state={stateName || undefined}
              className={isHighlighted ? 'bg-blue-500/20 block -mx-3 px-3 rounded transition-colors duration-300' : undefined}
            >
              {line}
              {'\n'}
            </span>
          )
        })}
      </pre>
    </div>
  )
}
