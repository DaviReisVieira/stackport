import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'

// What the mocked hooks report; each test can change them before it renders
const env = vi.hoisted(() => ({ endpoint: 'local', connectionType: 'local' }))

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: env.endpoint,
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
      connection_type: env.connectionType,
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

const classified = (kind: string, message: string, hint: string, cause?: string) => ({
  detail: message,
  error: { kind, message, hint, cause },
})

const converseReply = {
  modelId: HAIKU,
  text: 'Hello from the model',
  stopReason: 'end_turn',
  usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
  latencyMs: 412,
  roundTripMs: 530,
}

let fetchMock: ReturnType<typeof vi.fn>
let models: { status: number; body: unknown }
let converse: { ok: boolean; status: number; body: unknown }

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let status = 200
    let payload: unknown = statsPayload
    if (url.includes('/api/bedrock/converse')) {
      status = converse.status
      payload = converse.body
    } else if (url.includes('/api/bedrock/models')) {
      status = models.status
      payload = models.body
    }
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
  env.endpoint = 'local'
  env.connectionType = 'local'
  models = { status: 200, body: modelsPayload }
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
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ modelId: HAIKU, prompt: 'Say hi', maxTokens: 512 })
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

  it('shows the server error and its hint when the invocation fails', async () => {
    converse = {
      ok: false,
      status: 401,
      body: classified(
        'credentials',
        "The endpoint rejected StackPort's credentials (UnrecognizedClientException).",
        'Check the credentials this endpoint uses in Settings.',
      ),
    }
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    typeInto('Prompt', 'Say hi')
    fireEvent.click(await screen.findByTestId('bedrock-invoke'))

    expect(await screen.findByText('Model invocation failed')).toBeInTheDocument()
    expect(screen.getByText("The endpoint rejected StackPort's credentials (UnrecognizedClientException).")).toBeInTheDocument()
    expect(screen.getByText('Check the credentials this endpoint uses in Settings.')).toBeInTheDocument()
    expect(screen.queryByTestId('bedrock-response-text')).not.toBeInTheDocument()
  })

  it('shows a plain server error when it is not classified', async () => {
    converse = { ok: false, status: 429, body: { detail: 'Failed to invoke model: ThrottlingException' } }
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    typeInto('Prompt', 'Say hi')
    fireEvent.click(await screen.findByTestId('bedrock-invoke'))

    expect(await screen.findByText('Failed to invoke model: ThrottlingException')).toBeInTheDocument()
  })

  it('explains an endpoint without Bedrock as information, not a failure', async () => {
    models = {
      status: 501,
      body: classified(
        'not_implemented',
        "This endpoint doesn't implement ListFoundationModels yet.",
        "The endpoint doesn't support this operation.",
      ),
    }
    renderBedrock()

    expect(await screen.findByText('Bedrock is not available on this endpoint')).toBeInTheDocument()
    expect(screen.getByText("This endpoint doesn't implement ListFoundationModels yet.")).toBeInTheDocument()
    expect(screen.getByText("The endpoint doesn't support this operation.")).toBeInTheDocument()
    expect(screen.queryByText('Could not load models')).not.toBeInTheDocument()
    expect(await screen.findByTestId('bedrock-invoke')).toBeDisabled()
  })

  it('shows other model-list failures as errors with their hint', async () => {
    models = {
      status: 401,
      body: classified(
        'credentials',
        "The endpoint rejected StackPort's credentials (UnrecognizedClientException).",
        'Check the credentials this endpoint uses in Settings.',
      ),
    }
    renderBedrock()

    expect(await screen.findByText('Could not load models')).toBeInTheDocument()
    expect(screen.getByText("The endpoint rejected StackPort's credentials (UnrecognizedClientException).")).toBeInTheDocument()
    expect(screen.getByText('Check the credentials this endpoint uses in Settings.')).toBeInTheDocument()
    expect(screen.queryByText('Bedrock is not available on this endpoint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('says so when the endpoint has no text models', async () => {
    models = { status: 200, body: { models: [] } }
    renderBedrock()

    expect(await screen.findByText('No text models found')).toBeInTheDocument()
  })

  it('warns that invoking is billed only when connected to real AWS', async () => {
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    await screen.findByTestId('bedrock-invoke')
    expect(screen.queryByTestId('bedrock-billing-notice')).not.toBeInTheDocument()
  })

  it('shows the billing notice next to Invoke on real AWS', async () => {
    env.connectionType = 'aws'
    renderBedrock()

    expect(await screen.findByTestId('bedrock-billing-notice')).toHaveTextContent(
      'This runs the model on your AWS account and is billed per token.',
    )
  })

  it('starts max tokens at 512 and lets it be cleared for the model default', async () => {
    renderBedrock()
    await screen.findByRole('tab', { name: 'Playground' })
    expect(screen.getByLabelText('Max tokens')).toHaveValue(512)

    typeInto('Prompt', 'Say hi')
    typeInto('Max tokens', '')
    fireEvent.click(await screen.findByTestId('bedrock-invoke'))
    await screen.findByTestId('bedrock-response-text')

    expect(JSON.parse((converseCalls()[0][1] as RequestInit).body as string)).toEqual({ modelId: HAIKU, prompt: 'Say hi' })
  })

  describe('switching endpoints', () => {
    const OTHER = 'meta.llama3-8b-instruct-v1:0'

    async function pickSonnetAndInvoke() {
      const view = renderBedrock()
      await screen.findByRole('tab', { name: 'Playground' })
      const select = createWrapper(view.container).findSelect()!
      await waitFor(() => expect(select.findTrigger()).toBeTruthy())
      select.openDropdown()
      select.selectOptionByValue(SONNET)
      typeInto('Prompt', 'Say hi')
      fireEvent.click(await screen.findByTestId('bedrock-invoke'))
      await screen.findByTestId('bedrock-response-text')
      return view
    }

    function switchTo(view: ReturnType<typeof renderBedrock>, endpoint: string) {
      env.endpoint = endpoint
      models = {
        status: 200,
        body: {
          models: [{ modelId: OTHER, modelName: 'Llama 3 8B', providerName: 'Meta', inputModalities: ['TEXT'], outputModalities: ['TEXT'] }],
        },
      }
      view.rerender(
        <MemoryRouter initialEntries={['/resources/bedrock']}>
          <Routes>
            <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
          </Routes>
        </MemoryRouter>,
      )
    }

    it('sends the model the new endpoint lists, not the one picked on the old endpoint', async () => {
      const view = await pickSonnetAndInvoke()
      expect(JSON.parse((converseCalls()[0][1] as RequestInit).body as string).modelId).toBe(SONNET)

      switchTo(view, 'other')
      await waitFor(() => expect(createWrapper(view.container).findSelect()!.findTrigger().getElement()).toHaveTextContent('Llama 3 8B'))
      fireEvent.click(await screen.findByTestId('bedrock-invoke'))

      await waitFor(() => expect(converseCalls()).toHaveLength(2))
      expect(JSON.parse((converseCalls()[1][1] as RequestInit).body as string).modelId).toBe(OTHER)
    })

    it('clears the previous reply', async () => {
      const view = await pickSonnetAndInvoke()

      switchTo(view, 'other')

      await waitFor(() => expect(screen.queryByTestId('bedrock-response-text')).not.toBeInTheDocument())
    })
  })
})
