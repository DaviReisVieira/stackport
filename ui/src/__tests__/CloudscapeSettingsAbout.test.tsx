import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import { toast } from 'sonner'
import type { ConnectionCheck, Endpoint } from '@/lib/types'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const endpoints: Endpoint[] = [
  {
    name: 'local',
    url: 'http://localhost:4566',
    health: 'healthy',
    active: true,
    connection_type: 'local',
    region: 'us-east-1',
    source: 'env',
    auth_type: 'default',
    tls_verify: true,
    ca_bundle: null,
  },
  {
    name: 'moto',
    url: 'http://localhost:5001',
    health: 'unhealthy',
    active: false,
    connection_type: 'local',
    region: 'us-east-1',
    source: 'user',
    auth_type: 'profile',
    tls_verify: true,
    ca_bundle: null,
  },
  {
    name: 'shared',
    url: 'https://emulator.internal:4566',
    health: 'unknown',
    active: false,
    connection_type: 'local',
    region: 'eu-west-1',
    source: 'user',
    auth_type: 'default',
    tls_verify: true,
    ca_bundle: '~/certs/team-ca.pem',
  },
  {
    name: 'lab',
    url: 'https://10.0.0.5:4566',
    health: 'unknown',
    active: false,
    connection_type: 'local',
    region: 'us-east-1',
    source: 'user',
    auth_type: 'default',
    tls_verify: false,
    ca_bundle: null,
  },
  {
    // Saved over plain HTTP with a CA bundle, which nothing uses
    name: 'legacy',
    url: 'http://localhost:4510',
    health: 'unknown',
    active: false,
    connection_type: 'local',
    region: 'us-east-1',
    source: 'user',
    auth_type: 'default',
    tls_verify: true,
    ca_bundle: '~/certs/old-ca.pem',
  },
]

