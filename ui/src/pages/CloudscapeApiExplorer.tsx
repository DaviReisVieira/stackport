import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import type { ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown'
import Container from '@cloudscape-design/components/container'
import ContentLayout from '@cloudscape-design/components/content-layout'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import FormField from '@cloudscape-design/components/form-field'
import Grid from '@cloudscape-design/components/grid'
import Header from '@cloudscape-design/components/header'
import Modal from '@cloudscape-design/components/modal'
import Select from '@cloudscape-design/components/select'
import type { SelectProps } from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { AccessBadge, OperationList } from '@/components/cloudscape/views/explorer/OperationList'
import type { FieldDraft } from '@/components/cloudscape/views/explorer/ParameterForm'
import { MAX_PAGES_FIELD, REQUEST_JSON, RequestEditor } from '@/components/cloudscape/views/explorer/RequestEditor'
import type { PageOptions } from '@/components/cloudscape/views/explorer/RequestEditor'
import { ResponseView } from '@/components/cloudscape/views/explorer/ResponseView'
import type { RunState } from '@/components/cloudscape/views/explorer/ResponseView'
import { firstSentence, isObject, missingRequired, withoutSensitive } from '@/components/cloudscape/views/explorer/shapes'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useExplorerHistory } from '@/hooks/useExplorerHistory'
import { useFetch } from '@/hooks/useFetch'
import { useHealth } from '@/hooks/useHealth'
import {
  ApiError,
  fetchExplorerCliSetup,
  fetchExplorerOperation,
  fetchExplorerService,
  fetchExplorerServices,
  runExplorerOperation,
} from '@/lib/api'
import type { ExplorerOperation, ExplorerService, HealthResponse, JsonObject } from '@/lib/types'

/** Everything typed and run for one operation; it starts over when another operation opens. */
interface Workspace {
  key: string
  params: JsonObject
  /** Text typed that can't be sent yet, by field (see RequestEditor) */
  drafts: Record<string, FieldDraft>
  /** Set by a run attempt, so required fields only complain once someone tried */
  showRequired: boolean
  pages: PageOptions
  run: RunState | null
  runId: number
}

function freshWorkspace(key: string, params: JsonObject = {}): Workspace {
  return { key, params, drafts: {}, showRequired: false, pages: { paginate: false, maxPages: 10 }, run: null, runId: 0 }
}

/** A run waiting for someone to confirm it, and from which page (null: the first). */
interface PendingRun {
  continuation: JsonObject | null
}

function endpointDescription(health: HealthResponse | null, activeEndpoint: string | null): string {
  if (!health) return activeEndpoint ?? 'the default endpoint'
  const where = health.endpoint_url ? [health.emulator?.name, health.endpoint_url].filter(Boolean).join(' at ') : 'AWS'
  return `${activeEndpoint ?? 'default'} (${where}, ${health.region})`
}

const DRAFT_LABELS: Record<string, string> = { [REQUEST_JSON]: 'the request JSON', [MAX_PAGES_FIELD]: 'the number of pages' }

