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

const MACHINE_ARN = 'arn:aws:states:us-east-1:000000000000:stateMachine:order-flow'
const EXECUTION_ARN = 'arn:aws:states:us-east-1:000000000000:execution:order-flow:run-1'

const statsPayload = {
  services: { stepfunctions: { status: 'available', resources: { state_machines: 1 } } },
  total_resources: 1,
  uptime_seconds: 60,
}

const machine = {
  name: 'order-flow',
  stateMachineArn: MACHINE_ARN,
  type: 'STANDARD',
  status: 'ACTIVE',
  creationDate: '2026-01-01T00:00:00Z',
}

const definition = {
  StartAt: 'Validate',
  States: {
    Validate: { Type: 'Task', Resource: 'arn:aws:lambda:::function:validate', Next: 'Done' },
    Done: { Type: 'Succeed' },
  },
}

const machineDetail = {
  ...machine,
  definition,
  roleArn: 'arn:aws:iam::000000000000:role/sfn-role',
  loggingConfiguration: { level: 'ALL', includeExecutionData: true },
}

const executions = {
  executions: [
    {
      executionArn: EXECUTION_ARN,
      stateMachineArn: MACHINE_ARN,
      name: 'run-1',
      status: 'SUCCEEDED',
      startDate: '2026-03-01T10:00:00Z',
      stopDate: '2026-03-01T10:00:05Z',
    },
  ],
}

const executionDetail = {
  executionArn: EXECUTION_ARN,
  stateMachineArn: MACHINE_ARN,
  name: 'run-1',
  status: 'SUCCEEDED',
  startDate: '2026-03-01T10:00:00Z',
  stopDate: '2026-03-01T10:00:05Z',
  input: { orderId: 42 },
  output: { ok: true },
}

const executionHistory = {
  events: [
    {
      id: 1,
      type: 'TaskStateEntered',
      timestamp: '2026-03-01T10:00:00Z',
      stateEnteredEventDetails: { name: 'Validate', input: '{"orderId":42}' },
    },
    {
      id: 2,
      type: 'TaskStateExited',
      timestamp: '2026-03-01T10:00:03Z',
      stateExitedEventDetails: { name: 'Validate', output: '{"valid":true}' },
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/history')) payload = executionHistory
    else if (url.includes('/stop')) payload = { stopDate: '2026-03-01T10:00:06Z' }
    else if (url.includes('/api/stepfunctions/executions/')) payload = executionDetail
    else if (url.includes('/executions') && method === 'POST')
      payload = { executionArn: EXECUTION_ARN, startDate: '2026-03-01T10:00:00Z' }
    else if (url.includes('/executions')) payload = executions
    else if (url.includes('/api/stepfunctions/state-machines/')) payload = machineDetail
    else if (url.includes('/api/stepfunctions/state-machines')) payload = { stateMachines: [machine] }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderSFN(path = '/resources/stepfunctions') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('CloudscapeStepFunctionsBrowser (via registry dispatch)', () => {
  it('lists state machines with type and creation date', async () => {
    renderSFN()
    expect(await screen.findByText('order-flow')).toBeInTheDocument()
    expect(await screen.findByText('STANDARD')).toBeInTheDocument()
    expect(await screen.findByText('ACTIVE')).toBeInTheDocument()
  })

  it('opens the machine detail with executions and status filter', async () => {
    renderSFN(`/resources/stepfunctions?machine=${encodeURIComponent(MACHINE_ARN)}`)
    expect(await screen.findByText('Executions (1)')).toBeInTheDocument()
    expect(await screen.findByText('run-1')).toBeInTheDocument()
    expect(await screen.findByText('SUCCEEDED')).toBeInTheDocument()
    expect(await screen.findByText(MACHINE_ARN)).toBeInTheDocument()
  })

  it('renders the definition tab with the state machine graph and JSON', async () => {
    renderSFN(`/resources/stepfunctions?machine=${encodeURIComponent(MACHINE_ARN)}`)
    await screen.findByText('run-1')
    fireEvent.click(screen.getByRole('tab', { name: 'Definition' }))

    // graph nodes render lazily from the shared SVG component
    expect(await screen.findByText('Validate')).toBeInTheDocument()
    // the raw JSON shows the resource ARN
    expect(await screen.findByText(/arn:aws:lambda:::function:validate/)).toBeInTheDocument()
  })

  it('starts an execution with a JSON payload', async () => {
    renderSFN(`/resources/stepfunctions?machine=${encodeURIComponent(MACHINE_ARN)}`)
    await screen.findByText('run-1')
    fireEvent.click(screen.getByRole('button', { name: 'Start execution' }))

    const nameInput = await screen.findByPlaceholderText('my-execution')
    fireEvent.change(nameInput, { target: { value: 'manual-run' } })
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '{"orderId": 7}' } })
    fireEvent.click(screen.getByTestId('start-execution-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ name: 'manual-run', input: { orderId: 7 } })
  })

  it('rejects invalid JSON input before sending anything', async () => {
    renderSFN(`/resources/stepfunctions?machine=${encodeURIComponent(MACHINE_ARN)}`)
    await screen.findByText('run-1')
    fireEvent.click(screen.getByRole('button', { name: 'Start execution' }))

    const textarea = (await screen.findAllByRole('textbox')).find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '{not json' } })
    fireEvent.click(screen.getByTestId('start-execution-submit'))

    expect(await screen.findByText('Input must be valid JSON')).toBeInTheDocument()
    expect(fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')).toBeFalsy()
  })

  it('opens the execution detail with input, output, graph trace and timeline', async () => {
    renderSFN(`/resources/stepfunctions?machine=${encodeURIComponent(MACHINE_ARN)}`)
    fireEvent.click(await screen.findByRole('link', { name: 'run-1' }))

    expect(await screen.findByText(/"orderId": 42/)).toBeInTheDocument()
    expect(await screen.findByText(/"ok": true/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(await screen.findByText('Validate')).toBeInTheDocument()

    const historyCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/history'))
    expect(String(historyCall![0])).toContain('max_results=100')
  })
})