const refreshEndpoints = vi.fn()
const setActiveEndpoint = vi.fn()

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints,
    loading: false,
    setActiveEndpoint,
    refresh: refreshEndpoints,
  }),
}))

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    data: {
      status: 'ok',
      version: '0.3.9',
      uptime_seconds: 3700,
      endpoint_url: 'http://localhost:4566',
      region: 'us-east-1',
      services_count: 35,
      connection_type: 'local',
      writes_enabled: true,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import CloudscapeSettings from '@/pages/CloudscapeSettings'
import CloudscapeAbout from '@/pages/CloudscapeAbout'

const healthPayload = {
  status: 'ok',
  version: '0.3.9',
  uptime_seconds: 3700,
  endpoint_url: 'http://localhost:4566',
  region: 'us-east-1',
  services_count: 35,
  connection_type: 'local',
  writes_enabled: true,
}

const statsPayload = { services: {}, total_resources: 0, uptime_seconds: 60 }

const HEALTHY: ConnectionCheck = {
  url: 'http://localhost:9000',
  health: 'healthy',
  error: null,
  error_detail: null,
  connection: { credentials_source: 'environment', tls_trust_source: 'system', ca_bundle: null, aws_emulator_dir: null },
  emulator: null,
}

const AWS_EMULATOR_HEALTHY: ConnectionCheck = {
  url: 'https://127.0.0.1:9297',
  health: 'healthy',
  error: null,
  error_detail: null,
  connection: {
    credentials_source: 'aws-emulator',
    tls_trust_source: 'aws-emulator',
    ca_bundle: '~/.aws/emulator/9297/ca.pem',
    aws_emulator_dir: '~/.aws/emulator/9297',
  },
  emulator: { id: 'aws-emulator', name: 'AWS Emulator', version: '1.0.0', tls_trusted: true },
}

const TLS_FAILURE: ConnectionCheck = {
  url: 'https://emulator.internal:4566',
  health: 'unhealthy',
  error: "StackPort doesn't trust the endpoint's TLS certificate.",
  error_detail: {
    kind: 'tls',
    message: "StackPort doesn't trust the endpoint's TLS certificate.",
    hint: "For an emulator with a self-signed certificate, set the endpoint's CA bundle in Settings.",
    cause: 'SSL validation failed for https://emulator.internal:4566/ [SSL: CERTIFICATE_VERIFY_FAILED]',
  },
  connection: { credentials_source: 'environment', tls_trust_source: 'system', ca_bundle: null, aws_emulator_dir: null },
  emulator: null,
}

const VERIFICATION_OFF: ConnectionCheck = {
  url: 'https://10.0.0.5:4566',
  health: 'healthy',
  error: null,
  error_detail: null,
  connection: { credentials_source: 'environment', tls_trust_source: 'disabled', ca_bundle: null, aws_emulator_dir: null },
  emulator: { id: 'localstack', name: 'LocalStack', version: null },
}

let fetchMock: ReturnType<typeof vi.fn>
let testConnectionResponse: { ok: boolean; status: number; payload: unknown }

function mockFetchByUrl() {
  testConnectionResponse = { ok: true, status: 200, payload: HEALTHY }
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    let ok = true
    let status = 200
    if (url.includes('/api/endpoints/test-connection')) ({ ok, status, payload } = testConnectionResponse)
    else if (url.includes('/api/endpoints/default')) payload = { success: true, default: 'moto', message: 'ok' }
    else if (url.endsWith('/api/endpoints') && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      payload = { ...body, source: 'user', region: body.region ?? 'us-east-1' }
    } else if (url.includes('/api/endpoints/') && method === 'PUT') {
      const body = JSON.parse(String(init?.body))
      payload = { name: decodeURIComponent(url.split('/').pop() ?? ''), source: 'user', ...body }
    } else if (url.includes('/api/endpoints') && method === 'DELETE') payload = {}
    else if (url.includes('/api/endpoints')) payload = { endpoints }
    else if (url.includes('/api/profiles')) payload = { profiles: ['dev', 'prod'] }
    else if (url.includes('/api/health')) payload = healthPayload
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok, status, statusText: '', json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

/** Body of the first request to a URL ending with `suffix` sent with `method`. */
function requestBody(suffix: string, method: string): unknown {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  )
  if (!call) throw new Error(`no ${method} ${suffix} request`)
  return JSON.parse((call[1] as RequestInit).body as string)
}

function requestsTo(suffix: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix))
}

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<CloudscapeSettings />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderAbout() {
  return render(
    <MemoryRouter initialEntries={['/about']}>
      <Routes>
        <Route path="/about" element={<CloudscapeAbout />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openAddForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add endpoint' }))
  return screen.findByPlaceholderText('e.g., local, ministack, prod')
}

/** The open endpoint form, wrapped for Cloudscape's test utilities. */
function modal() {
  // The shell keeps its (hidden) shortcuts modal mounted, so pick the visible one
  const wrapper = createWrapper()
    .findAllModals()
    .find((m) => m.isVisible())
  if (!wrapper) throw new Error('no modal open')
  return createWrapper(wrapper.getElement())
}

/** The "Connection security" section of the endpoint form, expanded. */
function connectionSecurity() {
  const section = modal()
    .findAllExpandableSections()
    .find((s) => s.findHeaderText()?.getElement().textContent === 'Connection security')
  if (!section) throw new Error('no Connection security section')
  if (!section.findExpandedContent()) section.findExpandButton().click()
  return section
}

/** What the page has announced through polite live regions (Cloudscape's LiveRegion). */
function politeAnnouncements() {
  return Array.from(document.querySelectorAll('[aria-live="polite"]'), (el) => el.textContent ?? '')
}

function caBundleInput() {
  return screen.getByLabelText('CA bundle path') as HTMLInputElement
}

function verifyToggle() {
  const toggle = connectionSecurity().findExpandedContent()?.findToggle()
  if (!toggle) throw new Error('no verify toggle')
  return toggle
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mockFetchByUrl()
})

describe('CloudscapeSettings', () => {
  it('lists endpoints with health, source and default indicator', async () => {
    renderSettings()
    expect((await screen.findAllByText('local')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('moto')).length).toBeGreaterThan(0)
    expect(await screen.findByText('http://localhost:5001')).toBeInTheDocument()
    expect((await screen.findAllByText('Default')).length).toBeGreaterThan(0)
    expect(await screen.findByText('healthy')).toBeInTheDocument()
    expect(await screen.findByText('unhealthy')).toBeInTheDocument()
    expect(await screen.findByText('Environment')).toBeInTheDocument()
  })

  it('flags only the https:// endpoints whose TLS settings differ from the default', async () => {
    renderSettings()
    const table = createWrapper().findTable()!
    await waitFor(() => expect(table.findRows()).toHaveLength(5))
    const urlCell = (row: number) => table.findBodyCell(row, 3)!.getElement().textContent
    expect(urlCell(1)).toBe('http://localhost:4566')
    expect(urlCell(2)).toBe('http://localhost:5001')
    expect(urlCell(3)).toBe('https://emulator.internal:4566Custom CA')
    expect(urlCell(4)).toBe('https://10.0.0.5:4566Verification off')
    expect(urlCell(5)).toBe('http://localhost:4510')
  })

  it('offers TLS settings only for https:// URLs and sends the defaults otherwise', async () => {
    renderSettings()
    fireEvent.change(await openAddForm(), { target: { value: 'switched' } })
    const urlInput = screen.getByPlaceholderText('http://localhost:4566')
    expect(screen.queryByText('Connection security')).not.toBeInTheDocument()

    fireEvent.change(urlInput, { target: { value: 'https://10.0.0.5:4566' } })
    connectionSecurity()
    fireEvent.change(caBundleInput(), { target: { value: '~/certs/lab-ca.pem' } })

    fireEvent.change(urlInput, { target: { value: 'http://10.0.0.5:4566' } })
    expect(screen.queryByText('Connection security')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(requestsTo('/api/endpoints')).toHaveLength(1))
    expect(requestBody('/api/endpoints', 'POST')).toMatchObject({
      url: 'http://10.0.0.5:4566',
      tls_verify: true,
      ca_bundle: null,
    })
  })

  it('resets the TLS settings of a plain http:// endpoint on save', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint legacy' }))
    expect(screen.queryByText('Connection security')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(requestsTo('/api/endpoints/legacy')).toHaveLength(1))
    expect(requestBody('/api/endpoints/legacy', 'PUT')).toMatchObject({ tls_verify: true, ca_bundle: null })
  })

  it('puts the verification toggle before the CA bundle it controls', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint shared' }))
    const toggle = verifyToggle().findNativeInput().getElement()
    expect(toggle.compareDocumentPosition(caBundleInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('adds an endpoint sending the full auth and TLS payload', async () => {
    renderSettings()
    fireEvent.change(await openAddForm(), { target: { value: 'new-ep' } })
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(requestsTo('/api/endpoints')).toHaveLength(1))
    expect(requestBody('/api/endpoints', 'POST')).toEqual({
      name: 'new-ep',
      url: 'http://localhost:9000',
      region: null,
      auth_type: 'default',
      auth_profile: null,
      auth_access_key_id: null,
      auth_secret_access_key: null,
      tls_verify: true,
      ca_bundle: null,
    })
    expect(refreshEndpoints).toHaveBeenCalled()
  })

  it('adds an endpoint that trusts its own CA bundle', async () => {
    renderSettings()
    fireEvent.change(await openAddForm(), { target: { value: 'shared-2' } })
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), {
      target: { value: 'https://emulator.internal:4566' },
    })
    connectionSecurity()
    fireEvent.change(caBundleInput(), { target: { value: '  ~/certs/team-ca.pem  ' } })
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(requestsTo('/api/endpoints')).toHaveLength(1))
    expect(requestBody('/api/endpoints', 'POST')).toMatchObject({
      name: 'shared-2',
      url: 'https://emulator.internal:4566',
      tls_verify: true,
      ca_bundle: '~/certs/team-ca.pem',
    })
  })

  it('never sends a CA bundle while certificate verification is off', async () => {
    renderSettings()
    fireEvent.change(await openAddForm(), { target: { value: 'lab-2' } })
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'https://10.0.0.5:4566' } })
    connectionSecurity()
    fireEvent.change(caBundleInput(), { target: { value: '~/certs/lab-ca.pem' } })

    verifyToggle().findNativeInput().click()
    expect(caBundleInput()).toBeDisabled()
    expect(caBundleInput().value).toBe('~/certs/lab-ca.pem')
    expect(screen.getByText('Not used while certificate verification is off.')).toBeInTheDocument()
    expect(screen.getByText(/StackPort will accept any certificate this endpoint presents/)).toBeInTheDocument()

    testConnectionResponse = { ok: true, status: 200, payload: VERIFICATION_OFF }
    fireEvent.click(screen.getByTestId('test-connection'))
    expect(await screen.findByText('Connected to LocalStack')).toBeInTheDocument()
    // The form already warns about it; the test result doesn't say it a second time
    expect(screen.getAllByText(/accepts? any certificate/)).toHaveLength(1)
    expect(requestBody('/api/endpoints/test-connection', 'POST')).toMatchObject({ tls_verify: false, ca_bundle: null })

    // Turning verification back on brings the bundle back
    verifyToggle().findNativeInput().click()
    expect(caBundleInput()).toBeEnabled()
    fireEvent.click(screen.getByTestId('endpoint-submit'))
    await waitFor(() => expect(requestsTo('/api/endpoints')).toHaveLength(1))
    expect(requestBody('/api/endpoints', 'POST')).toMatchObject({ tls_verify: true, ca_bundle: '~/certs/lab-ca.pem' })
  })

  it('prefills the saved TLS settings when editing and sends them on update', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint shared' }))

    // Opened already, since this endpoint has a CA bundle
    const section = modal().findExpandableSection()!
    expect(section.findExpandedContent()).not.toBeNull()
    expect(caBundleInput().value).toBe('~/certs/team-ca.pem')
    expect(verifyToggle().findNativeInput().getElement()).toBeChecked()

    fireEvent.change(caBundleInput(), { target: { value: '~/certs/team-ca-2026.pem' } })
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(requestsTo('/api/endpoints/shared')).toHaveLength(1))
    expect(requestBody('/api/endpoints/shared', 'PUT')).toEqual({
      url: 'https://emulator.internal:4566',
      region: 'eu-west-1',
      auth_type: 'default',
      auth_profile: null,
      auth_access_key_id: null,
      auth_secret_access_key: null,
      tls_verify: true,
      ca_bundle: '~/certs/team-ca-2026.pem',
    })
  })

  it('prefills verification off when editing an endpoint that has it off', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint lab' }))

    expect(verifyToggle().findNativeInput().getElement()).not.toBeChecked()
    expect(caBundleInput()).toBeDisabled()
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(requestsTo('/api/endpoints/lab')).toHaveLength(1))
    expect(requestBody('/api/endpoints/lab', 'PUT')).toMatchObject({ tls_verify: false, ca_bundle: null })
  })

  it('hides TLS settings for real AWS and resets them on save', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint shared' }))
    expect(screen.getByText('Connection security')).toBeInTheDocument()

    modal().findCheckbox()!.findNativeInput().click()
    expect(screen.queryByText('Connection security')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(requestsTo('/api/endpoints/shared')).toHaveLength(1))
    expect(requestBody('/api/endpoints/shared', 'PUT')).toMatchObject({ url: null, tls_verify: true, ca_bundle: null })
  })

  it('rejects a URL without http:// or https:// before calling the backend', async () => {
    renderSettings()
    fireEvent.change(await openAddForm(), { target: { value: 'typo' } })
    const urlInput = screen.getByPlaceholderText('http://localhost:4566')
    fireEvent.change(urlInput, { target: { value: 'localhost:4566' } })

    fireEvent.click(screen.getByTestId('test-connection'))
    expect(await screen.findByText('The URL must start with http:// or https://.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('endpoint-submit'))
    expect(requestsTo('/api/endpoints/test-connection')).toHaveLength(0)
    expect(requestsTo('/api/endpoints')).toHaveLength(0)

    fireEvent.change(urlInput, { target: { value: '' } })
    expect(screen.getByText('Enter the endpoint URL, for example http://localhost:4566.')).toBeInTheDocument()

    fireEvent.change(urlInput, { target: { value: 'https://localhost:4566' } })
    expect(screen.queryByText(/Enter the endpoint URL|The URL must start/)).not.toBeInTheDocument()
  })

  it('summarises what a healthy AWS Emulator connection uses', async () => {
    testConnectionResponse = { ok: true, status: 200, payload: AWS_EMULATOR_HEALTHY }
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'https://127.0.0.1:9297' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(await screen.findByText('Connected to AWS Emulator 1.0.0')).toBeInTheDocument()
    expect(screen.getByText("AWS Emulator's keys from ~/.aws/emulator/9297")).toBeInTheDocument()
    expect(screen.getByText("AWS Emulator's certificate (~/.aws/emulator/9297/ca.pem)")).toBeInTheDocument()
    expect(requestBody('/api/endpoints/test-connection', 'POST')).toEqual({
      name: 'test',
      url: 'https://127.0.0.1:9297',
      region: null,
      auth_type: 'default',
      auth_profile: null,
      auth_access_key_id: null,
      auth_secret_access_key: null,
      tls_verify: true,
      ca_bundle: null,
    })
  })

  it('names the folder the backend found for an AWS Emulator that runs with authentication off', async () => {
    // In the Compose example StackPort runs as root, so the folder isn't under the user's home
    testConnectionResponse = {
      ok: true,
      status: 200,
      payload: {
        ...AWS_EMULATOR_HEALTHY,
        connection: {
          credentials_source: 'placeholder',
          tls_trust_source: 'aws-emulator',
          ca_bundle: '/root/.aws/emulator/9297/ca.pem',
          aws_emulator_dir: '/root/.aws/emulator/9297',
          aws_emulator_lookup_dir: '/root/.aws/emulator/9297',
        },
      },
    }
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'https://127.0.0.1:9297' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(
      await screen.findByText(
        'Placeholder keys. AWS Emulator runs with authentication off here, so it wrote no keys to /root/.aws/emulator/9297',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("AWS Emulator's certificate (/root/.aws/emulator/9297/ca.pem)")).toBeInTheDocument()
  })

  it('leaves out certificates for a plain http:// endpoint', async () => {
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(
      screen.getByText("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from StackPort's environment"),
    ).toBeInTheDocument()
    expect(screen.queryByText('Certificates')).not.toBeInTheDocument()
  })

  it('explains a TLS failure with its fix and keeps the raw error in the details', async () => {
    testConnectionResponse = { ok: true, status: 200, payload: TLS_FAILURE }
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint shared' }))
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(await screen.findByText('Connection failed')).toBeInTheDocument()
    expect(screen.getByText("StackPort doesn't trust the endpoint's TLS certificate.")).toBeInTheDocument()
    expect(
      screen.getByText("For an emulator with a self-signed certificate, set the endpoint's CA bundle in Settings."),
    ).toBeInTheDocument()

    const details = modal()
      .findAllExpandableSections()
      .find((s) => s.findHeaderText()?.getElement().textContent === 'Details')!
    expect(details.findExpandedContent()).toBeNull()
    details.findExpandButton().click()
    const content = details.findExpandedContent()!.getElement()
    expect(content).toHaveTextContent('SSL validation failed for https://emulator.internal:4566/ [SSL: CERTIFICATE_VERIFY_FAILED]')
    expect(content).toHaveTextContent("The system's trusted certificates")

    expect(requestBody('/api/endpoints/test-connection', 'POST')).toMatchObject({
      name: 'shared',
      url: 'https://emulator.internal:4566',
      region: 'eu-west-1',
      tls_verify: true,
      ca_bundle: '~/certs/team-ca.pem',
    })
  })

  it.each([
    ['healthy', AWS_EMULATOR_HEALTHY, 'Connected to AWS Emulator 1.0.0'],
    ['failed', TLS_FAILURE, "Connection failed StackPort doesn't trust the endpoint's TLS certificate."],
  ])('announces a %s test result to screen readers', async (_case, payload, announcement) => {
    testConnectionResponse = { ok: true, status: 200, payload }
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: payload.url } })
    fireEvent.click(screen.getByTestId('test-connection'))

    await waitFor(() => expect(politeAnnouncements()).toContainEqual(expect.stringContaining(announcement)), {
      timeout: 3000,
    })
  })

  it('announces a test that could not run to screen readers', async () => {
    testConnectionResponse = { ok: false, status: 500, payload: { detail: 'Internal error while testing' } }
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    await waitFor(
      () =>
        expect(politeAnnouncements()).toContainEqual(
          expect.stringContaining("Couldn't test the connection Internal error while testing"),
        ),
      { timeout: 3000 },
    )
  })

  it("asks for the profile before testing an endpoint that uses one, since editing doesn't show it", async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint moto' }))
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Profile name is required')
    expect(requestsTo('/api/endpoints/test-connection')).toHaveLength(0)

    // With the profile picked (from ~/.aws/config, once listed), the test runs with it
    const profile = await waitFor(() => {
      const select = modal().findAllSelects()[1]
      if (!select) throw new Error('profiles not listed yet')
      return select
    })
    profile.openDropdown()
    profile.selectOptionByValue('dev')
    fireEvent.click(screen.getByTestId('test-connection'))
    await waitFor(() => expect(requestsTo('/api/endpoints/test-connection')).toHaveLength(1))
    expect(requestBody('/api/endpoints/test-connection', 'POST')).toMatchObject({
      name: 'moto',
      auth_type: 'profile',
      auth_profile: 'dev',
    })
  })

  it('checks both access keys are filled in before testing with them', async () => {
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'http://localhost:9000' } })
    const auth = modal().findSelect()!
    auth.openDropdown()
    auth.selectOptionByValue('credentials')
    fireEvent.change(screen.getByPlaceholderText('AKIA...'), { target: { value: 'AKIAEXAMPLE' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Both Access Key ID and Secret Access Key are required')
    expect(requestsTo('/api/endpoints/test-connection')).toHaveLength(0)
  })

  it('describes credentials and certificates this UI has no copy for yet', async () => {
    testConnectionResponse = {
      ok: true,
      status: 200,
      payload: {
        ...AWS_EMULATOR_HEALTHY,
        connection: { credentials_source: 'sso-cache', tls_trust_source: 'pinned', ca_bundle: null, aws_emulator_dir: null },
      },
    }
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'https://127.0.0.1:9297' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(await screen.findByText('Connected to AWS Emulator 1.0.0')).toBeInTheDocument()
    expect(screen.getByText('sso-cache')).toBeInTheDocument()
    expect(screen.getByText('pinned')).toBeInTheDocument()
  })

  it('shows why a test could not run at all', async () => {
    testConnectionResponse = { ok: false, status: 500, payload: { detail: 'Internal error while testing' } }
    renderSettings()
    await openAddForm()
    fireEvent.change(screen.getByPlaceholderText('http://localhost:4566'), { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(await screen.findByText("Couldn't test the connection")).toBeInTheDocument()
    expect(screen.getByText('Internal error while testing')).toBeInTheDocument()
  })

  it('drops a test result once the connection settings change', async () => {
    renderSettings()
    await openAddForm()
    const urlInput = screen.getByPlaceholderText('http://localhost:4566')
    fireEvent.change(urlInput, { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByTestId('test-connection'))
    expect(await screen.findByText('Connected')).toBeInTheDocument()

    fireEvent.change(urlInput, { target: { value: 'http://localhost:9001' } })
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('sets another endpoint as default', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Set moto as default' }))

    await waitFor(() => expect(requestsTo('/api/endpoints/default')).toHaveLength(1))
    expect(requestBody('/api/endpoints/default', 'PUT')).toEqual({ name: 'moto' })
    expect(setActiveEndpoint).toHaveBeenCalledWith('moto')
  })

  it('deletes a user endpoint after confirmation and blocks env endpoints', async () => {
    renderSettings()
    expect(await screen.findByRole('button', { name: 'Delete endpoint local' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete endpoint moto' }))
    fireEvent.click(await screen.findByTestId('confirm-delete-endpoint'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/api/endpoints/moto') && (init as RequestInit)?.method === 'DELETE',
      )
      expect(call).toBeTruthy()
    })
  })
})

describe('CloudscapeAbout', () => {
  it('shows project, connection and links information', async () => {
    renderAbout()
    expect(await screen.findByText('0.3.9')).toBeInTheDocument()
    expect(await screen.findByText('Local Emulator')).toBeInTheDocument()
    expect(await screen.findByText('us-east-1')).toBeInTheDocument()
    expect(await screen.findByText('35')).toBeInTheDocument()
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    expect(await screen.findByText('1h 1m')).toBeInTheDocument()
    expect(await screen.findByText('GitHub Repository')).toBeInTheDocument()
    expect(await screen.findByText('Report an Issue')).toBeInTheDocument()
  })
})
