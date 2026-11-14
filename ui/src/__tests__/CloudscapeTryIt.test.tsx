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
      services_count: 2,
      connection_type: 'local',
      writes_enabled: true,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import createWrapper from '@cloudscape-design/components/test-utils/dom'
import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'
import type { TryItFunctionUrlTarget, TryItResponse, TryItStageTarget, TryItTargets } from '@/lib/types'

const statsPayload = {
  services: {
    apigateway: { status: 'available', resources: { rest_apis: 1, apis: 0 } },
    lambda: { status: 'available', resources: { functions: 1 } },
  },
  total_resources: 2,
  uptime_seconds: 60,
}

const restApis = {
  service: 'apigateway',
  resources: { rest_apis: [{ id: 'a1b2c3d4e5', name: 'shop' }], apis: [] },
}

const STAGE_URL = 'http://localhost:4566/_aws/execute-api/a1b2c3d4e5'

const fn = {
  FunctionName: 'echo',
  FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:echo',
  Runtime: 'python3.12',
  Role: 'arn:aws:iam::000000000000:role/lambda-role',
  Handler: 'index.handler',
  CodeSize: 512,
  Timeout: 30,
  MemorySize: 128,
  LastModified: '2026-11-14T00:00:00Z',
  CodeSha256: 'abc',
  Version: '$LATEST',
  State: 'Active',
}

const answer: TryItResponse = {
  request: {
    method: 'POST',
    url: `${STAGE_URL}/prod/orders?expand=items`,
    headers: [
      ['Host', 'localhost:4566'],
      ['X-Trace', 'abc'],
    ],
  },
  status: 201,
  reason: 'Created',
  headers: [
    ['Content-Type', 'application/json'],
    ['Set-Cookie', 'a=1'],
    ['Set-Cookie', 'b=2'],
  ],
  bodyText: '{"id":42,"ok":true}',
  bodyBase64: null,
  bodyBytes: 19,
  truncated: false,
  durationMs: 12.4,
  notices: ['StackPort sets these headers itself, so yours were left out: Host.'],
}

interface Mocks {
  stages: TryItTargets<TryItStageTarget>
  functionUrls: TryItTargets<TryItFunctionUrlTarget>
  send: { status: number; body: unknown }
}

let mocks: Mocks
let fetchMock: ReturnType<typeof vi.fn>

function stages(realAws = false, problem: string | null = null): TryItTargets<TryItStageTarget> {
  return {
    realAws,
    problem,
    targets: [
      { stage: 'dev', url: problem ? null : `${STAGE_URL}/dev` },
      { stage: 'prod', url: problem ? null : `${STAGE_URL}/prod` },
    ],
  }
}

