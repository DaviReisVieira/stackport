import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import { EndpointProvider } from '@/contexts/EndpointContext'
import CloudscapeSettings from '@/pages/CloudscapeSettings'
import type { ConnectionDescription, Endpoint, HealthResponse } from '@/lib/types'

/**
 * The real EndpointProvider, Settings page, and health hook together: what the
 * shell says about the active endpoint has to follow its saved settings.
 */

const lab: Endpoint = {
  name: 'lab',
  url: 'https://10.0.0.5:4566',
  health: 'unknown',
  active: true,
  connection_type: 'local',
  region: 'us-east-1',
  source: 'user',
  auth_type: 'default',
  tls_verify: true,
  ca_bundle: null,
}

const SYSTEM_TRUST: ConnectionDescription = {
  credentials_source: 'environment',
  tls_trust_source: 'system',
  ca_bundle: null,
  aws_emulator_dir: null,
}

function healthFor(trusted: boolean): HealthResponse {
  return {
    status: 'ok',
    version: 'test',
    uptime_seconds: 1,
    endpoint_url: lab.url,
    region: 'us-east-1',
    services_count: 35,
    connection_type: 'local',
    writes_enabled: true,
    connection: trusted
      ? { ...SYSTEM_TRUST, tls_trust_source: 'endpoint', ca_bundle: '~/certs/lab-ca.pem' }
      : SYSTEM_TRUST,
    emulator: { id: 'localstack', name: 'LocalStack', tls_trusted: trusted },
  }
}

/** Stands in for the browser WebSocket so tests can push the backend's endpoint events. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor() {
    FakeWebSocket.instances.push(this)
  }

  send() {}

  close() {
    this.readyState = 3
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

const dev: Endpoint = { ...lab, name: 'dev', url: 'http://localhost:4566', active: false }

let health: HealthResponse
let saved: Endpoint[]
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  health = healthFor(false)
  saved = [lab]
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://stackport.test')
    const method = init?.method ?? 'GET'
    let payload: unknown = { services: {}, total_resources: 0, uptime_seconds: 1, problem: null }
    if (url.pathname === '/api/health') payload = health
    else if (url.pathname === '/api/endpoints' && method === 'GET') payload = { endpoints: saved }
    else if (url.pathname === '/api/endpoints/default' && method === 'PUT') {
      const { name } = JSON.parse(String(init?.body)) as { name: string }
      saved = saved.map((endpoint) => ({ ...endpoint, active: endpoint.name === name }))
      payload = { success: true, default: name, message: `Default endpoint set to ${name}` }
    } else if (url.pathname === '/api/endpoints/lab' && method === 'PUT') {
      payload = { ...lab, ...JSON.parse(String(init?.body)) }
      // The backend now trusts the emulator with the bundle that was just saved
      health = healthFor(true)
    } else if (url.pathname === '/api/profiles') payload = { profiles: [] }
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function healthRequests(endpoint?: string) {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = new URL(String(input), 'http://stackport.test')
    return url.pathname === '/api/health' && (endpoint === undefined || url.searchParams.get('endpoint') === endpoint)
  }).length
}

function certificateWarning() {
  return createWrapper().findFlashbar()?.findItemById('tls-untrusted') ?? null
}

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <EndpointProvider>
        <Routes>
          <Route path="/settings" element={<CloudscapeSettings />} />
        </Routes>
      </EndpointProvider>
    </MemoryRouter>,
  )
}

describe('health follows the saved endpoint settings', () => {
  it('drops the certificate warning as soon as the endpoint is saved with a CA bundle that works', async () => {
    renderSettings()
    await waitFor(() => expect(certificateWarning()).not.toBeNull())

    fireEvent.click(await screen.findByRole('button', { name: 'Edit endpoint lab' }))
    fireEvent.change(screen.getByLabelText('CA bundle path'), { target: { value: '~/certs/lab-ca.pem' } })
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => expect(certificateWarning()).toBeNull())
    expect(healthRequests()).toBeGreaterThan(1)
  })

  it('looks again when the backend says the endpoints changed elsewhere', async () => {
    renderSettings()
    await waitFor(() => expect(certificateWarning()).not.toBeNull())
    const requestsBefore = healthRequests()

    health = healthFor(true)
    act(() => {
      FakeWebSocket.instances.forEach((socket) => socket.emit({ type: 'endpoints_changed' }))
    })

    await waitFor(() => expect(certificateWarning()).toBeNull())
    expect(healthRequests()).toBeGreaterThan(requestsBefore)
  })

  it('asks for the new default endpoint\'s health once when Set default switches to it', async () => {
    // Each part of the page that reads health asks for it: the shell and the emulator panel
    const readers = 2
    saved = [lab, dev]
    renderSettings()
    await waitFor(() => expect(healthRequests('lab')).toBe(readers))

    // Switches the active endpoint and reloads the saved ones in the same render
    fireEvent.click(await screen.findByRole('button', { name: 'Set dev as default' }))
    await waitFor(() => expect(healthRequests('dev')).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set lab as default' })).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/endpoints/default', expect.objectContaining({ method: 'PUT', body: '{"name":"dev"}' }))
    expect(healthRequests('dev')).toBe(readers)
    expect(healthRequests('lab')).toBe(readers)
  })
})