function listed(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function runBlocker(operation: ExplorerOperation, health: HealthResponse | null, drafts: Record<string, FieldDraft>): string | undefined {
  if (operation.eventStreamInput) {
    return `${operation.name} sends a stream of events, which neither the API Explorer nor boto3 can do.`
  }
  if (operation.eventStreamOutput) {
    return `${operation.name} answers with a stream of events, which the API Explorer can't show. Copy it as boto3 code instead.`
  }
  if (operation.access === 'write' && health && !health.writes_enabled) {
    return `StackPort runs read-only (STACKPORT_ALLOW_WRITES=false), and ${operation.name} changes resources.`
  }
  const unfinished = Object.keys(drafts)
  if (unfinished.length > 0) return `Fix ${listed(unfinished.map((name) => DRAFT_LABELS[name] ?? name))} first.`
  return undefined
}

export default function CloudscapeApiExplorer() {
  const [searchParams, setSearchParams] = useSearchParams()
  const service = searchParams.get('service')
  const operation = service ? searchParams.get('operation') : null
  const { activeEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const history = useExplorerHistory()

  const catalogFetcher = useCallback(() => fetchExplorerServices(), [])
  const { data: catalog, error: catalogError, refresh: refreshCatalog } = useFetch(catalogFetcher)
  const serviceFetcher = useCallback(() => (service ? fetchExplorerService(service) : Promise.resolve(null)), [service])
  const { data: serviceDetail, loading: serviceLoading, error: serviceError } = useFetch<ExplorerService | null>(serviceFetcher)
  const operationFetcher = useCallback(
    () => (service && operation ? fetchExplorerOperation(service, operation) : Promise.resolve(null)),
    [service, operation],
  )
  const { data: operationDetail, error: operationError } = useFetch<ExplorerOperation | null>(operationFetcher)
  // Asked again once the emulator behind the endpoint is known, which can take a moment
  const cliSetupFetcher = useCallback(() => fetchExplorerCliSetup(activeEndpoint), [activeEndpoint])
  const { data: cliSetup } = useFetch(cliSetupFetcher, undefined, { refreshKey: health?.emulator?.id })

  const key = service && operation ? `${service}/${operation}` : ''
  const [stored, setWorkspace] = useState<Workspace>(() => freshWorkspace(key))
  const workspace = stored.key === key ? stored : freshWorkspace(key)
  const edit = useCallback(
    (change: (current: Workspace) => Workspace) => setWorkspace((prev) => change(prev.key === key ? prev : freshWorkspace(key))),
    [key],
  )
  const setParams = useCallback((params: JsonObject) => edit((current) => ({ ...current, params })), [edit])
  const setPages = useCallback((pages: PageOptions) => edit((current) => ({ ...current, pages })), [edit])
  const reportDraft = useCallback(
    (field: string, draft: FieldDraft | null) =>
      edit((current) => {
        if (draft === null && !(field in current.drafts)) return current
        const drafts = { ...current.drafts }
        if (draft === null) delete drafts[field]
        else drafts[field] = draft
        return { ...current, drafts }
      }),
    [edit],
  )

  const [confirming, setConfirming] = useState<PendingRun | null>(null)

  const serviceOptions = useMemo<SelectProps.Option[]>(
    () => (catalog?.services ?? []).map(({ name, fullName }) => ({ label: name, value: name, description: fullName ?? undefined })),
    [catalog],
  )
  const selectedService = service ? (serviceOptions.find((option) => option.value === service) ?? { label: service, value: service }) : null

  const chooseService = (name: string) => setSearchParams({ service: name })
  const chooseOperation = (name: string) => {
    if (service) setSearchParams({ service, operation: name })
  }

  const endpointLabel = activeEndpoint ?? 'default'
  // Where copied commands send their request: the active endpoint, as health reports it
  const target = { endpointUrl: health?.endpoint_url ?? null, region: health?.region ?? 'us-east-1' }

  /**
   * Run the request, or with `continuation` the page after a previous run.
   * Paging tokens stay out of the request being edited and out of history.
   */
  const run = async (continuation: JsonObject | null) => {
    if (!service || !operation || !operationDetail) return
    const runId = workspace.runId + 1
    const params = workspace.params
    const request = {
      params: continuation ? { ...params, ...continuation } : params,
      paginate: workspace.pages.paginate && Boolean(operationDetail.pagination),
      maxPages: workspace.pages.maxPages,
    }
    edit((current) => ({ ...current, showRequired: false, run: { status: 'running' }, runId }))
    const settle = (state: RunState) =>
      setWorkspace((prev) => (prev.key === key && prev.runId === runId ? { ...prev, run: state } : prev))
    let status: number | null
    try {
      const result = await runExplorerOperation(service, operation, request, activeEndpoint)
      settle({ status: 'done', endpoint: endpointLabel, result })
      status = result.responses[result.responses.length - 1]?.metadata.httpStatusCode ?? 200
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError(0, error instanceof Error ? error.message : String(error))
      settle({ status: 'failed', endpoint: endpointLabel, error: failure })
      status = failure.status || null
    }
    if (continuation) return
    const graph = operationDetail.input
    const kept = graph ? withoutSensitive(graph, graph.root, params) : params
    history.record({ service, operation, params: isObject(kept) ? kept : {}, status, at: new Date().toISOString() })
  }

  const requestRun = (continuation: JsonObject | null) => {
    if (!operationDetail) return
    if (missingRequired(operationDetail.input, workspace.params).length > 0) {
      edit((current) => ({ ...current, showRequired: true }))
      return
    }
    // Until health answers, the endpoint might be AWS
    if (operationDetail.access === 'write' && (!health || health.connection_type === 'aws')) {
      setConfirming({ continuation })
      return
    }
    void run(continuation)
  }

  const historyItems: ButtonDropdownProps.Items = history.entries.length
    ? [
        {
          text: 'Recent requests',
          items: history.entries.map((entry, index) => ({
            id: `entry-${index}`,
            text: `${entry.service} ${entry.operation}`,
            secondaryText: `${entry.status ?? 'No response'} · ${new Date(entry.at).toLocaleString()}`,
          })),
        },
        { id: 'clear', text: 'Clear history' },
      ]
    : [{ id: 'empty', text: 'No requests yet', disabled: true }]

  const restore = (index: number) => {
    const entry = history.entries[index]
    if (!entry) return
    setWorkspace(freshWorkspace(`${entry.service}/${entry.operation}`, entry.params))
    setSearchParams({ service: entry.service, operation: entry.operation })
  }

  const missing = operationDetail ? missingRequired(operationDetail.input, workspace.params) : []
  const blocker = operationDetail ? runBlocker(operationDetail, health, workspace.drafts) : undefined
  const onAws = health?.connection_type === 'aws'

  return (
    <CloudscapeShell activeHref="/explorer">
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={`Call any operation of any service boto3 knows, including the ones StackPort has no view for. Requests go to ${endpointDescription(health, activeEndpoint)}.`}
            actions={
              <ButtonDropdown
                items={historyItems}
                onItemClick={({ detail }) => {
                  if (detail.id === 'clear') history.clear()
                  else if (detail.id.startsWith('entry-')) restore(Number(detail.id.slice('entry-'.length)))
                }}
              >
                History
              </ButtonDropdown>
            }
          >
            API Explorer
          </Header>
        }
      >
        <Grid gridDefinition={[{ colspan: { default: 12, s: 5, l: 4 } }, { colspan: { default: 12, s: 7, l: 8 } }]}>
          <SpaceBetween size="l">
            <Container>
              <FormField
                label="Service"
                description={catalog ? `${catalog.services.length} services from botocore ${catalog.botocoreVersion}` : undefined}
                errorText={catalogError ?? undefined}
                stretch
              >
                <Select
                  selectedOption={selectedService}
                  options={serviceOptions}
                  onChange={({ detail }) => detail.selectedOption.value && chooseService(detail.selectedOption.value)}
                  filteringType="auto"
                  filteringPlaceholder="Find a service"
                  placeholder="Choose a service"
                  statusType={catalog ? 'finished' : catalogError ? 'error' : 'loading'}
                  loadingText="Loading services"
                  errorText="Couldn't load the services."
                  recoveryText="Retry"
                  // Called when the list opens too; only a failed list needs asking again
                  onLoadItems={() => {
                    if (catalogError) void refreshCatalog()
                  }}
                  triggerVariant="option"
                  ariaLabel="Service"
                />
              </FormField>
            </Container>
            {service && (
              <OperationList
                key={service}
                operations={serviceDetail?.operations ?? []}
                loading={serviceLoading}
                selected={operation}
                onSelect={chooseOperation}
              />
            )}
          </SpaceBetween>

          <SpaceBetween size="l">
            {!service && (
              <Container>
                <Box textAlign="center" padding="xl" color="text-body-secondary">
                  Choose a service to see its operations.
                </Box>
              </Container>
            )}

            {service && serviceError && (
              <Alert type="error" header={`Can't open ${service}`}>
                {serviceError}
              </Alert>
            )}

            {serviceDetail && !operation && (
              <Container header={<Header variant="h2" description={`API version ${serviceDetail.apiVersion}`}>{serviceDetail.fullName ?? serviceDetail.name}</Header>}>
                <SpaceBetween size="m">
                  <Box variant="p">
                    <span className="whitespace-pre-line">{serviceDetail.documentation || 'No documentation.'}</span>
                  </Box>
                  <Box color="text-body-secondary">Choose an operation to build a request.</Box>
                </SpaceBetween>
              </Container>
            )}

            {operation && operationError && (
              <Alert type="error" header={`Can't open ${operation}`}>
                {operationError}
              </Alert>
            )}

            {operation && !operationDetail && !operationError && (
              <Container>
                <StatusIndicator type="loading">Loading {operation}</StatusIndicator>
              </Container>
            )}

            {operationDetail && service && operation && (
              <>
                <Container
                  header={
                    <Header variant="h2" description={firstSentence(operationDetail.documentation)}>
                      {operationDetail.name}
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    <SpaceBetween direction="horizontal" size="xs">
                      <AccessBadge access={operationDetail.access} />
                      {operationDetail.pagination && <Badge>Paginated</Badge>}
                      {(operationDetail.streamingInput || operationDetail.streamingOutput) && <Badge>Streaming</Badge>}
                      {(operationDetail.eventStreamInput || operationDetail.eventStreamOutput) && <Badge color="severity-medium">Event stream</Badge>}
                      {operationDetail.deprecated && <Badge color="red">Deprecated</Badge>}
                    </SpaceBetween>
                    {operationDetail.documentation !== firstSentence(operationDetail.documentation) && (
                      <ExpandableSection headerText="Documentation">
                        <Box variant="p">
                          <span className="whitespace-pre-line">{operationDetail.documentation}</span>
                        </Box>
                      </ExpandableSection>
                    )}
                  </SpaceBetween>
                </Container>

                <Container
                  header={
                    <Header
                      variant="h2"
                      actions={
                        <Button
                          variant="primary"
                          loading={workspace.run?.status === 'running'}
                          disabled={blocker !== undefined}
                          disabledReason={blocker}
                          onClick={() => requestRun(null)}
                        >
                          Run
                        </Button>
                      }
                    >
                      Request
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    {operationDetail.access === 'write' && health && !health.writes_enabled && (
                      <Alert type="info" header="Read-only mode">
                        StackPort runs with STACKPORT_ALLOW_WRITES=false, so only operations that read can run here.
                        You can still build this request and copy it as an AWS CLI command or boto3 code.
                      </Alert>
                    )}
                    {workspace.showRequired && missing.length > 0 && (
                      <Alert type="error">
                        {missing.length === 1 ? `${missing[0]} is required.` : `These parameters are required: ${missing.join(', ')}.`}
                      </Alert>
                    )}
                    <RequestEditor
                      key={key}
                      operation={operationDetail}
                      params={workspace.params}
                      drafts={workspace.drafts}
                      showRequired={workspace.showRequired}
                      pages={workspace.pages}
                      target={target}
                      cliSetup={cliSetup}
                      onParamsChange={setParams}
                      onPagesChange={setPages}
                      onDraft={reportDraft}
                    />
                  </SpaceBetween>
                </Container>

                {workspace.run && (
                  <ResponseView
                    key={workspace.runId}
                    run={workspace.run}
                    service={service}
                    operation={operation}
                    onNextPage={requestRun}
                  />
                )}
              </>
            )}
          </SpaceBetween>
        </Grid>
      </ContentLayout>

      <Modal
        visible={confirming !== null}
        onDismiss={() => setConfirming(null)}
        header={onAws ? `Run ${operation} on AWS?` : `Run ${operation}?`}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (confirming) void run(confirming.continuation)
                  setConfirming(null)
                }}
              >
                {onAws ? 'Run on AWS' : 'Run anyway'}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        {onAws
          ? `${operation} can change resources in the AWS account behind ${endpointLabel}, and the change may cost money. StackPort can't undo it.`
          : `StackPort hasn't been able to tell whether ${endpointLabel} is a local emulator or AWS. ${operation} can change resources there, and on AWS the change may cost money.`}
      </Modal>
    </CloudscapeShell>
  )
}
