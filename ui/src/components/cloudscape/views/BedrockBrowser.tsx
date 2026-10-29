import { useCallback, useState } from 'react'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { converseBedrock, fetchBedrockModels } from '@/lib/api'
import type { BedrockConverseResponse, BedrockModel, BedrockModelsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

/** Blank means "use the model default"; anything else must be a finite number. */
function parseOptionalNumber(value: string): number | undefined | null {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function validateMaxTokens(value: string): string | null {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) return null
  return parsed === null || !Number.isInteger(parsed) || parsed < 1 ? 'Enter a whole number of at least 1' : null
}

function validateUnitInterval(value: string): string | null {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) return null
  return parsed === null || parsed < 0 || parsed > 1 ? 'Enter a number between 0 and 1' : null
}

// --- Playground -------------------------------------------------------------

function ResponsePanel({ result }: { result: BedrockConverseResponse }) {
  return (
    <Container header={<Header variant="h3">Response</Header>}>
      <SpaceBetween size="m">
        <Box>
          <div style={{ whiteSpace: 'pre-wrap' }} data-testid="bedrock-response-text">
            {result.text || <Box color="text-status-inactive">The model returned no text.</Box>}
          </div>
        </Box>
        <ColumnLayout columns={4} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Model ID</Box>
            <div>{result.modelId}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Stop reason</Box>
            <div>{result.stopReason ?? '-'}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Input tokens</Box>
            <div>{result.usage.inputTokens}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Output tokens</Box>
            <div>{result.usage.outputTokens}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Total tokens</Box>
            <div>{result.usage.totalTokens}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Model latency</Box>
            <div>{result.latencyMs === null ? '-' : `${result.latencyMs} ms`}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Round trip</Box>
            <div>{result.roundTripMs} ms</div>
          </div>
        </ColumnLayout>
        <ExpandableSection headerText="Raw response">
          <pre className="text-xs overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        </ExpandableSection>
      </SpaceBetween>
    </Container>
  )
}

function PlaygroundTab({ models }: { models: BedrockModel[] }) {
  const { activeEndpoint } = useEndpoint()
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [system, setSystem] = useState('')
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [temperature, setTemperature] = useState('')
  const [topP, setTopP] = useState('')
  const [invoking, setInvoking] = useState(false)
  const [result, setResult] = useState<BedrockConverseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options = models.map((m) => ({ label: m.modelName, value: m.modelId, description: m.modelId, tags: [m.providerName] }))
  const modelId = selectedModelId ?? models[0]?.modelId ?? null
  const selectedOption = options.find((o) => o.value === modelId) ?? null

  const maxTokensError = validateMaxTokens(maxTokens)
  const temperatureError = validateUnitInterval(temperature)
  const topPError = validateUnitInterval(topP)
  const canInvoke = Boolean(modelId && prompt.trim()) && !maxTokensError && !temperatureError && !topPError

  const invoke = async () => {
    if (!modelId) return
    setInvoking(true)
    setError(null)
    try {
      setResult(
        await converseBedrock(
          {
            modelId,
            prompt,
            system: system.trim() || undefined,
            maxTokens: parseOptionalNumber(maxTokens) ?? undefined,
            temperature: parseOptionalNumber(temperature) ?? undefined,
            topP: parseOptionalNumber(topP) ?? undefined,
          },
          activeEndpoint,
        ),
      )
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInvoking(false)
    }
  }

  return (
    <SpaceBetween size="l">
      <Form
        actions={
          <Button variant="primary" onClick={invoke} loading={invoking} disabled={!canInvoke} data-testid="bedrock-invoke">
            Invoke model
          </Button>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Model">
            <Select
              selectedOption={selectedOption}
              onChange={({ detail }) => setSelectedModelId(detail.selectedOption.value ?? null)}
              options={options}
              filteringType="auto"
              placeholder="Choose a model"
              ariaLabel="Model"
            />
          </FormField>
          <FormField label="System prompt" description="Optional. Sets the model's behaviour for this request.">
            <Textarea value={system} onChange={({ detail }) => setSystem(detail.value)} rows={2} spellcheck={false} />
          </FormField>
          <FormField label="Prompt">
            <Textarea
              value={prompt}
              onChange={({ detail }) => setPrompt(detail.value)}
              rows={6}
              spellcheck={false}
              placeholder="Explain this error message..."
              ariaLabel="Prompt"
            />
          </FormField>
          <ColumnLayout columns={3}>
            <FormField label="Max tokens" description="Blank uses the model default" errorText={maxTokensError}>
              <Input type="number" value={maxTokens} onChange={({ detail }) => setMaxTokens(detail.value)} ariaLabel="Max tokens" />
            </FormField>
            <FormField label="Temperature" description="0 to 1. Blank uses the model default" errorText={temperatureError}>
              <Input type="number" value={temperature} onChange={({ detail }) => setTemperature(detail.value)} ariaLabel="Temperature" />
            </FormField>
            <FormField label="Top P" description="0 to 1. Blank uses the model default" errorText={topPError}>
              <Input type="number" value={topP} onChange={({ detail }) => setTopP(detail.value)} ariaLabel="Top P" />
            </FormField>
          </ColumnLayout>
        </SpaceBetween>
      </Form>

      {error && (
        <Alert type="error" header="Model invocation failed">
          {error}
        </Alert>
      )}
      {result && <ResponsePanel result={result} />}
    </SpaceBetween>
  )
}

// --- Models -----------------------------------------------------------------

function ModelsTab({ models, loading }: { models: BedrockModel[]; loading: boolean }) {
  const { items, filteredItemsCount, collectionProps, filterProps } = useCollection(models, {
    filtering: {
      fields: ['modelId', 'modelName', 'providerName'],
      empty: <Box textAlign="center" color="inherit">No foundation models</Box>,
    },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="modelId"
      loading={loading}
      loadingText="Loading models"
      variant="borderless"
      header={<Header variant="h2" counter={`(${models.length})`}>Foundation models</Header>}
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Find models"
          countText={`${filteredItemsCount ?? models.length} matches`}
        />
      }
      columnDefinitions={[
        { id: 'modelId', header: 'Model ID', cell: (m) => m.modelId, sortingField: 'modelId' },
        { id: 'modelName', header: 'Name', cell: (m) => m.modelName, sortingField: 'modelName' },
        { id: 'providerName', header: 'Provider', cell: (m) => m.providerName, sortingField: 'providerName' },
        { id: 'input', header: 'Input', cell: (m) => m.inputModalities.join(', ') },
        { id: 'output', header: 'Output', cell: (m) => m.outputModalities.join(', ') },
      ]}
    />
  )
}

// --- Browser ----------------------------------------------------------------

export function CloudscapeBedrockBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [activeTab, setActiveTab] = useState('playground')
  const fetcher = useCallback(() => fetchBedrockModels(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<BedrockModelsResponse>(fetcher)

  const models = data?.models ?? []
  const unavailable = !loading && data !== null && !data.available

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load models" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}
      {unavailable && (
        <Alert type="warning" header="Bedrock is not available on this endpoint" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {data?.message}
        </Alert>
      )}
      {!loading && data?.available && models.length === 0 && (
        <Alert type="info" header="No text models found">
          This endpoint reports no foundation models that produce text.
        </Alert>
      )}

      <Tabs
        activeTabId={activeTab}
        onChange={({ detail }) => setActiveTab(detail.activeTabId)}
        tabs={[
          { id: 'playground', label: 'Playground', content: <PlaygroundTab models={models} /> },
          { id: 'models', label: 'Models', content: <ModelsTab models={models} loading={loading} /> },
        ]}
      />
    </SpaceBetween>
  )
}
