import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import type {
  ExplorerOperation,
  ExplorerRunResponse,
  ExplorerService,
  ExplorerServicesResponse,
  HealthResponse,
  LearnCliSetup,
} from '@/lib/types'

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [],
    loading: false,
    revision: 0,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import CloudscapeApiExplorer from '@/pages/CloudscapeApiExplorer'

const catalog: ExplorerServicesResponse = {
  botocoreVersion: '1.44.3',
  services: [
    { name: 'scheduler', fullName: 'Amazon EventBridge Scheduler' },
    { name: 'sqs', fullName: 'Amazon Simple Queue Service' },
  ],
}

const sqs: ExplorerService = {
  name: 'sqs',
  fullName: 'Amazon Simple Queue Service',
  apiVersion: '2012-11-05',
  protocol: 'json',
  documentation: 'Welcome to the Amazon SQS API Reference.',
  operations: [
    { name: 'CreateQueue', summary: 'Creates a new standard or FIFO queue.', access: 'write', paginated: false, deprecated: false, streaming: false, eventStream: false },
    { name: 'ListQueues', summary: 'Returns a list of your queues in the current region.', access: 'read', paginated: true, deprecated: false, streaming: false, eventStream: false },
    { name: 'ReceiveMessage', summary: 'Retrieves one or more messages.', access: 'write', paginated: false, deprecated: false, streaming: false, eventStream: false },
  ],
}

const createQueue: ExplorerOperation = {
  service: 'sqs',
  name: 'CreateQueue',
  documentation: 'Creates a new standard or FIFO queue. You can pass one or more attributes in the request.',
  access: 'write',
  deprecated: false,
  methodName: 'create_queue',
  cliCommand: 'sqs create-queue',
  cliOptions: { QueueName: '--queue-name', Attributes: '--attributes', tags: '--tags' },
  pagination: null,
  streamingInput: false,
  streamingOutput: false,
  eventStreamInput: false,
  eventStreamOutput: false,
  input: {
    root: 'CreateQueueRequest',
    shapes: {
      CreateQueueRequest: {
        type: 'structure',
        required: ['QueueName'],
        members: [
          { name: 'QueueName', shape: 'String', documentation: 'The name of the new queue. The following limits apply to this name.' },
          { name: 'Attributes', shape: 'QueueAttributeMap', documentation: 'A map of attributes with their corresponding values.' },
          { name: 'tags', shape: 'TagMap', documentation: 'Add cost allocation tags to the specified Amazon SQS queue.' },
        ],
      },
      TagMap: { type: 'map', key: 'TagKey', value: 'TagValue' },
      TagValue: { type: 'string' },
      TagKey: { type: 'string' },
      QueueAttributeMap: { type: 'map', key: 'QueueAttributeName', value: 'String' },
      String: { type: 'string' },
      QueueAttributeName: { type: 'string', enum: ['All', 'Policy', 'VisibilityTimeout', 'DelaySeconds'] },
    },
  },
}

const listQueues: ExplorerOperation = {
  service: 'sqs',
  name: 'ListQueues',
  documentation: 'Returns a list of your queues in the current region.',
  access: 'read',
  deprecated: false,
  methodName: 'list_queues',
  cliCommand: 'sqs list-queues',
  cliOptions: { QueueNamePrefix: '--queue-name-prefix', NextToken: '--next-token', MaxResults: '--max-results' },
  pagination: { inputTokens: ['NextToken'], limitKey: 'MaxResults', resultKeys: ['QueueUrls'] },
  streamingInput: false,
  streamingOutput: false,
  eventStreamInput: false,
  eventStreamOutput: false,
  input: {
    root: 'ListQueuesRequest',
    shapes: {
      ListQueuesRequest: {
        type: 'structure',
        required: [],
        members: [
          { name: 'QueueNamePrefix', shape: 'String', documentation: 'A string to use for filtering the list results.' },
          { name: 'NextToken', shape: 'Token', documentation: 'Pagination token to request the next set of results.' },
          { name: 'MaxResults', shape: 'BoxedInteger', documentation: 'Maximum number of results to include in the response.' },
        ],
      },
      BoxedInteger: { type: 'integer' },
      Token: { type: 'string' },
      String: { type: 'string' },
    },
  },
}

