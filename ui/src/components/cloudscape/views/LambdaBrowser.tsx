import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  fetchLambdaAliases,
  fetchLambdaEventSources,
  fetchLambdaFunction,
  fetchLambdaFunctions,
  fetchLambdaVersions,
  getLambdaCodeDownloadUrl,
  invokeLambdaFunction,
  updateLambdaConfiguration,
} from '@/lib/api'
import type {
  LambdaAlias,
  LambdaEventSourceMapping,
  LambdaFunction,
  LambdaFunctionDetail,
  LambdaInvokeResponse,
  LambdaUpdateConfigRequest,
  LambdaVersion,
} from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

// Ported verbatim from the legacy view
const EVENT_TEMPLATES = {
  'API Gateway': {
    httpMethod: 'GET',
    path: '/test',
    headers: { 'Content-Type': 'application/json' },
    queryStringParameters: {},
    body: null,
  },
  'S3': {
    Records: [
      {
        eventName: 's3:ObjectCreated:Put',
        s3: {
          bucket: { name: 'test-bucket' },
          object: { key: 'test-key' },
        },
      },
    ],
  },
  'SQS': {
    Records: [
      {
        messageId: 'test-message-id',
        body: JSON.stringify({ test: 'data' }),
        attributes: {},
      },
    ],
  },
  'CloudWatch Events': {
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    time: new Date().toISOString(),
    detail: {},
  },
  'Custom': {},
} as const

