import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Grid from '@cloudscape-design/components/grid'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  fetchStepFunctionsExecutionDetail,
  fetchStepFunctionsExecutionHistory,
  fetchStepFunctionsExecutions,
  fetchStepFunctionsStateMachineDetail,
  fetchStepFunctionsStateMachines,
  startStepFunctionsExecution,
  stopStepFunctionsExecution,
} from '@/lib/api'
import type {
  StepFunctionsExecution,
  StepFunctionsExecutionDetail,
  StepFunctionsHistoryEvent,
  StepFunctionsStateMachine,
  StepFunctionsStateMachineDetail,
} from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
// The ASL graph and timeline are framework-agnostic (SVG + dagre); they move
// under cloudscape/ when the legacy UI is removed in the flip (#147).
import { buildExecutionTrace, calculateDuration, formatDate } from './stepfunctions'
import { ExecutionTimeline } from './stepfunctions/ExecutionTimeline'

const StateMachineGraph = lazy(() => import('./stepfunctions/StateMachineGraph'))

const STATUS_OPTIONS = [
  { label: 'All statuses', value: 'ALL' },
  { label: 'Running', value: 'RUNNING' },
  { label: 'Succeeded', value: 'SUCCEEDED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Timed out', value: 'TIMED_OUT' },
  { label: 'Aborted', value: 'ABORTED' },
]

function executionStatusIndicator(status: string) {
  const type: StatusIndicatorProps.Type =
    status === 'SUCCEEDED'
      ? 'success'
      : status === 'FAILED' || status === 'TIMED_OUT'
        ? 'error'
        : status === 'RUNNING'
          ? 'in-progress'
          : status === 'ABORTED'
            ? 'stopped'
            : 'pending'
  return <StatusIndicator type={type}>{status}</StatusIndicator>
}

function typeBadge(type: 'STANDARD' | 'EXPRESS') {
  return <Badge color={type === 'EXPRESS' ? 'blue' : 'grey'}>{type}</Badge>
}

function jsonBlock(data: unknown) {
  return (
    <Box variant="code">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </Box>
  )
}

// --- Start execution ----------------------------------------------------------

