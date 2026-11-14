import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import { toast } from 'sonner'
import type { ConnectionCheck, EmulatorInfo, Endpoint, HealthResponse } from '@/lib/types'

/**
 * Emulator profiles in the real pages: the emulator panel and its reset in
 * Settings, the docs link and limits in connection details, and the limits
 * next to the S3 and Lambda actions they affect. Health comes from the
 * (URL-routed) backend, as in the app.
 */

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

const local: Endpoint = {
  name: 'local',
  url: 'http://localhost:4611',
  health: 'healthy',
  active: true,
  connection_type: 'local',
  region: 'us-east-1',
  source: 'env',
  auth_type: 'default',
  tls_verify: true,
  ca_bundle: null,
}

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [local],
    loading: false,
    revision: 0,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import CloudscapeSettings from '@/pages/CloudscapeSettings'
import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

// As backend/emulator_profiles.py reports them
const MINISTACK: EmulatorInfo = {
  id: 'ministack',
  name: 'MiniStack',
  version: '1.5.19',
  profile: { docs_url: 'https://ministack.org/docs/', reset: true, limits: [] },
}
const REQUEST_LIMIT = 'AWS Emulator refuses any request with a body over 16 MiB, so bigger uploads have to go in parts.'
const S3_LIMIT =
  'AWS Emulator keeps objects in memory: at most 64 MiB and 1,000 objects in each bucket, and 128 MiB and 10,000 objects across all buckets.'
const LAMBDA_LIMIT =
  'AWS Emulator runs Python and Node.js functions only. Functions on other runtimes can be created, but invoking them fails.'
const AWS_EMULATOR: EmulatorInfo = {
  id: 'aws-emulator',
  name: 'AWS Emulator',
  version: null,
  tls_trusted: true,
  profile: {
    docs_url: 'https://docs.aws.amazon.com/emulator/latest/userguide/what-is-service.html',
    reset: false,
    limits: [
      { service: null, text: REQUEST_LIMIT },
      { service: 's3', text: S3_LIMIT },
      { service: 'lambda', text: LAMBDA_LIMIT },
    ],
  },
}

function healthWith(emulator: EmulatorInfo | null, changes: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: 'ok',
    version: 'test',
    uptime_seconds: 1,
    endpoint_url: local.url,
    region: 'us-east-1',
    services_count: 51,
    connection_type: 'local',
    writes_enabled: true,
    connection: { credentials_source: 'environment', tls_trust_source: 'system', ca_bundle: null, aws_emulator_dir: null },
    emulator,
    ...changes,
  }
}

const fn = {
  FunctionName: 'process-orders',
  FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:process-orders',
  Runtime: 'java21',
  Role: 'arn:aws:iam::000000000000:role/lambda-role',
  Handler: 'example.Handler::handleRequest',
  CodeSize: 2048,
  Timeout: 30,
  MemorySize: 256,
  LastModified: '2026-01-01T00:00:00Z',
  CodeSha256: 'abc123def456',
  Version: '$LATEST',
  State: 'Active',
}

