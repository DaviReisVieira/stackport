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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/EmptyState'
import { JsonViewer } from '@/components/JsonViewer'
import { toast } from 'sonner'
import {
  Search,
  Play,
  StopCircle,
  RefreshCw,
  ChevronLeft,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Server,
} from 'lucide-react'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function calculateDuration(startDate: string, stopDate?: string): string {
  const start = new Date(startDate).getTime()
  const end = stopDate ? new Date(stopDate).getTime() : Date.now()
  const durationMs = end - start
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    RUNNING: { icon: Loader2, className: 'bg-blue-500/10 text-blue-500', label: 'Running', iconClass: 'animate-spin' },
    SUCCEEDED: { icon: CheckCircle2, className: 'bg-green-500/10 text-green-500', label: 'Succeeded', iconClass: '' },
    FAILED: { icon: XCircle, className: 'bg-red-500/10 text-red-500', label: 'Failed', iconClass: '' },
    TIMED_OUT: { icon: Clock, className: 'bg-yellow-500/10 text-yellow-500', label: 'Timed Out', iconClass: '' },
    ABORTED: { icon: AlertCircle, className: 'bg-gray-500/10 text-gray-500', label: 'Aborted', iconClass: '' },
  }[status] || { icon: AlertCircle, className: 'bg-gray-500/10 text-gray-500', label: status, iconClass: '' }

  const Icon = config.icon
  return (
    <Badge variant="outline" className={config.className}>
      <Icon className={`h-3 w-3 mr-1 ${config.iconClass}`} />
      {config.label}
    </Badge>
  )
}

function TypeBadge({ type }: { type: string }) {
  const isExpress = type === 'EXPRESS'
  return (
    <Badge variant="outline" className={isExpress ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}>
      {type}
    </Badge>
  )
}