const SUPPORTED_RUNTIMES = [
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'nodejs22.x',
  'nodejs20.x',
  'nodejs18.x',
  'java21',
  'java17',
  'java11',
  'java8.al2',
  'dotnet8',
  'dotnet6',
  'go1.x',
  'ruby3.3',
  'ruby3.2',
  'provided.al2023',
  'provided.al2',
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function stateIndicator(state?: string) {
  if (!state) return <Box color="text-status-inactive">—</Box>
  return (
    <StatusIndicator type={state === 'Active' ? 'success' : state === 'Failed' ? 'error' : 'in-progress'}>
      {state}
    </StatusIndicator>
  )
}

function InvokeModal({ functionName, onClose }: { functionName: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [template, setTemplate] = useState<keyof typeof EVENT_TEMPLATES>('Custom')
  const [payload, setPayload] = useState(JSON.stringify(EVENT_TEMPLATES.Custom, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [invoking, setInvoking] = useState(false)
  const [result, setResult] = useState<LambdaInvokeResponse | null>(null)

  const applyTemplate = (name: keyof typeof EVENT_TEMPLATES) => {
    setTemplate(name)
    setPayload(JSON.stringify(EVENT_TEMPLATES[name], null, 2))
    setError(null)
  }

  const invoke = async () => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(payload)
    } catch {
      setError('Invalid JSON payload')
      return
    }
    setInvoking(true)
    setResult(null)
    try {
      const response = await invokeLambdaFunction(functionName, { payload: parsed }, activeEndpoint)
      setResult(response)
      if (response.functionError) toast.error(`Function returned an error: ${response.functionError}`)
      else toast.success('Function invoked successfully')
    } catch (err) {
      toast.error(`Invoke failed: ${err}`)
    } finally {
      setInvoking(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Invoke ${functionName}`} size="large">
      <SpaceBetween size="m">
        <FormField label="Event template">
          <Select
            selectedOption={{ value: template, label: template }}
            onChange={({ detail }) => applyTemplate(detail.selectedOption.value as keyof typeof EVENT_TEMPLATES)}
            options={Object.keys(EVENT_TEMPLATES).map((name) => ({ value: name, label: name }))}
          />
        </FormField>
        <FormField label="Payload" errorText={error ?? undefined} stretch>
          <Textarea value={payload} onChange={({ detail }) => setPayload(detail.value)} rows={10} spellcheck={false} />
        </FormField>
        <Button variant="primary" onClick={invoke} loading={invoking} data-testid="invoke-run">
          Invoke
        </Button>

        {result && (
          <SpaceBetween size="s">
            <SpaceBetween direction="horizontal" size="xs">
              <StatusIndicator type={result.functionError ? 'error' : 'success'}>
                Status {result.statusCode}
              </StatusIndicator>
              <Badge color="grey">version {result.executedVersion}</Badge>
              {result.functionError && <Badge color="red">{result.functionError}</Badge>}
            </SpaceBetween>
            <FormField label="Response payload" stretch>
              <Box variant="code">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(result.payload, null, 2)}
                </pre>
              </Box>
            </FormField>
            {result.logs && (
              <FormField label="Logs (last 4 KB)" stretch>
                <Box variant="code">
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{result.logs}</pre>
                </Box>
              </FormField>
            )}
          </SpaceBetween>
        )}
      </SpaceBetween>
    </Modal>
  )
}

function ConfigEditorModal({
  detail,
  onClose,
  onDone,
}: {
  detail: LambdaFunctionDetail
  onClose: () => void
  onDone: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const config = detail.configuration
  const [description, setDescription] = useState(config.Description ?? '')
  const [handler, setHandler] = useState(config.Handler ?? '')
  const [runtime, setRuntime] = useState(config.Runtime ?? '')
  const [memory, setMemory] = useState(String(config.MemorySize))
  const [timeout, setTimeoutValue] = useState(String(config.Timeout))
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    Object.entries(config.Environment?.Variables ?? {}).map(([key, value]) => ({ key, value })),
  )
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    // Send only what changed, matching the legacy editor
    const updates: LambdaUpdateConfigRequest = {}
    if (description !== (config.Description ?? '')) updates.description = description
    if (handler !== (config.Handler ?? '')) updates.handler = handler
    if (runtime !== (config.Runtime ?? '')) updates.runtime = runtime
    if (Number(memory) !== config.MemorySize) updates.memorySize = Number(memory)
    if (Number(timeout) !== config.Timeout) updates.timeout = Number(timeout)
    const envRecord = Object.fromEntries(envVars.filter((v) => v.key.trim()).map((v) => [v.key.trim(), v.value]))
    if (JSON.stringify(envRecord) !== JSON.stringify(config.Environment?.Variables ?? {})) {
      updates.environment = envRecord
    }
    if (Object.keys(updates).length === 0) {
      toast.info('No changes to save')
      return
    }
    setSaving(true)
    try {
      await updateLambdaConfiguration(config.FunctionName, updates, activeEndpoint)
      toast.success('Configuration updated')
      onDone()
    } catch (err) {
      toast.error(`Failed to update configuration: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Edit ${config.FunctionName}`} size="large">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving}>
              Save changes
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Description">
            <Input value={description} onChange={({ detail: d }) => setDescription(d.value)} />
          </FormField>
          <FormField label="Handler">
            <Input value={handler} onChange={({ detail: d }) => setHandler(d.value)} />
          </FormField>
          <FormField label="Runtime">
            <Select
              selectedOption={runtime ? { value: runtime, label: runtime } : null}
              onChange={({ detail: d }) => setRuntime(d.selectedOption.value ?? '')}
              options={SUPPORTED_RUNTIMES.map((r) => ({ value: r, label: r }))}
              placeholder="Select runtime"
            />
          </FormField>
          <ColumnLayout columns={2}>
            <FormField label="Memory (MB)" description="128-10240">
              <Input type="number" value={memory} onChange={({ detail: d }) => setMemory(d.value)} />
            </FormField>
            <FormField label="Timeout (seconds)" description="1-900">
              <Input type="number" value={timeout} onChange={({ detail: d }) => setTimeoutValue(d.value)} />
            </FormField>
          </ColumnLayout>
          <FormField label="Environment variables">
            <AttributeEditor
              items={envVars}
              onAddButtonClick={() => setEnvVars([...envVars, { key: '', value: '' }])}
              onRemoveButtonClick={({ detail: d }) => setEnvVars(envVars.filter((_, i) => i !== d.itemIndex))}
              addButtonText="Add variable"
              removeButtonText="Remove"
              empty="No environment variables"
              definition={[
                {
                  label: 'Key',
                  control: (item, index) => (
                    <Input
                      value={item.key}
                      onChange={({ detail: d }) => setEnvVars(envVars.map((v, i) => (i === index ? { ...v, key: d.value } : v)))}
                    />
                  ),
                },
                {
                  label: 'Value',
                  control: (item, index) => (
                    <Input
                      value={item.value}
                      onChange={({ detail: d }) => setEnvVars(envVars.map((v, i) => (i === index ? { ...v, value: d.value } : v)))}
                    />
                  ),
                },
              ]}
            />
          </FormField>
          {(config.Layers?.length ?? 0) > 0 && (
            <FormField label="Layers (read-only)">
              <SpaceBetween size="xs">
                {config.Layers?.map((layer) => (
                  <Box key={layer.Arn} fontSize="body-s">
                    {layer.Arn} ({formatBytes(layer.CodeSize)})
                  </Box>
                ))}
              </SpaceBetween>
            </FormField>
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

function ConfigurationPanel({ detail, onEdit }: { detail: LambdaFunctionDetail; onEdit: () => void }) {
  const config = detail.configuration
  const rows: Array<[string, string]> = [
    ['Runtime', config.Runtime ?? '—'],
    ['Handler', config.Handler ?? '—'],
    ['Memory', `${config.MemorySize} MB`],
    ['Timeout', `${config.Timeout}s`],
    ['Code size', formatBytes(config.CodeSize)],
    ['Last modified', config.LastModified],
    ['Architectures', config.Architectures?.join(', ') ?? '—'],
    ['IAM role', config.Role],
    ['Package type', config.PackageType ?? 'Zip'],
    ['Tracing', config.TracingConfig?.Mode ?? '—'],
    ['VPC', config.VpcConfig?.VpcId ?? '—'],
    ['Log group', config.LoggingConfig?.LogGroup ?? '—'],
  ]
  const envVars = Object.entries(config.Environment?.Variables ?? {})

  return (
    <SpaceBetween size="l">
      <Header variant="h3" actions={<Button onClick={onEdit}>Edit configuration</Button>}>
        Basic configuration
      </Header>
      <ColumnLayout columns={3} variant="text-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <Box variant="awsui-key-label">{label}</Box>
            <Box fontSize="body-s">{value}</Box>
          </div>
        ))}
      </ColumnLayout>

      <Header variant="h3" counter={`(${envVars.length})`}>
        Environment variables
      </Header>
      {envVars.length === 0 ? (
        <Box color="text-status-inactive">No environment variables</Box>
      ) : (
        <Table
          variant="embedded"
          items={envVars.map(([key, value]) => ({ key, value }))}
          trackBy="key"
          columnDefinitions={[
            { id: 'key', header: 'Key', cell: (r) => r.key },
            { id: 'value', header: 'Value', cell: (r) => r.value },
          ]}
        />
      )}

      {(config.Layers?.length ?? 0) > 0 && (
        <>
          <Header variant="h3" counter={`(${config.Layers?.length})`}>
            Layers
          </Header>
          <SpaceBetween size="xs">
            {config.Layers?.map((layer) => (
              <Box key={layer.Arn} fontSize="body-s">
                {layer.Arn} ({formatBytes(layer.CodeSize)})
              </Box>
            ))}
          </SpaceBetween>
        </>
      )}
    </SpaceBetween>
  )
}

function AliasesVersionsPanel({ functionName }: { functionName: string }) {
  const { activeEndpoint } = useEndpoint()
  const aliasesFetcher = useCallback(() => fetchLambdaAliases(functionName, activeEndpoint), [functionName, activeEndpoint])
  const versionsFetcher = useCallback(() => fetchLambdaVersions(functionName, activeEndpoint), [functionName, activeEndpoint])
  const { data: aliasData, loading: aliasesLoading } = useFetch<{ aliases: LambdaAlias[] }>(aliasesFetcher)
  const { data: versionData, loading: versionsLoading } = useFetch<{ versions: LambdaVersion[] }>(versionsFetcher)

  return (
    <SpaceBetween size="l">
      <Table
        variant="embedded"
        header={<Header variant="h3" counter={aliasData ? `(${aliasData.aliases.length})` : undefined}>Aliases</Header>}
        items={aliasData?.aliases ?? []}
        loading={aliasesLoading}
        trackBy="Name"
        empty={<Box textAlign="center">No aliases</Box>}
        columnDefinitions={[
          { id: 'name', header: 'Name', cell: (a) => a.Name },
          { id: 'version', header: 'Version', cell: (a) => a.FunctionVersion },
          { id: 'description', header: 'Description', cell: (a) => a.Description || '—' },
        ]}
      />
      <Table
        variant="embedded"
        header={<Header variant="h3" counter={versionData ? `(${versionData.versions.length})` : undefined}>Versions</Header>}
        items={versionData?.versions ?? []}
        loading={versionsLoading}
        trackBy="Version"
        empty={<Box textAlign="center">No published versions</Box>}
        columnDefinitions={[
          { id: 'version', header: 'Version', cell: (v) => v.Version },
          { id: 'sha', header: 'Code SHA256', cell: (v) => `${v.CodeSha256.slice(0, 16)}...` },
          { id: 'size', header: 'Size', cell: (v) => formatBytes(v.CodeSize) },
          { id: 'modified', header: 'Last modified', cell: (v) => v.LastModified },
        ]}
      />
    </SpaceBetween>
  )
}

function EventSourcesPanel({ functionName }: { functionName: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchLambdaEventSources(functionName, activeEndpoint), [functionName, activeEndpoint])
  const { data, loading } = useFetch<{ eventSourceMappings: LambdaEventSourceMapping[] }>(fetcher)

  return (
    <Table
      variant="embedded"
      header={
        <Header variant="h3" counter={data ? `(${data.eventSourceMappings.length})` : undefined}>
          Event source mappings
        </Header>
      }
      items={data?.eventSourceMappings ?? []}
      loading={loading}
      trackBy="UUID"
      empty={<Box textAlign="center">No event source mappings</Box>}
      columnDefinitions={[
        { id: 'source', header: 'Event source', cell: (m) => m.EventSourceArn },
        { id: 'state', header: 'State', cell: (m) => stateIndicator(m.State) },
        { id: 'batch', header: 'Batch size', cell: (m) => m.BatchSize ?? '—' },
        { id: 'result', header: 'Last result', cell: (m) => m.LastProcessingResult ?? '—' },
        { id: 'modified', header: 'Last modified', cell: (m) => m.LastModified },
      ]}
    />
  )
}

function FunctionDetailView({ functionName, onBack }: { functionName: string; onBack: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchLambdaFunction(functionName, activeEndpoint), [functionName, activeEndpoint])
  const { data: detail, loading, error, refresh } = useFetch<LambdaFunctionDetail>(fetcher)
  const [invokeOpen, setInvokeOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  if (loading && !detail) return <StatusIndicator type="loading">Loading function</StatusIndicator>
  if (error && !detail) {
    return (
      <Alert type="error" header="Could not load function" action={<Button onClick={() => refresh()}>Retry</Button>}>
        {error}
      </Alert>
    )
  }
  if (!detail) return null

  const config = detail.configuration
  const tags = Object.entries(detail.tags ?? {})

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description={config.FunctionArn}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onBack}>Back to functions</Button>
            <Button iconName="refresh" onClick={() => refresh()} ariaLabel="Refresh function" />
            <Button variant="primary" onClick={() => setInvokeOpen(true)}>
              Invoke
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween direction="horizontal" size="xs">
          {config.FunctionName}
          {config.Runtime && <Badge color="blue">{config.Runtime}</Badge>}
          {stateIndicator(config.State)}
        </SpaceBetween>
      </Header>

      <Tabs
        tabs={[
          {
            id: 'config',
            label: 'Configuration',
            content: <ConfigurationPanel detail={detail} onEdit={() => setEditOpen(true)} />,
          },
          {
            id: 'code',
            label: 'Code',
            content: (
              <SpaceBetween size="m">
                <ColumnLayout columns={3} variant="text-grid">
                  <div>
                    <Box variant="awsui-key-label">Code size</Box>
                    <Box fontSize="body-s">{formatBytes(config.CodeSize)}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">SHA256</Box>
                    <Box fontSize="body-s">{config.CodeSha256}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Repository type</Box>
                    <Box fontSize="body-s">{detail.code.RepositoryType ?? '—'}</Box>
                  </div>
                </ColumnLayout>
                <Button
                  iconName="download"
                  href={getLambdaCodeDownloadUrl(config.FunctionName, activeEndpoint)}
                  target="_blank"
                  download
                >
                  Download code package
                </Button>
              </SpaceBetween>
            ),
          },
          {
            id: 'versions',
            label: 'Aliases & Versions',
            content: <AliasesVersionsPanel functionName={config.FunctionName} />,
          },
          {
            id: 'events',
            label: 'Event sources',
            content: <EventSourcesPanel functionName={config.FunctionName} />,
          },
          {
            id: 'tags',
            label: 'Tags',
            content:
              tags.length === 0 ? (
                <Box color="text-status-inactive">No tags</Box>
              ) : (
                <SpaceBetween direction="horizontal" size="xs">
                  {tags.map(([key, value]) => (
                    <Badge key={key} color="grey">
                      {key}: {value}
                    </Badge>
                  ))}
                </SpaceBetween>
              ),
          },
        ]}
      />

      {invokeOpen && <InvokeModal functionName={config.FunctionName} onClose={() => setInvokeOpen(false)} />}
      {editOpen && (
        <ConfigEditorModal
          detail={detail}
          onClose={() => setEditOpen(false)}
          onDone={() => {
            setEditOpen(false)
            refresh()
          }}
        />
      )}
    </SpaceBetween>
  )
}

export function CloudscapeLambdaBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedFunction = searchParams.get('function')
  const functionsFetcher = useCallback(() => fetchLambdaFunctions(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ functions: LambdaFunction[] }>(functionsFetcher, 10000)

  const functions = data?.functions ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(functions, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const openFunction = useCallback((name: string) => setSearchParams({ function: name }), [setSearchParams])
  const backToList = useCallback(() => {
    setSearchParams({})
    refresh()
  }, [setSearchParams, refresh])

  if (selectedFunction) {
    return <FunctionDetailView functionName={selectedFunction} onBack={backToList} />
  }

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load functions" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Table
        {...collectionProps}
        items={items}
        trackBy="FunctionName"
        loading={loading && !data}
        loadingText="Loading functions"
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h2"
            counter={data ? `(${functions.length})` : undefined}
            actions={<Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh functions" />}
          >
            Functions
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find a function"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={<Box textAlign="center">No functions found</Box>}
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'FunctionName',
            cell: (f) => (
              <Link
                href={`?function=${encodeURIComponent(f.FunctionName)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  openFunction(f.FunctionName)
                }}
              >
                {f.FunctionName}
              </Link>
            ),
          },
          {
            id: 'runtime',
            header: 'Runtime',
            sortingField: 'Runtime',
            cell: (f) => (f.Runtime ? <Badge color="blue">{f.Runtime}</Badge> : '—'),
          },
          { id: 'memory', header: 'Memory', sortingField: 'MemorySize', cell: (f) => `${f.MemorySize} MB` },
          { id: 'timeout', header: 'Timeout', sortingField: 'Timeout', cell: (f) => `${f.Timeout}s` },
          { id: 'size', header: 'Size', sortingField: 'CodeSize', cell: (f) => formatBytes(f.CodeSize) },
          { id: 'state', header: 'State', cell: (f) => stateIndicator(f.State) },
          { id: 'modified', header: 'Last modified', sortingField: 'LastModified', cell: (f) => f.LastModified },
        ]}
      />
    </SpaceBetween>
  )
}