let health: HealthResponse
let resetResponse: { status: number; payload: unknown }
let testConnectionPayload: ConnectionCheck
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  health = healthWith(MINISTACK)
  resetResponse = {
    status: 200,
    payload: { name: 'local', url: local.url, emulator: { id: 'ministack', name: 'MiniStack' } },
  }
  testConnectionPayload = {
    url: 'https://127.0.0.1:9611',
    health: 'healthy',
    error: null,
    error_detail: null,
    connection: { credentials_source: 'aws-emulator', tls_trust_source: 'aws-emulator', ca_bundle: null, aws_emulator_dir: null },
    emulator: AWS_EMULATOR,
  }
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://stackport.test')
    const method = init?.method ?? 'GET'
    let status = 200
    let payload: unknown = { services: {}, total_resources: 0, uptime_seconds: 1, problem: null }
    if (url.pathname === '/api/health') payload = health
    else if (url.pathname === '/api/endpoints/local/reset' && method === 'POST') ({ status, payload } = resetResponse)
    else if (url.pathname === '/api/endpoints/test-connection') payload = testConnectionPayload
    else if (url.pathname === '/api/profiles') payload = { profiles: [] }
    else if (url.pathname === '/api/s3/upload-config') payload = { max_upload_bytes: 100 * 1024 * 1024 }
    else if (url.pathname === '/api/s3/buckets/app-assets/objects')
      payload = { bucket: 'app-assets', prefix: '', delimiter: '/', folders: [], files: [] }
    else if (url.pathname === '/api/lambda/functions/process-orders')
      payload = { configuration: { ...fn, PackageType: 'Zip' }, code: {}, tags: {} }
    else if (url.pathname.startsWith('/api/lambda/functions/process-orders/')) payload = { eventSourceMappings: [], aliases: [], versions: [] }
    else if (url.pathname === '/api/lambda/functions') payload = { functions: [fn] }
    return Promise.resolve(new Response(JSON.stringify(payload), { status }))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<CloudscapeSettings />} />
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

function resetRequests() {
  return fetchMock.mock.calls.filter(([input]) => new URL(String(input), 'http://stackport.test').pathname.endsWith('/reset'))
}

/** The open modal (the shell keeps a hidden shortcuts modal mounted). */
function visibleModal() {
  const modal = createWrapper()
    .findAllModals()
    .find((m) => m.isVisible())
  if (!modal) throw new Error('no modal open')
  return modal
}

/** The open modal's content, for Cloudscape's finders. */
function openModal() {
  return createWrapper(visibleModal().getElement())
}

async function openResetDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Reset emulator' }))
  await screen.findByText('Reset MiniStack')
  return {
    input: screen.getByLabelText('Endpoint name'),
    confirm: screen.getByTestId('confirm-reset-emulator'),
  }
}

