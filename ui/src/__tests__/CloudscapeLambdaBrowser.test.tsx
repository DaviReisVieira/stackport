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

import createWrapper from '@cloudscape-design/components/test-utils/dom'
import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const statsPayload = {
  services: { lambda: { status: 'available', resources: { functions: 1 } } },
  total_resources: 1,
  uptime_seconds: 60,
}

const fn = {
  FunctionName: 'process-orders',
  FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:process-orders',
  Runtime: 'python3.12',
  Role: 'arn:aws:iam::000000000000:role/lambda-role',
  Handler: 'app.handler',
  CodeSize: 2048,
  Description: 'Processes orders',
  Timeout: 30,
  MemorySize: 256,
  LastModified: '2026-01-01T00:00:00Z',
  CodeSha256: 'abc123def456',
  Version: '$LATEST',
  State: 'Active',
}

const detailPayload = {
  configuration: {
    ...fn,
    Environment: { Variables: { STAGE: 'dev' } },
    Architectures: ['x86_64'],
    PackageType: 'Zip',
  },
  code: { RepositoryType: 'S3', Location: 'http://x' },
  tags: { team: 'backend' },
}

const invokeResponse = {
  statusCode: 200,
  executedVersion: '$LATEST',
  payload: { ok: true },
  logs: 'START RequestId xyz\nEND RequestId xyz',
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/invoke')) payload = invokeResponse
    else if (url.includes('/configuration') && method === 'PATCH') payload = { configuration: fn }
    else if (url.includes('/event-sources')) payload = { eventSourceMappings: [] }
    else if (url.includes('/aliases')) payload = { aliases: [{ AliasArn: 'arn:a', Name: 'prod', FunctionVersion: '1', RevisionId: 'r1' }] }
    else if (url.includes('/versions')) payload = { versions: [{ ...fn, Version: '1' }] }
    else if (url.includes('/api/lambda/functions/process-orders')) payload = detailPayload
    else if (url.includes('/api/lambda/functions')) payload = { functions: [fn] }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderLambda() {
  return render(
    <MemoryRouter initialEntries={['/resources/lambda']}>
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

describe('CloudscapeLambdaBrowser (via registry dispatch)', () => {
  it('lists functions with runtime, memory and state', async () => {
    renderLambda()
    expect(await screen.findByText('process-orders')).toBeInTheDocument()
    expect(await screen.findByText('python3.12')).toBeInTheDocument()
    expect(await screen.findByText('256 MB')).toBeInTheDocument()
    expect(await screen.findByText('Active')).toBeInTheDocument()
  })

  it('shows the configuration panel with env vars and layers info', async () => {
    renderLambda()
    fireEvent.click(await screen.findByRole('link', { name: 'process-orders' }))
    expect(await screen.findByText('app.handler')).toBeInTheDocument()
    expect(await screen.findByText('STAGE')).toBeInTheDocument()
    expect(await screen.findByText('dev')).toBeInTheDocument()
    expect(screen.getByText(/arn:aws:iam/)).toBeInTheDocument()
  })

  it('invokes with a template payload and renders the result with logs', async () => {
    renderLambda()
    fireEvent.click(await screen.findByRole('link', { name: 'process-orders' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Invoke' }))

    // apply the SQS template via Cloudscape test-utils
    await screen.findByText('Event template')
    const select = createWrapper().findSelect()
    select!.openDropdown()
    select!.selectOptionByValue('SQS')
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    expect(textarea.value).toContain('test-message-id')

    fireEvent.click(screen.getByTestId('invoke-run'))
    expect(await screen.findByText('Status 200')).toBeInTheDocument()
    expect(await screen.findByText(/START RequestId/)).toBeInTheDocument()

    const invokeCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/invoke'))
    const body = JSON.parse((invokeCall![1] as RequestInit).body as string)
    expect(body.payload.Records[0].messageId).toBe('test-message-id')
  })

  it('edits configuration sending only changed fields', async () => {
    renderLambda()
    fireEvent.click(await screen.findByRole('link', { name: 'process-orders' }))
    fireEvent.click(await screen.findByText('Edit configuration'))

    const memoryInput = (await screen.findAllByRole('spinbutton'))[0]
    fireEvent.change(memoryInput, { target: { value: '512' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
    })
    const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH')
    const body = JSON.parse((patchCall![1] as RequestInit).body as string)
    expect(body).toEqual({ memorySize: 512 })
  })

  it('loads aliases and versions in their tab', async () => {
    renderLambda()
    fireEvent.click(await screen.findByRole('link', { name: 'process-orders' }))
    fireEvent.click(await screen.findByText('Aliases & Versions'))
    expect(await screen.findByText('prod')).toBeInTheDocument()
    expect(await screen.findByText('abc123def456...')).toBeInTheDocument()
  })
})