// Scheduler's CreateSchedule, trimmed to its required members: two of them are structures
const createSchedule: ExplorerOperation = {
  service: 'scheduler',
  name: 'CreateSchedule',
  documentation: 'Creates the specified schedule.',
  access: 'write',
  deprecated: false,
  methodName: 'create_schedule',
  cliCommand: 'scheduler create-schedule',
  cliOptions: { Name: '--name', ScheduleExpression: '--schedule-expression', Target: '--target', FlexibleTimeWindow: '--flexible-time-window' },
  pagination: null,
  streamingInput: false,
  streamingOutput: false,
  eventStreamInput: false,
  eventStreamOutput: false,
  input: {
    root: 'CreateScheduleInput',
    shapes: {
      CreateScheduleInput: {
        type: 'structure',
        required: ['Name', 'ScheduleExpression', 'Target', 'FlexibleTimeWindow'],
        members: [
          { name: 'Name', shape: 'Name', documentation: 'The name of the schedule that you are creating.' },
          { name: 'ScheduleExpression', shape: 'ScheduleExpression', documentation: 'The expression that defines when the schedule runs.' },
          { name: 'Target', shape: 'Target', documentation: "The schedule's target." },
          { name: 'FlexibleTimeWindow', shape: 'FlexibleTimeWindow', documentation: 'Allows you to configure a time window.' },
        ],
      },
      Name: { type: 'string', min: 1, max: 64, pattern: '[0-9a-zA-Z-_.]+' },
      ScheduleExpression: { type: 'string', min: 1, max: 256 },
      Target: {
        type: 'structure',
        required: ['Arn', 'RoleArn'],
        members: [
          { name: 'Arn', shape: 'TargetArn' },
          { name: 'RoleArn', shape: 'RoleArn' },
        ],
      },
      TargetArn: { type: 'string', min: 1, max: 1600 },
      RoleArn: { type: 'string', min: 1, max: 1600 },
      FlexibleTimeWindow: {
        type: 'structure',
        required: ['Mode'],
        members: [
          { name: 'Mode', shape: 'FlexibleTimeWindowMode' },
          { name: 'MaximumWindowInMinutes', shape: 'MaximumWindowInMinutes' },
        ],
      },
      FlexibleTimeWindowMode: { type: 'string', enum: ['OFF', 'FLEXIBLE'] },
      MaximumWindowInMinutes: { type: 'integer', min: 1, max: 1440 },
    },
  },
}

const scheduler: ExplorerService = {
  name: 'scheduler',
  fullName: 'Amazon EventBridge Scheduler',
  apiVersion: '2021-06-30',
  protocol: 'rest-json',
  documentation: 'Amazon EventBridge Scheduler is a serverless scheduler.',
  operations: [
    { name: 'CreateSchedule', summary: 'Creates the specified schedule.', access: 'write', paginated: false, deprecated: false, streaming: false, eventStream: false },
  ],
}

// S3's SelectObjectContent answers with a stream of events
const selectObjectContent: ExplorerOperation = {
  ...listQueues,
  service: 's3',
  name: 'SelectObjectContent',
  documentation: 'This action filters the contents of an Amazon S3 object based on a simple SQL statement.',
  methodName: 'select_object_content',
  cliCommand: 's3api select-object-content',
  cliOptions: {},
  pagination: null,
  eventStreamOutput: true,
  input: null,
}

const QUEUE_URL = 'http://localhost:4566/000000000000/orders'