function mockFetch() {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let status = 200
    let payload: unknown = statsPayload
    if (url.includes('/send')) ({ status, body: payload } = mocks.send)
    else if (url.includes('/api/try-it/rest-apis/')) payload = mocks.stages
    else if (url.includes('/api/try-it/functions/')) payload = mocks.functionUrls
    else if (url.includes('/api/tags/supported')) payload = { supported: [] }
    else if (url.includes('/api/resources/apigateway/rest_apis/'))
      payload = { service: 'apigateway', type: 'rest_apis', id: 'a1b2c3d4e5', detail: { id: 'a1b2c3d4e5', name: 'shop' } }
    else if (url.includes('/api/resources/apigateway')) payload = restApis
    else if (url.includes('/aliases')) payload = { aliases: [] }
    else if (url.includes('/versions')) payload = { versions: [] }
    else if (url.includes('/event-sources')) payload = { eventSourceMappings: [] }
    else if (url.includes('/api/lambda/functions/echo'))
      payload = { configuration: { ...fn, PackageType: 'Zip' }, code: { RepositoryType: 'S3' }, tags: {} }
    else if (url.includes('/api/lambda/functions')) payload = { functions: [fn] }
    return Promise.resolve({
      ok: status < 400,
      status,
      statusText: '',
      json: () => Promise.resolve(payload),
    } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function sends() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/send'))
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) }))
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openRestApiTryIt() {
  renderAt('/resources/apigateway')
  fireEvent.click(await screen.findByText('rest_apis (1)'))
  fireEvent.click(await screen.findByRole('link', { name: 'a1b2c3d4e5' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Try it' }))
  return screen.findByRole('button', { name: 'Send' })
}

beforeEach(() => {
  localStorage.clear()
  mocks = {
    stages: stages(),
    functionUrls: {
      realAws: false,
      problem: null,
      targets: [
        {
          qualifier: null,
          functionUrl: 'https://6e14.lambda-url.us-east-1.on.aws/',
          authType: 'NONE',
          url: 'http://localhost:4566/_aws/lambda-url/6e14',
        },
        {
          qualifier: 'live',
          functionUrl: 'https://9f01.lambda-url.us-east-1.on.aws/',
          authType: 'AWS_IAM',
          url: 'http://localhost:4566/_aws/lambda-url/9f01',
        },
      ],
    },
    send: { status: 200, body: answer },
  }
  mockFetch()
})

describe('Try it for an API Gateway stage', () => {
  it('sends the composed request to the picked stage and shows the answer', async () => {
    await openRestApiTryIt()
    const wrapper = createWrapper()
    expect(screen.getByText(`${STAGE_URL}/dev`)).toBeInTheDocument()

    const [stageSelect, methodSelect] = wrapper.findAllSelects()
    stageSelect.openDropdown()
    stageSelect.selectOptionByValue('prod')
    methodSelect.openDropdown()
    methodSelect.selectOptionByValue('POST')
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/orders' } })
    const [querySection, headerSection] = wrapper.findAllExpandableSections()
    querySection.findExpandButton().click()
    headerSection.findExpandButton().click()
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }))
    const editors = wrapper.findAllAttributeEditors()
    const [queryName, queryValue] = editors[0].findRow(1)!.findAll('input')
    fireEvent.change(queryName.getElement(), { target: { value: 'expand' } })
    fireEvent.change(queryValue.getElement(), { target: { value: 'items' } })
    const [headerName, headerValue] = editors[1].findRow(1)!.findAll('input')
    fireEvent.change(headerName.getElement(), { target: { value: 'X-Trace' } })
    fireEvent.change(headerValue.getElement(), { target: { value: 'abc' } })
    fireEvent.change(wrapper.findTextarea()!.findNativeTextarea().getElement(), { target: { value: '{"qty":2}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('201 Created')).toBeInTheDocument()
    expect(sends()).toEqual([
      {
        url: '/api/try-it/rest-apis/a1b2c3d4e5/stages/prod/send?endpoint=local',
        body: {
          method: 'POST',
          path: '/orders',
          query: [{ name: 'expand', value: 'items' }],
          headers: [{ name: 'X-Trace', value: 'abc' }],
          body: '{"qty":2}',
          confirmed: false,
        },
      },
    ])
    // JSON comes back indented
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument()
    expect(screen.getByText('12 ms')).toBeInTheDocument()
    expect(screen.getByText(answer.notices[0])).toBeInTheDocument()

    fireEvent.click(screen.getByText('Headers (3)'))
    expect(screen.getAllByText('Set-Cookie')).toHaveLength(2)
  })

  it('says why a stage has no address, and offers nothing to send', async () => {
    mocks.stages = stages(false, "Moto doesn't serve REST API stages over HTTP, so there's nothing to send a request to.")
    renderAt('/resources/apigateway')
    fireEvent.click(await screen.findByText('rest_apis (1)'))
    fireEvent.click(await screen.findByRole('link', { name: 'a1b2c3d4e5' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Try it' }))

    expect(await screen.findByText(/Moto doesn't serve REST API stages over HTTP/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('asks before sending to AWS', async () => {
    mocks.stages = stages(true)
    await openRestApiTryIt()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Send this request to AWS?')).toBeInTheDocument()
    expect(sends()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Send to AWS' }))

    await waitFor(() => expect(sends()).toHaveLength(1))
    expect(sends()[0].body).toMatchObject({ method: 'GET', path: '/', body: null, confirmed: true })
  })

  it('shows why the request failed', async () => {
    mocks.send = {
      status: 502,
      body: {
        detail: 'StackPort couldn\'t reach http://localhost:4566: the connection was refused.',
        error: { kind: 'unreachable', message: 'refused', hint: 'Check that the emulator is running.' },
      },
    }
    await openRestApiTryIt()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText(/the connection was refused/)).toBeInTheDocument()
    expect(screen.getByText('Check that the emulator is running.')).toBeInTheDocument()
  })
})

describe('Try it for a Lambda function URL', () => {
  async function openFunctionUrlTab() {
    renderAt('/resources/lambda')
    fireEvent.click(await screen.findByRole('link', { name: 'echo' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Function URL' }))
    return screen.findByRole('button', { name: 'Send' })
  }

  it("calls the alias's URL", async () => {
    await openFunctionUrlTab()
    expect(screen.getByText('https://6e14.lambda-url.us-east-1.on.aws/')).toBeInTheDocument()

    const urlSelect = createWrapper().findAllSelects()[0]
    urlSelect.openDropdown()
    urlSelect.selectOptionByValue('live')
    expect(screen.getByText('AWS_IAM')).toBeInTheDocument()
    expect(screen.getByText(/StackPort sends them unsigned/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(sends()).toHaveLength(1))
    expect(sends()[0].url).toBe('/api/try-it/functions/echo/send?qualifier=live&endpoint=local')
    expect(await screen.findByText('201 Created')).toBeInTheDocument()
  })

  it('says when the function has no URL', async () => {
    mocks.functionUrls = { realAws: false, problem: null, targets: [] }
    renderAt('/resources/lambda')
    fireEvent.click(await screen.findByRole('link', { name: 'echo' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Function URL' }))

    expect(await screen.findByText('This function has no function URL.')).toBeInTheDocument()
  })
})