export function StepFunctionsBrowser() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedArn = searchParams.get('arn')
  const { activeEndpoint } = useEndpoint()
  const [searchTerm, setSearchTerm] = useState('')

  const [stateMachines, setStateMachines] = useState<StepFunctionsStateMachine[]>([])
  const [loadingMachines, setLoadingMachines] = useState(true)
  const [selectedMachine, setSelectedMachine] = useState<StepFunctionsStateMachineDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const loadStateMachines = useCallback(async () => {
    setLoadingMachines(true)
    try {
      const data = await fetchStepFunctionsStateMachines(activeEndpoint)
      setStateMachines(data.stateMachines)
    } catch (err) {
      toast.error(`Failed to load state machines: ${err}`)
    } finally {
      setLoadingMachines(false)
    }
  }, [activeEndpoint])

  useEffect(() => {
    loadStateMachines()
  }, [loadStateMachines])

  const loadMachineDetail = useCallback(
    async (arn: string) => {
      setLoadingDetail(true)
      try {
        const detail = await fetchStepFunctionsStateMachineDetail(arn, activeEndpoint)
        setSelectedMachine(detail)
      } catch (err) {
        toast.error(`Failed to load state machine detail: ${err}`)
      } finally {
        setLoadingDetail(false)
      }
    },
    [activeEndpoint]
  )

  useEffect(() => {
    if (selectedArn) {
      loadMachineDetail(selectedArn)
    } else {
      setSelectedMachine(null)
    }
  }, [selectedArn, loadMachineDetail])

  const handleSelectMachine = (arn: string) => {
    setSearchParams({ arn })
  }

  const handleBack = () => {
    setSearchParams({})
  }

  const filteredMachines = stateMachines.filter((machine) =>
    machine.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (selectedMachine) {
    return (
      <div className="flex flex-col h-full">
        <Breadcrumb
          segments={[
            createHomeSegment(),
            { label: 'Step Functions', href: '/resources?service=stepfunctions' },
            { label: selectedMachine.name },
          ]}
        />
        <StateMachineDetail
          machine={selectedMachine}
          loading={loadingDetail}
          onBack={handleBack}
          onRefresh={() => loadMachineDetail(selectedMachine.stateMachineArn)}
          endpoint={activeEndpoint}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb
        segments={[
          createHomeSegment(),
          { label: 'Step Functions', href: '/resources?service=stepfunctions' },
        ]}
      />

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <CardTitle>State Machines</CardTitle>
              <Badge variant="outline">{stateMachines.length}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search state machines..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
              <Button variant="outline" size="icon" onClick={loadStateMachines}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-auto">
          {loadingMachines ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredMachines.length === 0 ? (
            <EmptyState
              title="No state machines found"
              description={searchTerm ? 'Try adjusting your search' : 'No Step Functions state machines exist'}
              icon={Server}
            />
          ) : (
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
                {filteredMachines.map((machine) => (
                  <TableRow
                    key={machine.stateMachineArn}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => handleSelectMachine(machine.stateMachineArn)}
                  >
                    <TableCell className="font-medium">{machine.name}</TableCell>
                    <TableCell>
                      <TypeBadge type={machine.type} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{machine.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(machine.creationDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface StateMachineDetailProps {
  machine: StepFunctionsStateMachineDetail
  loading: boolean
  onBack: () => void
  onRefresh: () => void
  endpoint: string | null
}

function StateMachineDetail({ machine, loading, onBack, onRefresh, endpoint }: StateMachineDetailProps) {
  return (
    <Card className="flex-1 flex flex-col overflow-hidden">
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle>{machine.name}</CardTitle>
            <TypeBadge type={machine.type} />
            <Badge variant="outline">{machine.status}</Badge>
          </div>
          <Button variant="outline" size="icon" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto">
        <Tabs defaultValue="executions" className="h-full flex flex-col">
          <TabsList>
            <TabsTrigger value="executions">Executions</TabsTrigger>
            <TabsTrigger value="definition">Definition</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          <TabsContent value="executions" className="flex-1 overflow-auto mt-4">
            <ExecutionsTab stateMachineArn={machine.stateMachineArn} endpoint={endpoint} />
          </TabsContent>

          <TabsContent value="definition" className="flex-1 overflow-auto mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Amazon States Language (ASL) Definition</CardTitle>
              </CardHeader>
              <CardContent>
                <JsonViewer data={machine.definition} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="flex-1 overflow-auto mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-[120px_1fr] gap-2">
                  <span className="text-muted-foreground">ARN</span>
                  <span className="font-mono text-xs break-all">{machine.stateMachineArn}</span>
                </div>
                <Separator />
                <div className="grid grid-cols-[120px_1fr] gap-2">
                  <span className="text-muted-foreground">Role ARN</span>
                  <span className="font-mono text-xs break-all">{machine.roleArn}</span>
                </div>
                <Separator />
                <div className="grid grid-cols-[120px_1fr] gap-2">
                  <span className="text-muted-foreground">Type</span>
                  <TypeBadge type={machine.type} />
                </div>
                <Separator />
                <div className="grid grid-cols-[120px_1fr] gap-2">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDate(machine.creationDate)}</span>
                </div>
                {machine.loggingConfiguration && (
                  <>
                    <Separator />
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-muted-foreground">Logging</span>
                      <div className="space-y-1">
                        <div>Level: {machine.loggingConfiguration.level || 'OFF'}</div>
                        {machine.loggingConfiguration.includeExecutionData && (
                          <div className="text-xs text-muted-foreground">Includes execution data</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

interface ExecutionsTabProps {
  stateMachineArn: string
  endpoint: string | null
}

function ExecutionsTab({ stateMachineArn, endpoint }: ExecutionsTabProps) {
  const [executions, setExecutions] = useState<StepFunctionsExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null)
  const [startDialogOpen, setStartDialogOpen] = useState(false)

  const loadExecutions = useCallback(async () => {
    setLoading(true)
    try {
      const filter = statusFilter === 'ALL' ? undefined : statusFilter
      const data = await fetchStepFunctionsExecutions(stateMachineArn, filter, 50, endpoint)
      setExecutions(data.executions)
    } catch (err) {
      toast.error(`Failed to load executions: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [stateMachineArn, statusFilter, endpoint])

  useEffect(() => {
    loadExecutions()
  }, [loadExecutions])

  const handleStartExecution = () => {
    setStartDialogOpen(true)
  }

  const handleExecutionStarted = () => {
    setStartDialogOpen(false)
    loadExecutions()
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
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
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadExecutions}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button size="sm" onClick={handleStartExecution}>
              <Play className="h-4 w-4 mr-2" />
              Start Execution
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : executions.length === 0 ? (
          <EmptyState
            title="No executions found"
            description={statusFilter === 'ALL' ? 'Start a new execution to see it here' : 'No executions with this status'}
            icon={Play}
          />
        ) : (
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
              {executions.map((execution) => (
                <TableRow
                  key={execution.executionArn}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => setSelectedExecution(execution.executionArn)}
                >
                  <TableCell className="font-medium">{execution.name}</TableCell>
                  <TableCell>
                    <StatusBadge status={execution.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(execution.startDate)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {calculateDuration(execution.startDate, execution.stopDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <StartExecutionDialog
        open={startDialogOpen}
        onClose={() => setStartDialogOpen(false)}
        stateMachineArn={stateMachineArn}
        endpoint={endpoint}
        onSuccess={handleExecutionStarted}
      />

      {selectedExecution && (
        <ExecutionDetailSheet
          executionArn={selectedExecution}
          endpoint={endpoint}
          onClose={() => setSelectedExecution(null)}
          onExecutionStopped={loadExecutions}
        />
      )}
    </>
  )
}

interface StartExecutionDialogProps {
  open: boolean
  onClose: () => void
  stateMachineArn: string
  endpoint: string | null
  onSuccess: () => void
}

function StartExecutionDialog({ open, onClose, stateMachineArn, endpoint, onSuccess }: StartExecutionDialogProps) {
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
      await startStepFunctionsExecution(
        stateMachineArn,
        { name: name || undefined, input: parsedInput },
        endpoint
      )
      toast.success('Execution started')
      onSuccess()
    } catch (err) {
      toast.error(`Failed to start execution: ${err}`)
    } finally {
      setStarting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start Execution</DialogTitle>
          <DialogDescription>Start a new execution of this state machine</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="execution-name">Execution Name (optional)</Label>
            <Input
              id="execution-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated if empty"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="execution-input">Input JSON</Label>
            <Textarea
              id="execution-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='{"key": "value"}'
              className="font-mono text-xs min-h-[200px] mt-1"
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={starting}>
            {starting ? 'Starting...' : 'Start Execution'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ExecutionDetailSheetProps {
  executionArn: string
  endpoint: string | null
  onClose: () => void
  onExecutionStopped: () => void
}

function ExecutionDetailSheet({ executionArn, endpoint, onClose, onExecutionStopped }: ExecutionDetailSheetProps) {
  const [execution, setExecution] = useState<StepFunctionsExecutionDetail | null>(null)
  const [history, setHistory] = useState<StepFunctionsHistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [stopping, setStopping] = useState(false)

  const loadExecution = useCallback(async () => {
    setLoading(true)
    try {
      const [detailData, historyData] = await Promise.all([
        fetchStepFunctionsExecutionDetail(executionArn, endpoint),
        fetchStepFunctionsExecutionHistory(executionArn, 100, false, endpoint),
      ])
      setExecution(detailData)
      setHistory(historyData.events)
    } catch (err) {
      toast.error(`Failed to load execution detail: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [executionArn, endpoint])

  useEffect(() => {
    loadExecution()
  }, [loadExecution])

  const handleStopExecution = async () => {
    if (!execution) return
    setStopping(true)
    try {
      await stopStepFunctionsExecution(executionArn, { error: 'UserInitiated', cause: 'Stopped by user' }, endpoint)
      toast.success('Execution stopped')
      onExecutionStopped()
      onClose()
    } catch (err) {
      toast.error(`Failed to stop execution: ${err}`)
    } finally {
      setStopping(false)
    }
  }

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {execution?.name || 'Execution'}
            {execution && <StatusBadge status={execution.status} />}
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : execution ? (
          <div className="mt-6">
            <Tabs defaultValue="overview">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">Status</CardTitle>
                    {execution.status === 'RUNNING' && (
                      <Button variant="destructive" size="sm" onClick={handleStopExecution} disabled={stopping}>
                        <StopCircle className="h-4 w-4 mr-2" />
                        {stopping ? 'Stopping...' : 'Stop Execution'}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-muted-foreground">Status</span>
                      <StatusBadge status={execution.status} />
                    </div>
                    <Separator />
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-muted-foreground">Started</span>
                      <span>{formatDate(execution.startDate)}</span>
                    </div>
                    {execution.stopDate && (
                      <>
                        <Separator />
                        <div className="grid grid-cols-[100px_1fr] gap-2">
                          <span className="text-muted-foreground">Stopped</span>
                          <span>{formatDate(execution.stopDate)}</span>
                        </div>
                      </>
                    )}
                    <Separator />
                    <div className="grid grid-cols-[100px_1fr] gap-2">
                      <span className="text-muted-foreground">Duration</span>
                      <span>{calculateDuration(execution.startDate, execution.stopDate)}</span>
                    </div>
                    {execution.error && (
                      <>
                        <Separator />
                        <div className="grid grid-cols-[100px_1fr] gap-2">
                          <span className="text-muted-foreground">Error</span>
                          <span className="text-destructive">{execution.error}</span>
                        </div>
                      </>
                    )}
                    {execution.cause && (
                      <>
                        <Separator />
                        <div className="grid grid-cols-[100px_1fr] gap-2">
                          <span className="text-muted-foreground">Cause</span>
                          <span className="text-destructive text-xs">{execution.cause}</span>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Input</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <JsonViewer data={execution.input} />
                  </CardContent>
                </Card>

                {execution.output && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Output</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <JsonViewer data={execution.output} />
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="history" className="space-y-2">
                {history.length === 0 ? (
                  <EmptyState title="No history events" description="Execution history is empty" icon={Clock} />
                ) : (
                  <div className="space-y-2">
                    {history.map((event) => (
                      <Card key={event.id}>
                        <CardHeader className="py-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {event.id}
                              </Badge>
                              <span className="text-sm font-medium">{event.type}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{formatDate(event.timestamp)}</span>
                          </div>
                        </CardHeader>
                        {Object.keys(event).filter(k => k !== 'id' && k !== 'type' && k !== 'timestamp' && k !== 'previousEventId').length > 0 && (
                          <CardContent className="py-2 pt-0">
                            <JsonViewer data={event} />
                          </CardContent>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="raw">
                <Card>
                  <CardContent className="pt-6">
                    <JsonViewer data={execution} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