function runResponse(bodies: Record<string, unknown>[], nextToken: Record<string, string> | null = null): ExplorerRunResponse {
  return {
    responses: bodies.map((body, index) => ({
      body: body as ExplorerRunResponse['responses'][number]['body'],
      metadata: { httpStatusCode: 200, requestId: `req-${index + 1}`, retryAttempts: 0 },
    })),
    durationMs: 42.4,
    nextToken,
    notices: [],
  }
}

let health: HealthResponse
let answerHealth: () => Promise<Response>
let answerCatalog: () => Response
let answerService: (service: string) => Response | null
let cliSetup: LearnCliSetup | null
let answerRun: (operation: string, body: unknown) => Response
let fetchMock: ReturnType<typeof vi.fn>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  health = {
    status: 'ok',
    version: 'test',
    uptime_seconds: 1,
    endpoint_url: 'http://localhost:4566',
    region: 'us-east-1',
    services_count: 35,
    connection_type: 'local',
    writes_enabled: true,
    emulator: { id: 'moto', name: 'Moto' },
  }
  answerHealth = () => Promise.resolve(json(health))
  answerCatalog = () => json(catalog)
  answerService = () => null
  cliSetup = null
  answerRun = (operation) =>
    json(operation === 'CreateQueue' ? runResponse([{ QueueUrl: QUEUE_URL }]) : runResponse([{ QueueUrls: [QUEUE_URL] }]))
  const fixtures: Record<string, unknown> = {
    '/api/explorer/services/sqs': sqs,
    '/api/explorer/services/scheduler': scheduler,
    '/api/explorer/services/sqs/operations/CreateQueue': createQueue,
    '/api/explorer/services/sqs/operations/ListQueues': listQueues,
    '/api/explorer/services/scheduler/operations/CreateSchedule': createSchedule,
    '/api/explorer/services/s3/operations/SelectObjectContent': selectObjectContent,
  }
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://stackport.test')
    const path = url.pathname
    if (path === '/api/health') return answerHealth()
    if (path === '/api/stats') return Promise.resolve(json({ services: {}, total_resources: 0, uptime_seconds: 1 }))
    if (path === '/api/explorer/services') return Promise.resolve(answerCatalog())
    if (path === '/api/explorer/cli-setup') return Promise.resolve(json({ cliSetup }))
    const service = path.match(/^\/api\/explorer\/services\/([\w-]+)$/)
    const answered = service ? answerService(service[1]) : null
    if (answered) return Promise.resolve(answered)
    if (path in fixtures) return Promise.resolve(json(fixtures[path]))
    const run = path.match(/^\/api\/explorer\/services\/[\w-]+\/operations\/(\w+)\/run$/)
    if (run && init?.method === 'POST') return Promise.resolve(answerRun(run[1], JSON.parse(String(init.body))))
    return Promise.resolve(json({ detail: 'Not Found' }, 404))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderExplorer(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/explorer"
          element={
            <>
              <CloudscapeApiExplorer />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** Each run the page sent: its URL and parsed JSON body. */
function runRequests() {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).includes('/run') && (init as RequestInit | undefined)?.method === 'POST')
    .map(([input, init]) => ({ url: String(input), body: JSON.parse(String((init as RequestInit).body)) as unknown }))
}

function runButton() {
  return screen.getByRole('button', { name: 'Run' })
}