describe('Emulator panel in Settings', () => {
  it('names the emulator with its documentation', async () => {
    renderAt('/settings')
    expect(await screen.findByText('MiniStack 1.5.19')).toBeInTheDocument()
    const docs = screen.getByRole('link', { name: /MiniStack documentation/ })
    expect(docs).toHaveAttribute('href', 'https://ministack.org/docs/')
    expect(docs).toHaveAttribute('target', '_blank')
    expect(screen.getByText('None that StackPort knows of')).toBeInTheDocument()
  })

  it('resets only once the endpoint name is typed exactly', async () => {
    renderAt('/settings')
    const { input, confirm } = await openResetDialog()
    expect(screen.getByText(/deletes everything MiniStack holds at http:\/\/localhost:4611/)).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    for (const attempt of ['loc', 'Local', 'local ', 'MiniStack']) {
      fireEvent.change(input, { target: { value: attempt } })
      expect(confirm).toBeDisabled()
    }
    expect(resetRequests()).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'local' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('MiniStack at local was reset'))
    const [[requested, init]] = resetRequests()
    expect(String(requested)).toBe('/api/endpoints/local/reset')
    expect(init).toEqual({ method: 'POST' })
    await waitFor(() => expect(screen.queryByText('Reset MiniStack')).not.toBeInTheDocument())
  })

  it("keeps the dialog open with the emulator's answer when the reset fails", async () => {
    const detail = 'Floci answered the reset with HTTP 409: reset the external DynamoDB Local instance instead'
    resetResponse = { status: 502, payload: { detail, error: { kind: 'other', message: detail } } }
    renderAt('/settings')
    const { input, confirm } = await openResetDialog()
    fireEvent.change(input, { target: { value: 'local' } })
    fireEvent.click(confirm)

    expect(await screen.findByText(detail)).toBeInTheDocument()
    expect(openModal().findAlert()).toBeTruthy()
    expect(screen.getByText("Couldn't reset MiniStack")).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('offers no reset for an emulator without one, and lists its limits', async () => {
    health = healthWith(AWS_EMULATOR, { endpoint_url: 'https://127.0.0.1:9611' })
    renderAt('/settings')
    expect(await screen.findByText('AWS Emulator')).toBeInTheDocument()
    for (const text of [REQUEST_LIMIT, S3_LIMIT, LAMBDA_LIMIT]) expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset emulator' })).not.toBeInTheDocument()
  })

  it('offers no reset for real AWS or an emulator StackPort does not recognise', async () => {
    health = healthWith(null, { connection_type: 'aws', endpoint_url: null })
    const { unmount } = renderAt('/settings')
    expect(await screen.findByText('This endpoint is real AWS, not an emulator.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset emulator' })).not.toBeInTheDocument()
    unmount()

    health = healthWith(null)
    renderAt('/settings')
    expect(await screen.findByText(/doesn't recognise an emulator at http:\/\/localhost:4611/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset emulator' })).not.toBeInTheDocument()
  })

  it('keeps the reset off in read-only mode', async () => {
    health = healthWith(MINISTACK, { writes_enabled: false })
    renderAt('/settings')
    // Disabled with a reason, so it stays focusable to show why
    const button = await screen.findByRole('button', { name: 'Reset emulator' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    expect(screen.queryByText('Reset MiniStack')).not.toBeInTheDocument()
  })
})

describe('Connection details', () => {
  it("link the emulator's documentation and list its limits", async () => {
    renderAt('/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Add endpoint' }))
    fireEvent.change(await screen.findByPlaceholderText('http://localhost:4566'), { target: { value: 'https://127.0.0.1:9611' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    const modal = openModal()
    await waitFor(() => expect(modal.findStatusIndicator()?.getElement().textContent).toBe('Connected to AWS Emulator'))
    const docs = modal.findLink()!.getElement()
    expect(docs).toHaveAttribute('href', 'https://docs.aws.amazon.com/emulator/latest/userguide/what-is-service.html')
    const text = modal.getElement().textContent
    for (const limit of [REQUEST_LIMIT, S3_LIMIT, LAMBDA_LIMIT]) expect(text).toContain(limit)
  })
})

describe('Limits next to the actions they affect', () => {
  it('shows the S3 limits above the objects, and only those', async () => {
    health = healthWith(AWS_EMULATOR)
    renderAt('/resources/s3?bucket=app-assets')
    expect(await screen.findByText(S3_LIMIT)).toBeInTheDocument()
    expect(screen.queryByText(LAMBDA_LIMIT)).not.toBeInTheDocument()
    expect(screen.queryByText(REQUEST_LIMIT)).not.toBeInTheDocument()
  })

  it('shows nothing above the objects for an emulator without S3 limits', async () => {
    renderAt('/resources/s3?bucket=app-assets')
    expect(await screen.findByText('Empty bucket')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/health'))).toBe(true))
    expect(screen.queryByText(S3_LIMIT)).not.toBeInTheDocument()
  })

  it('shows the Lambda limits when invoking a function and choosing its runtime', async () => {
    health = healthWith(AWS_EMULATOR)
    renderAt('/resources/lambda?function=process-orders')

    fireEvent.click(await screen.findByRole('button', { name: 'Invoke' }))
    expect(await screen.findByText(LAMBDA_LIMIT)).toBeInTheDocument()
    visibleModal().findDismissButton().click()

    fireEvent.click(await screen.findByText('Edit configuration'))
    await screen.findByText('Edit process-orders')
    const runtime = openModal()
      .findAllFormFields()
      .find((field) => field.findLabel()?.getElement().textContent === 'Runtime')
    expect(runtime?.findDescription()?.getElement().textContent).toBe(LAMBDA_LIMIT)
  })

  it('shows no Lambda limits for an emulator without them', async () => {
    renderAt('/resources/lambda?function=process-orders')
    fireEvent.click(await screen.findByRole('button', { name: 'Invoke' }))
    expect(await screen.findByText('Event template')).toBeInTheDocument()
    expect(screen.queryByText(LAMBDA_LIMIT)).not.toBeInTheDocument()
  })
})
