import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [],
    loading: false,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    data: {
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      endpoint_url: 'http://localhost:4566',
      region: 'us-east-1',
      services_count: 1,
      connection_type: 'local',
      writes_enabled: true,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const HAIKU = 'anthropic.claude-3-haiku-20240307-v1:0'
const SONNET = 'anthropic.claude-3-5-sonnet-20241022-v2:0'

const statsPayload = {
  services: { bedrock: { status: 'available', resources: { foundation_models: 2 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const modelsPayload = {
  available: true,
  message: null,
  models: [
    { modelId: HAIKU, modelName: 'Claude 3 Haiku', providerName: 'Anthropic', inputModalities: ['TEXT', 'IMAGE'], outputModalities: ['TEXT'] },
    { modelId: SONNET, modelName: 'Claude 3.5 Sonnet v2', providerName: 'Anthropic', inputModalities: ['TEXT'], outputModalities: ['TEXT'] },
  ],
}

const converseReply = {
  modelId: HAIKU,
  text: 'Hello from the model',
  stopReason: 'end_turn',
  usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
  latencyMs: 412,
  roundTripMs: 530,
}

let fetchMock: ReturnType<typeof vi.fn>
let models: unknown
let converse: { ok: boolean; status: number; body: unknown }

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let status = 200
    let payload: unknown = statsPayload
    if (url.includes('/api/bedrock/converse')) {
      status = converse.status
      payload = converse.body
    } else if (url.includes('/api/bedrock/models')) payload = models
    return Promise.resolve({
      ok: status < 400,
      status,
      statusText: String(status),
      json: () => Promise.resolve(payload),
    } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderBedrock(path = '/resources/bedrock') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

function converseCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/bedrock/converse'))
}

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
  models = modelsPayload
  converse = { ok: true, status: 200, body: converseReply }
  mockFetchByUrl()
})

describe('CloudscapeBedrockBrowser (via registry dispatch)', () => {
  it('lists the foundation models on the Models tab', async () => {
    renderBedrock()
    fireEvent.click(await screen.findByRole('tab', { name: 'Models' }))

    expect(await screen.findByText(HAIKU)).toBeInTheDocument()
    expect(screen.getByText('Claude 3.5 Sonnet v2')).toBeInTheDocument()
    expect(screen.getAllByText('Anthropic')).toHaveLength(2)
  })

  it('filters the models table', async () => {
    renderBedrock()
    fireEvent.click(await screen.findByRole('tab', { name: 'Models' }))
    await screen.findByText(HAIKU)

    fireEvent.change(screen.getByPlaceholderText('Find models'), { target: { value: 'sonnet' } })

    await waitFor(() => expect(screen.queryByText(HAIKU)).not.toBeInTheDocument())
    expect(screen.getByText(SONNET)).toBeInTheDocument()
  })

  it('invokes the first model with the prompt and shows the reply with its metadata', async () => {
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    typeInto('Prompt', 'Say hi')
    fireEvent.click(await screen.findByTestId('bedrock-invoke'))

    expect(await screen.findByTestId('bedrock-response-text')).toHaveTextContent('Hello from the model')
    expect(screen.getByText('end_turn')).toBeInTheDocument()
    expect(screen.getByText('412 ms')).toBeInTheDocument()
    expect(screen.getByText('530 ms')).toBeInTheDocument()
    expect(screen.getByText('Input tokens').nextElementSibling).toHaveTextContent('7')
    expect(screen.getByText('Output tokens').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Total tokens').nextElementSibling).toHaveTextContent('10')

    expect(converseCalls()).toHaveLength(1)
    const [url, init] = converseCalls()[0]
    expect(String(url)).toContain('endpoint=local')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ modelId: HAIKU, prompt: 'Say hi' })
  })

  it('sends the system prompt and inference settings when they are filled in', async () => {
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    typeInto('System prompt', 'Be terse')
    typeInto('Prompt', 'Say hi')
    typeInto('Max tokens', '64')
    typeInto('Temperature', '0')
    typeInto('Top P', '0.9')
    fireEvent.click(await screen.findByTestId('bedrock-invoke'))

    await screen.findByTestId('bedrock-response-text')
    expect(JSON.parse((converseCalls()[0][1] as RequestInit).body as string)).toEqual({
      modelId: HAIKU,
      prompt: 'Say hi',
      system: 'Be terse',
      maxTokens: 64,
      temperature: 0,
      topP: 0.9,
    })
  })

  it('does not invoke without a prompt or with out-of-range settings', async () => {
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    const invoke = await screen.findByTestId('bedrock-invoke')
    expect(invoke).toBeDisabled()

    typeInto('Prompt', 'Say hi')
    await waitFor(() => expect(screen.getByTestId('bedrock-invoke')).toBeEnabled())

    typeInto('Temperature', '1.5')
    expect(await screen.findByText('Enter a number between 0 and 1')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('bedrock-invoke')).toBeDisabled())

    typeInto('Temperature', '')
    typeInto('Max tokens', '0')
    expect(await screen.findByText('Enter a whole number of at least 1')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('bedrock-invoke')).toBeDisabled())
    expect(converseCalls()).toHaveLength(0)
  })

  it('shows the server error when the invocation fails', async () => {
    converse = { ok: false, status: 429, body: { detail: 'Failed to invoke model: ThrottlingException' } }
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    typeInto('Prompt', 'Say hi')
    fireEvent.click(await screen.findByTestId('bedrock-invoke'))

    expect(await screen.findByText('Model invocation failed')).toBeInTheDocument()
    expect(screen.getByText('Failed to invoke model: ThrottlingException')).toBeInTheDocument()
    expect(screen.queryByTestId('bedrock-response-text')).not.toBeInTheDocument()
  })

  it('warns when Bedrock is not available on the endpoint', async () => {
    models = { available: false, message: 'Unknown service: bedrock', models: [] }
    renderBedrock()

    expect(await screen.findByText('Bedrock is not available on this endpoint')).toBeInTheDocument()
    expect(screen.getByText('Unknown service: bedrock')).toBeInTheDocument()
    expect(await screen.findByTestId('bedrock-invoke')).toBeDisabled()
  })

  it('says so when the endpoint has no text models', async () => {
    models = { available: true, message: null, models: [] }
    renderBedrock()

    expect(await screen.findByText('No text models found')).toBeInTheDocument()
  })
})