function StartExecutionModal({
  stateMachineArn,
  onClose,
  onDone,
}: {
  stateMachineArn: string
  onClose: () => void
  onDone: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [input, setInput] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const submit = async () => {
    setError(null)
    let parsedInput: unknown
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
        { name: name || undefined, input: parsedInput as Record<string, unknown> },
        activeEndpoint,
      )
      toast.success('Execution started')
      onDone()
    } catch (err) {
      toast.error(`Failed to start execution: ${err}`)
    } finally {
      setStarting(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header="Start execution" size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={starting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={starting} data-testid="start-execution-submit">
              Start execution
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Execution name" description="Auto-generated if empty">
            <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="my-execution" />
          </FormField>
          <FormField label="Input (JSON)" errorText={error ?? undefined}>
            <Textarea
              value={input}
              onChange={({ detail }) => {
                setInput(detail.value)
                setError(null)
              }}
              rows={10}
              spellcheck={false}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

// --- Execution detail -----------------------------------------------------------

function ExecutionDetailModal({
  executionArn,
  definition,
  onClose,
  onStopped,
}: {
  executionArn: string
  definition?: Record<string, unknown> | string
  onClose: () => void
  onStopped: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [execution, setExecution] = useState<StepFunctionsExecutionDetail | null>(null)
  const [history, setHistory] = useState<StepFunctionsHistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [detail, historyData] = await Promise.all([
          fetchStepFunctionsExecutionDetail(executionArn, activeEndpoint),
          fetchStepFunctionsExecutionHistory(executionArn, 100, false, activeEndpoint),
        ])
        if (!cancelled) {
          setExecution(detail)
          setHistory(historyData.events)
        }
      } catch (err) {
        toast.error(`Failed to load execution: ${err}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [executionArn, activeEndpoint])

  const handleStop = async () => {
    setStopping(true)
    try {
      await stopStepFunctionsExecution(executionArn, { error: 'UserInitiated', cause: 'Stopped by user' }, activeEndpoint)
      toast.success('Execution stopped')
      onStopped()
      onClose()
    } catch (err) {
      toast.error(`Failed to stop execution: ${err}`)
    } finally {
      setStopping(false)
    }
  }

  const trace = history.length > 0 ? buildExecutionTrace(history) : undefined

  return (
    <Modal visible onDismiss={onClose} header={execution?.name || 'Execution detail'} size="large">
      {loading && <StatusIndicator type="loading">Loading execution</StatusIndicator>}
      {!loading && execution && (
        <Tabs
          tabs={[
            {
              id: 'overview',
              label: 'Overview',
              content: (
                <SpaceBetween size="m">
                  <SpaceBetween direction="horizontal" size="xs">
                    {executionStatusIndicator(execution.status)}
                    {execution.status === 'RUNNING' && (
                      <Button onClick={() => void handleStop()} loading={stopping} data-testid="stop-execution">
                        Stop
                      </Button>
                    )}
                  </SpaceBetween>

                  <ColumnLayout columns={2} variant="text-grid">
                    <div>
                      <Box variant="awsui-key-label">Started</Box>
                      <Box fontSize="body-s">{formatDate(execution.startDate)}</Box>
                    </div>
                    {execution.stopDate && (
                      <div>
                        <Box variant="awsui-key-label">Stopped</Box>
                        <Box fontSize="body-s">{formatDate(execution.stopDate)}</Box>
                      </div>
                    )}
                    <div>
                      <Box variant="awsui-key-label">Duration</Box>
                      <Box fontSize="body-s">{calculateDuration(execution.startDate, execution.stopDate)}</Box>
                    </div>
                    {execution.error && (
                      <div>
                        <Box variant="awsui-key-label">Error</Box>
                        <Box fontSize="body-s" color="text-status-error">
                          {execution.error}
                        </Box>
                      </div>
                    )}
                  </ColumnLayout>

                  {definition && (
                    <>
                      <Header variant="h3">Execution path</Header>
                      <Suspense fallback={<StatusIndicator type="loading">Loading graph</StatusIndicator>}>
                        <StateMachineGraph definition={definition} trace={trace} />
                      </Suspense>
                    </>
                  )}

                  <Header variant="h3">Input</Header>
                  {jsonBlock(execution.input)}
                  {execution.output !== undefined && (
                    <>
                      <Header variant="h3">Output</Header>
                      {jsonBlock(execution.output)}
                    </>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: 'timeline',
              label: 'Timeline',
              content: <ExecutionTimeline events={history} executionStartTime={execution.startDate} />,
            },
            {
              id: 'raw',
              label: 'Raw',
              content: jsonBlock(execution),
            },
          ]}
        />
      )}
    </Modal>
  )
}

// --- Definition panel (diagram + JSON side by side with click-to-scroll) --------

function collectAllStateNames(definition: Record<string, unknown>): string[] {
  const names: string[] = []
  function walk(states: Record<string, unknown> | undefined) {
    if (!states) return
    for (const [name, state] of Object.entries(states)) {
      names.push(name)
      const s = state as Record<string, unknown>
      if (Array.isArray(s.Branches)) {
        for (const branch of s.Branches as Record<string, unknown>[]) {
          walk(branch.States as Record<string, unknown> | undefined)
        }
      }
      const iterator = (s.Iterator || s.ItemProcessor) as Record<string, unknown> | undefined
      if (iterator) walk(iterator.States as Record<string, unknown> | undefined)
    }
  }
  walk(definition.States as Record<string, unknown> | undefined)
  return names
}

function AslJsonViewer({ definition, highlightedState }: { definition: Record<string, unknown>; highlightedState: string | null }) {
  const json = JSON.stringify(definition, null, 2)
  const stateNames = collectAllStateNames(definition)

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
    <div className="relative">
      <Box float="right">
        <Button
          variant="inline-icon"
          iconName="copy"
          ariaLabel="Copy definition"
          onClick={() => {
            navigator.clipboard
              .writeText(json)
              .then(() => toast.success('Definition copied to clipboard'))
              .catch(() => toast.error('Failed to copy definition'))
          }}
        />
      </Box>
      <pre className="overflow-x-auto text-xs leading-relaxed">
        {lines.map((line, i) => {
          const stateName = [...stateLineMap.entries()].find(([, lineIdx]) => lineIdx === i)?.[0]
          const isHighlighted = stateName === highlightedState
          return (
            <span
              key={i}
              data-state={stateName || undefined}
              className={isHighlighted ? 'block rounded bg-blue-500/20 transition-colors duration-300' : undefined}
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

function DefinitionPanel({ definition: rawDefinition }: { definition: Record<string, unknown> | string }) {
  const definition: Record<string, unknown> = typeof rawDefinition === 'string' ? JSON.parse(rawDefinition) : rawDefinition
  const [diagramVisible, setDiagramVisible] = useState(true)
  const [jsonVisible, setJsonVisible] = useState(true)
  const [highlightedState, setHighlightedState] = useState<string | null>(null)
  const jsonContainerRef = useRef<HTMLDivElement>(null)

  const handleNodeClick = useCallback(
    (stateName: string) => {
      setHighlightedState(stateName)
      if (!jsonVisible) setJsonVisible(true)
      setTimeout(() => {
        const el = jsonContainerRef.current?.querySelector(`[data-state="${stateName}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setTimeout(() => setHighlightedState(null), 2000)
        }
      }, 50)
    },
    [jsonVisible],
  )

  const bothVisible = diagramVisible && jsonVisible

  return (
    <SpaceBetween size="s">
      <SpaceBetween direction="horizontal" size="xs">
        <Button variant={diagramVisible ? 'primary' : 'normal'} onClick={() => setDiagramVisible(!diagramVisible)}>
          Diagram
        </Button>
        <Button variant={jsonVisible ? 'primary' : 'normal'} onClick={() => setJsonVisible(!jsonVisible)}>
          JSON
        </Button>
      </SpaceBetween>

      <Grid
        gridDefinition={
          bothVisible ? [{ colspan: { default: 12, m: 6 } }, { colspan: { default: 12, m: 6 } }] : [{ colspan: 12 }]
        }
      >
        {diagramVisible && (
          <Container>
            <div className="min-h-[400px]">
              <Suspense fallback={<StatusIndicator type="loading">Loading graph</StatusIndicator>}>
                <StateMachineGraph definition={definition} onNodeClick={handleNodeClick} />
              </Suspense>
            </div>
          </Container>
        )}
        {jsonVisible && (
          <Container>
            <div ref={jsonContainerRef} className="max-h-[70vh] overflow-auto">
              <AslJsonViewer definition={definition} highlightedState={highlightedState} />
            </div>
          </Container>
        )}
      </Grid>
    </SpaceBetween>
  )
}

// --- State machine detail --------------------------------------------------------

function StateMachineDetail({ arn, onBack }: { arn: string; onBack: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const detailFetcher = useCallback(() => fetchStepFunctionsStateMachineDetail(arn, activeEndpoint), [arn, activeEndpoint])
  const { data: detail, loading: detailLoading, error: detailError, refresh: refreshDetail } = useFetch<StepFunctionsStateMachineDetail>(detailFetcher)

  const [statusFilter, setStatusFilter] = useState('ALL')
  const [executions, setExecutions] = useState<StepFunctionsExecution[]>([])
  const [executionsLoading, setExecutionsLoading] = useState(false)
  const [startModalOpen, setStartModalOpen] = useState(false)
  const [selectedExecution, setSelectedExecution] = useState<string | null>(null)

  const loadExecutions = useCallback(async () => {
    setExecutionsLoading(true)
    try {
      const data = await fetchStepFunctionsExecutions(
        arn,
        statusFilter === 'ALL' ? undefined : statusFilter,
        100,
        activeEndpoint,
      )
      setExecutions(data.executions)
    } catch (err) {
      toast.error(`Failed to load executions: ${err}`)
    } finally {
      setExecutionsLoading(false)
    }
  }, [arn, statusFilter, activeEndpoint])

  useEffect(() => {
    if (arn) void loadExecutions()
  }, [arn, loadExecutions])

  if (detailLoading && !detail) return <StatusIndicator type="loading">Loading state machine</StatusIndicator>
  if (detailError && !detail) {
    return (
      <Alert type="error" header="Could not load state machine" action={<Button onClick={() => refreshDetail()}>Retry</Button>}>
        {detailError}
      </Alert>
    )
  }
  if (!detail) return null

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description={detail.stateMachineArn}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onBack}>Back to state machines</Button>
            <Button variant="primary" onClick={() => setStartModalOpen(true)}>
              Start execution
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween direction="horizontal" size="xs">
          {detail.name}
          {typeBadge(detail.type)}
          <Badge color="grey">{detail.status}</Badge>
        </SpaceBetween>
      </Header>

      <Tabs
        tabs={[
          {
            id: 'executions',
            label: `Executions (${executions.length})`,
            content: (
              <Table
                items={executions}
                trackBy="executionArn"
                loading={executionsLoading && executions.length === 0}
                loadingText="Loading executions"
                variant="borderless"
                header={
                  <Header
                    variant="h3"
                    actions={
                      <SpaceBetween direction="horizontal" size="xs">
                        <Select
                          selectedOption={STATUS_OPTIONS.find((o) => o.value === statusFilter) ?? STATUS_OPTIONS[0]}
                          onChange={({ detail: d }) => setStatusFilter(d.selectedOption.value as string)}
                          options={STATUS_OPTIONS}
                          ariaLabel="Filter by status"
                        />
                        <Button
                          iconName="refresh"
                          onClick={() => void loadExecutions()}
                          loading={executionsLoading}
                          ariaLabel="Refresh executions"
                        />
                      </SpaceBetween>
                    }
                  >
                    Executions
                  </Header>
                }
                empty={
                  <Box textAlign="center" padding="l" color="text-status-inactive">
                    {statusFilter === 'ALL'
                      ? 'Start a new execution to see it here.'
                      : `No executions with status "${statusFilter}".`}
                  </Box>
                }
                columnDefinitions={[
                  {
                    id: 'name',
                    header: 'Name',
                    cell: (e) => (
                      <Link
                        href={`#${e.executionArn}`}
                        onFollow={(event) => {
                          event.preventDefault()
                          setSelectedExecution(e.executionArn)
                        }}
                      >
                        {e.name}
                      </Link>
                    ),
                  },
                  { id: 'status', header: 'Status', cell: (e) => executionStatusIndicator(e.status) },
                  { id: 'started', header: 'Started', cell: (e) => formatDate(e.startDate) },
                  { id: 'duration', header: 'Duration', cell: (e) => calculateDuration(e.startDate, e.stopDate) },
                ]}
              />
            ),
          },
          {
            id: 'definition',
            label: 'Definition',
            content: <DefinitionPanel definition={detail.definition} />,
          },
          {
            id: 'details',
            label: 'Details',
            content: (
              <SpaceBetween size="m">
                <ColumnLayout columns={2} variant="text-grid">
                  <div>
                    <Box variant="awsui-key-label">ARN</Box>
                    <Box fontSize="body-s">{detail.stateMachineArn}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Type</Box>
                    <Box fontSize="body-s">{typeBadge(detail.type)}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Status</Box>
                    <Box fontSize="body-s">{detail.status}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Role ARN</Box>
                    <Box fontSize="body-s">{detail.roleArn}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Created</Box>
                    <Box fontSize="body-s">{formatDate(detail.creationDate)}</Box>
                  </div>
                </ColumnLayout>
                {detail.loggingConfiguration && detail.loggingConfiguration.level !== 'OFF' && (
                  <>
                    <Header variant="h3">Logging</Header>
                    <ColumnLayout columns={2} variant="text-grid">
                      <div>
                        <Box variant="awsui-key-label">Level</Box>
                        <Box fontSize="body-s">{detail.loggingConfiguration.level}</Box>
                      </div>
                      <div>
                        <Box variant="awsui-key-label">Include execution data</Box>
                        <Box fontSize="body-s">{detail.loggingConfiguration.includeExecutionData ? 'Yes' : 'No'}</Box>
                      </div>
                    </ColumnLayout>
                  </>
                )}
              </SpaceBetween>
            ),
          },
        ]}
      />

      {startModalOpen && (
        <StartExecutionModal
          stateMachineArn={arn}
          onClose={() => setStartModalOpen(false)}
          onDone={() => {
            setStartModalOpen(false)
            void loadExecutions()
          }}
        />
      )}
      {selectedExecution && (
        <ExecutionDetailModal
          executionArn={selectedExecution}
          definition={detail.definition}
          onClose={() => setSelectedExecution(null)}
          onStopped={() => void loadExecutions()}
        />
      )}
    </SpaceBetween>
  )
}

// --- Root --------------------------------------------------------------------------

export function CloudscapeStepFunctionsBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedMachineArn = searchParams.get('machine')

  const machinesFetcher = useCallback(() => fetchStepFunctionsStateMachines(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ stateMachines: StepFunctionsStateMachine[] }>(machinesFetcher, 10000)

  const machines = data?.stateMachines ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(machines, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  if (selectedMachineArn) {
    return <StateMachineDetail arn={selectedMachineArn} onBack={() => setSearchParams({})} />
  }

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load state machines" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Table
        {...collectionProps}
        items={items}
        trackBy="stateMachineArn"
        loading={loading && !data}
        loadingText="Loading state machines"
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h2"
            counter={data ? `(${machines.length})` : undefined}
            actions={<Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh state machines" />}
          >
            State machines
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find a state machine"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" padding="l" color="text-status-inactive">
            No Step Functions state machines found in this environment.
          </Box>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (m) => (
              <Link
                href={`?machine=${encodeURIComponent(m.stateMachineArn)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  setSearchParams({ machine: m.stateMachineArn })
                }}
              >
                {m.name}
              </Link>
            ),
          },
          { id: 'type', header: 'Type', sortingField: 'type', cell: (m) => typeBadge(m.type) },
          { id: 'status', header: 'Status', cell: (m) => m.status },
          { id: 'created', header: 'Created', sortingField: 'creationDate', cell: (m) => formatDate(m.creationDate) },
        ]}
      />
    </SpaceBetween>
  )
}