async function openOperation(path: string, operation: string) {
  renderExplorer(path)
  await screen.findByRole('heading', { name: operation })
  // Health decides whether Run is allowed and whether it asks first, so wait for its answer too
  await screen.findByText(/Requests go to local \(/)
}

function jsonEditor() {
  return screen.getByLabelText('request JSON') as HTMLTextAreaElement
}

/** Type into a text area one character at a time, the way someone would. */
function typeInto(element: HTMLTextAreaElement, text: string, check: (typed: string) => void = () => {}) {
  for (let end = 1; end <= text.length; end++) {
    fireEvent.change(element, { target: { value: text.slice(0, end) } })
    check(text.slice(0, end))
  }
}

describe('API Explorer', () => {
  it('builds a request from the form and posts it to the active endpoint', async () => {
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')

    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: 'orders' } })
    fireEvent.click(screen.getByRole('button', { name: /Optional parameters/ }))
    const attributes = createWrapper().findAttributeEditor()!
    attributes.findAddButton().click()
    attributes.findRow(1)!.findField(1)!.findControl()!.findAutosuggest()!.setInputValue('DelaySeconds')
    attributes.findRow(1)!.findField(2)!.findControl()!.findInput()!.setInputValue('5')
    fireEvent.click(runButton())

    await waitFor(() => expect(runRequests()).toHaveLength(1))
    const [request] = runRequests()
    expect(request.url).toBe('/api/explorer/services/sqs/operations/CreateQueue/run?endpoint=local')
    expect(request.body).toEqual({ params: { QueueName: 'orders', Attributes: { DelaySeconds: '5' } }, paginate: false, maxPages: 10 })

    expect(await screen.findByText(/"QueueUrl": "http:\/\/localhost:4566\/000000000000\/orders"/)).toBeInTheDocument()
    expect(screen.getByText('req-1')).toBeInTheDocument()
    expect(screen.getByText('42 ms')).toBeInTheDocument()

    const [entry] = JSON.parse(localStorage.getItem('stackport:explorer-history') ?? '[]') as { operation: string; params: unknown; status: number }[]
    expect(entry).toMatchObject({ operation: 'CreateQueue', params: { QueueName: 'orders', Attributes: { DelaySeconds: '5' } }, status: 200 })
  })

  it('asks for required parameters before sending anything', async () => {
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    fireEvent.click(runButton())
    expect(await screen.findAllByText('QueueName is required.')).not.toHaveLength(0)
    expect(runRequests()).toHaveLength(0)
  })

  it('runs the request typed in the JSON view, and holds Run while the JSON is broken', async () => {
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    createWrapper().findTabs()!.findTabLinkById('json')!.click()
    const editor = jsonEditor()

    fireEvent.change(editor, { target: { value: '{"QueueName": ' } })
    expect(await screen.findByText(/Not valid JSON/)).toBeInTheDocument()
    expect(editor.value).toBe('{"QueueName": ')
    expect(runButton()).toHaveAttribute('aria-disabled', 'true')

    fireEvent.change(editor, { target: { value: '{"QueueName": "from-json", "tags": {"team": "core"}}' } })
    await waitFor(() => expect(runButton()).not.toHaveAttribute('aria-disabled'))
    fireEvent.click(runButton())
    await waitFor(() => expect(runRequests()).toHaveLength(1))
    expect(runRequests()[0].body).toEqual({ params: { QueueName: 'from-json', tags: { team: 'core' } }, paginate: false, maxPages: 10 })

    // The form shows what the JSON set
    createWrapper().findTabs()!.findTabLinkById('form')!.click()
    expect(screen.getByLabelText('QueueName')).toHaveValue('from-json')
  })

  it('shows the endpoint error inline', async () => {
    answerRun = () =>
      json(
        {
          detail: 'The specified queue does not exist.',
          error: { kind: 'other', message: 'The specified queue does not exist.', code: 'AWS.SimpleQueueService.NonExistentQueue' },
        },
        400,
      )
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: 'orders' } })
    fireEvent.click(runButton())
    await screen.findByText('AWS.SimpleQueueService.NonExistentQueue')
    const alert = createWrapper()
      .findAllAlerts()
      .find((found) => found.findHeader()?.getElement().textContent === 'AWS.SimpleQueueService.NonExistentQueue')
    expect(alert?.findContent().getElement()).toHaveTextContent('The specified queue does not exist.')
    expect(screen.getByText('400')).toBeInTheDocument()
  })

  it('opens an operation from the list and keeps it in the URL', async () => {
    renderExplorer('/explorer?service=sqs')
    const table = await waitFor(() => {
      const found = createWrapper().findTable()
      expect(found?.findRows()).toHaveLength(3)
      return found!
    })
    createWrapper().findSegmentedControl()!.findSegments()[2].click()
    await waitFor(() => expect(table.findRows()).toHaveLength(2))

    createWrapper().findSegmentedControl()!.findSegments()[1].click()
    await waitFor(() => expect(table.findRows()).toHaveLength(1))
    table.findRows()[0].click()

    expect(await screen.findByRole('heading', { name: 'ListQueues' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/explorer?service=sqs&operation=ListQueues')
  })

  it('follows pages and continues from the next token', async () => {
    answerRun = (_operation, body) => {
      const params = (body as { params: Record<string, string> }).params
      return json(
        params.NextToken
          ? runResponse([{ QueueUrls: ['q3'] }])
          : runResponse([{ QueueUrls: ['q1'], NextToken: 't1' }, { QueueUrls: ['q2'], NextToken: 't2' }], { NextToken: 't2' }),
      )
    }
    await openOperation('/explorer?service=sqs&operation=ListQueues', 'ListQueues')
    fireEvent.click(screen.getByText('Follow pages'))
    fireEvent.change(screen.getByLabelText('Most pages to follow'), { target: { value: '2' } })
    fireEvent.click(runButton())

    await waitFor(() => expect(runRequests()).toHaveLength(1))
    expect(runRequests()[0].body).toEqual({ params: {}, paginate: true, maxPages: 2 })
    expect(await screen.findByRole('heading', { name: /Response, page 1 of 2/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fetch next page' }))
    await waitFor(() => expect(runRequests()).toHaveLength(2))
    expect(runRequests()[1].body).toEqual({ params: { NextToken: 't2' }, paginate: true, maxPages: 2 })
  })

  it('shows the same request as an AWS CLI command and boto3 code', async () => {
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: "bob's" } })

    createWrapper().findTabs()!.findTabLinkById('cli')!.click()
    expect(
      await screen.findByText(
        `aws sqs create-queue --cli-input-json '{"QueueName":"bob'\\''s"}' --endpoint-url http://localhost:4566 --region us-east-1`,
      ),
    ).toBeInTheDocument()

    createWrapper().findTabs()!.findTabLinkById('boto3')!.click()
    const code = await screen.findByText(/client\.create_queue/)
    expect(code.textContent).toBe(
      [
        'import boto3',
        '',
        'client = boto3.client("sqs", endpoint_url="http://localhost:4566", region_name="us-east-1")',
        '',
        'response = client.create_queue(',
        `    QueueName="bob's",`,
        ')',
        'print(response)',
      ].join('\n'),
    )
  })

  it('leaves writes visible but not runnable in read-only mode', async () => {
    health = { ...health, writes_enabled: false }
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    await waitFor(() => expect(runButton()).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByText(/only operations that read can run here/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: 'orders' } })
    fireEvent.click(runButton())
    expect(runRequests()).toHaveLength(0)
  })

  it('runs reads in read-only mode', async () => {
    health = { ...health, writes_enabled: false }
    await openOperation('/explorer?service=sqs&operation=ListQueues', 'ListQueues')
    fireEvent.click(runButton())
    await waitFor(() => expect(runRequests()).toHaveLength(1))
  })

  it('asks before a write on real AWS, and not before a read', async () => {
    health = { ...health, connection_type: 'aws', endpoint_url: null, emulator: null }
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: 'orders' } })
    fireEvent.click(runButton())

    expect(await screen.findByText('Run CreateQueue on AWS?')).toBeVisible()
    expect(runRequests()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Run on AWS' }))
    await waitFor(() => expect(runRequests()).toHaveLength(1))
    expect(runRequests()[0].body).toEqual({ params: { QueueName: 'orders' }, paginate: false, maxPages: 10 })
  })

  it('runs a read on real AWS without asking', async () => {
    health = { ...health, connection_type: 'aws', endpoint_url: null, emulator: null }
    await openOperation('/explorer?service=sqs&operation=ListQueues', 'ListQueues')
    fireEvent.click(runButton())
    await waitFor(() => expect(runRequests()).toHaveLength(1))
    expect(createWrapper().findAllModals().filter((modal) => modal.isVisible())).toHaveLength(0)
  })

  it('brings back a request from history', async () => {
    localStorage.setItem(
      'stackport:explorer-history',
      JSON.stringify([{ service: 'sqs', operation: 'CreateQueue', params: { QueueName: 'remembered' }, status: 200, at: '2026-11-13T10:00:00Z' }]),
    )
    renderExplorer('/explorer')
    const history = createWrapper().findButtonDropdown()!
    history.openDropdown()
    history.findItemById('entry-0')!.click()

    await screen.findByRole('heading', { name: 'CreateQueue' })
    expect(screen.getByTestId('location')).toHaveTextContent('/explorer?service=sqs&operation=CreateQueue')
    expect(screen.getByLabelText('QueueName')).toHaveValue('remembered')
  })

  it('keeps a half-typed request in the JSON view, character by character', async () => {
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    createWrapper().findTabs()!.findTabLinkById('json')!.click()
    const editor = jsonEditor()
    expect(editor.value).toBe('')

    typeInto(editor, '{"QueueName": "orders"}', (typed) => expect(editor.value).toBe(typed))
    await waitFor(() => expect(runButton()).not.toHaveAttribute('aria-disabled'))
    fireEvent.click(runButton())
    await waitFor(() => expect(runRequests()).toHaveLength(1))
    expect(runRequests()[0].body).toEqual({ params: { QueueName: 'orders' }, paginate: false, maxPages: 10 })
  })

  it('keeps what the form had while the JSON view is broken', async () => {
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: 'orders' } })
    createWrapper().findTabs()!.findTabLinkById('json')!.click()
    const broken = jsonEditor().value.replace(/}\s*$/, '')
    fireEvent.change(jsonEditor(), { target: { value: broken } })
    expect(jsonEditor().value).toBe(broken)
    expect(runButton()).toHaveAttribute('aria-disabled', 'true')
    expect(runButton()).toHaveAttribute('aria-describedby')

    // The form still has the last request that parsed, and the broken text waits in the JSON view
    createWrapper().findTabs()!.findTabLinkById('form')!.click()
    expect(screen.getByLabelText('QueueName')).toHaveValue('orders')
    createWrapper().findTabs()!.findTabLinkById('json')!.click()
    expect(jsonEditor().value).toBe(broken)
  })

  it('offers an example for an empty request', async () => {
    await openOperation('/explorer?service=sqs&operation=CreateQueue', 'CreateQueue')
    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: 'orders' } })
    createWrapper().findTabs()!.findTabLinkById('json')!.click()
    fireEvent.change(jsonEditor(), { target: { value: '' } })
    expect(jsonEditor().value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Insert example' }))
    expect(JSON.parse(jsonEditor().value)).toEqual({ QueueName: '', Attributes: { All: '' }, tags: { key: '' } })
  })

  it('keeps a broken nested field, and Run blocked, across tabs', async () => {
    await openOperation('/explorer?service=scheduler&operation=CreateSchedule', 'CreateSchedule')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'nightly' } })
    fireEvent.change(screen.getByLabelText('ScheduleExpression'), { target: { value: 'rate(1 day)' } })
    fireEvent.change(screen.getByLabelText('FlexibleTimeWindow'), { target: { value: '{"Mode": "OFF"}' } })
    const half = '{"Arn": "arn:aws:sqs:us-east-1:000000000000:jobs"'
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: half } })
    expect(await screen.findByText(/Not valid JSON/)).toBeInTheDocument()
    expect(runButton()).toHaveAttribute('aria-disabled', 'true')

    createWrapper().findTabs()!.findTabLinkById('cli')!.click()
    expect(runButton()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(runButton())
    expect(runRequests()).toHaveLength(0)

    createWrapper().findTabs()!.findTabLinkById('form')!.click()
    expect(screen.getByLabelText('Target')).toHaveValue(half)
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: `${half}, "RoleArn": "arn:aws:iam::000000000000:role/r"}` } })
    await waitFor(() => expect(runButton()).not.toHaveAttribute('aria-disabled'))
    fireEvent.click(runButton())
    await waitFor(() => expect(runRequests()).toHaveLength(1))
    expect(runRequests()[0].body).toEqual({
      params: {
        Name: 'nightly',
        ScheduleExpression: 'rate(1 day)',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: { Arn: 'arn:aws:sqs:us-east-1:000000000000:jobs', RoleArn: 'arn:aws:iam::000000000000:role/r' },
      },
      paginate: false,
      maxPages: 10,
    })
  })

  it('keeps paging tokens out of the request and out of history', async () => {
    answerRun = (_operation, body) => {
      const params = (body as { params: Record<string, string> }).params
      return json(params.NextToken ? runResponse([{ QueueUrls: ['q2'] }]) : runResponse([{ QueueUrls: ['q1'] }], { NextToken: 't1' }))
    }
    await openOperation('/explorer?service=sqs&operation=ListQueues', 'ListQueues')
    fireEvent.click(runButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch next page' }))
    await waitFor(() => expect(runRequests()).toHaveLength(2))
    expect(runRequests()[1].body).toEqual({ params: { NextToken: 't1' }, paginate: false, maxPages: 10 })
    await screen.findByText(/"q2"/)

    fireEvent.change(screen.getByLabelText('QueueNamePrefix'), { target: { value: 'ord' } })
    fireEvent.click(runButton())
    await waitFor(() => expect(runRequests()).toHaveLength(3))
    expect(runRequests()[2].body).toEqual({ params: { QueueNamePrefix: 'ord' }, paginate: false, maxPages: 10 })
    expect(screen.getByLabelText('NextToken')).toHaveValue('')

    const stored = JSON.parse(localStorage.getItem('stackport:explorer-history') ?? '[]') as { params: unknown }[]
    expect(stored.map((entry) => entry.params)).toEqual([{ QueueNamePrefix: 'ord' }, {}])
  })

  it('opens the operation list on the selected operation', async () => {
    const many = { ...sqs, operations: Array.from({ length: 60 }, (_, i) => ({ ...sqs.operations[1], name: `ListThing${String(i).padStart(2, '0')}` })) }
    answerService = (service) => (service === 'sqs' ? json(many) : null)
    localStorage.setItem(
      'stackport:explorer-history',
      JSON.stringify([{ service: 'sqs', operation: 'ListThing55', params: {}, status: 200, at: '2026-11-13T10:00:00Z' }]),
    )
    renderExplorer('/explorer?service=sqs&operation=ListThing35')
    const rows = () => createWrapper().findTable()!.findRows().map((row) => row.getElement().textContent ?? '')
    await waitFor(() => expect(rows().some((row) => row.includes('ListThing35'))).toBe(true))
    expect(createWrapper().findPagination()!.findCurrentPage().getElement()).toHaveTextContent('2')

    // Paging by hand stays put
    createWrapper().findPagination()!.findPageNumberByIndex(1)!.click()
    await waitFor(() => expect(rows()[0]).toContain('ListThing00'))

    // A request from history on another page opens that page
    const history = createWrapper().findButtonDropdown()!
    history.openDropdown()
    history.findItemById('entry-0')!.click()
    await waitFor(() => expect(rows().some((row) => row.includes('ListThing55'))).toBe(true))
  })

  it('asks before a write while it does not know whether the endpoint is AWS', async () => {
    answerHealth = () => new Promise<Response>(() => {})
    renderExplorer('/explorer?service=sqs&operation=CreateQueue')
    await screen.findByRole('heading', { name: 'CreateQueue' })
    fireEvent.change(screen.getByLabelText('QueueName'), { target: { value: 'orders' } })
    fireEvent.click(runButton())

    expect(await screen.findByText('Run CreateQueue?')).toBeVisible()
    expect(screen.getByText(/hasn't been able to tell whether local is a local emulator or AWS/)).toBeInTheDocument()
    expect(runRequests()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Run anyway' }))
    await waitFor(() => expect(runRequests()).toHaveLength(1))
  })

  it("doesn't point at the AWS CLI for an operation that streams events", async () => {
    await openOperation('/explorer?service=s3&operation=SelectObjectContent', 'SelectObjectContent')
    expect(runButton()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.focus(runButton())
    const reasons = await screen.findAllByText(/answers with a stream of events/)
    for (const reason of reasons) {
      expect(reason).toHaveTextContent("answers with a stream of events, which the API Explorer can't show. Copy it as boto3 code instead.")
    }

    createWrapper().findTabs()!.findTabLinkById('cli')!.click()
    expect(await screen.findByText("The AWS CLI doesn't run operations that stream events.")).toBeInTheDocument()
    createWrapper().findTabs()!.findTabLinkById('boto3')!.click()
    expect(await screen.findByText(/client\.select_object_content/)).toBeInTheDocument()
  })

  it('shows the page count the request will use after a request comes back from history', async () => {
    localStorage.setItem(
      'stackport:explorer-history',
      JSON.stringify([{ service: 'sqs', operation: 'ListQueues', params: { QueueNamePrefix: 'x' }, status: 200, at: '2026-11-13T10:00:00Z' }]),
    )
    await openOperation('/explorer?service=sqs&operation=ListQueues', 'ListQueues')
    fireEvent.click(screen.getByText('Follow pages'))
    fireEvent.change(screen.getByLabelText('Most pages to follow'), { target: { value: '3' } })

    const history = createWrapper().findButtonDropdown()!
    history.openDropdown()
    history.findItemById('entry-0')!.click()
    await waitFor(() => expect(screen.getByLabelText('QueueNamePrefix')).toHaveValue('x'))
    fireEvent.click(screen.getByText('Follow pages'))
    expect(screen.getByLabelText('Most pages to follow')).toHaveValue(10)
    fireEvent.click(runButton())
    await waitFor(() => expect(runRequests()).toHaveLength(1))
    expect(runRequests()[0].body).toEqual({ params: { QueueNamePrefix: 'x' }, paginate: true, maxPages: 10 })
  })

  it("shows the shell setup the endpoint's emulator needs with copied commands", async () => {
    cliSetup = {
      emulator: 'AWS Emulator',
      script: 'export AWS_CA_BUNDLE=~/.aws/emulator/9597/ca.pem\nexport AWS_DISABLE_HOST_PREFIX_INJECTION=true',
      note: null,
    }
    await openOperation('/explorer?service=sqs&operation=ListQueues', 'ListQueues')
    createWrapper().findTabs()!.findTabLinkById('cli')!.click()
    expect(await screen.findByTestId('cli-setup')).toHaveTextContent('export AWS_CA_BUNDLE=~/.aws/emulator/9597/ca.pem')
    createWrapper().findTabs()!.findTabLinkById('boto3')!.click()
    expect(await screen.findByTestId('cli-setup')).toHaveTextContent('AWS Emulator needs a little setup first')
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/explorer/cli-setup?endpoint=local')).toBe(true)
  })

  it('offers to load the services again when they fail to load', async () => {
    answerCatalog = () => json({ detail: 'StackPort is restarting' }, 503)
    renderExplorer('/explorer')
    await screen.findAllByText('StackPort is restarting')
    const select = createWrapper().findSelect()!
    select.openDropdown()
    expect(select.findErrorRecoveryButton()).not.toBeNull()
    answerCatalog = () => json(catalog)
    select.findErrorRecoveryButton()!.click()
    await waitFor(() => expect(select.findDropdown().findOptions()).toHaveLength(2))
  })
})
