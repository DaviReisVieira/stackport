import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const endpoints = [
  {
    name: 'local',
    url: 'http://localhost:4566',
    health: 'healthy',
    active: true,
    connection_type: 'local',
    region: 'us-east-1',
    source: 'env',
    auth_type: 'default',
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

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/api/endpoints/test-connection')) payload = { url: 'http://localhost:9000', health: 'healthy', error: null }
    else if (url.includes('/api/endpoints/default')) payload = { success: true, default: 'moto', message: 'ok' }
    else if (url.includes('/api/endpoints') && method === 'POST')
      payload = { name: 'new-ep', url: 'http://localhost:9000', source: 'user', region: 'us-east-1', auth_type: 'default' }
    else if (url.includes('/api/endpoints') && method === 'DELETE') payload = {}
    else if (url.includes('/api/endpoints')) payload = { endpoints }
    else if (url.includes('/api/profiles')) payload = { profiles: ['dev', 'prod'] }
    else if (url.includes('/api/health')) payload = healthPayload
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/cloudscape/settings']}>
      <Routes>
        <Route path="/cloudscape/settings" element={<CloudscapeSettings />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderAbout() {
  return render(
    <MemoryRouter initialEntries={['/cloudscape/about']}>
      <Routes>
        <Route path="/cloudscape/about" element={<CloudscapeAbout />} />
      </Routes>
    </MemoryRouter>,
  )
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

  it('adds an endpoint sending the full auth payload', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add endpoint' }))

    const nameInput = await screen.findByPlaceholderText('e.g., local, ministack, prod')
    fireEvent.change(nameInput, { target: { value: 'new-ep' } })
    const urlInput = screen.getByPlaceholderText('http://localhost:4566')
    fireEvent.change(urlInput, { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByTestId('endpoint-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith('/api/endpoints') && (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/endpoints') && (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({
      name: 'new-ep',
      url: 'http://localhost:9000',
      region: null,
      auth_type: 'default',
      auth_profile: null,
      auth_access_key_id: null,
      auth_secret_access_key: null,
    })
    expect(refreshEndpoints).toHaveBeenCalled()
  })

  it('tests a connection before saving', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add endpoint' }))

    const urlInput = await screen.findByPlaceholderText('http://localhost:4566')
    fireEvent.change(urlInput, { target: { value: 'http://localhost:9000' } })
    fireEvent.click(screen.getByTestId('test-connection'))

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/test-connection'))
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.url).toBe('http://localhost:9000')
    expect(body.auth_type).toBe('default')
  })

  it('sets another endpoint as default', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Set moto as default' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/endpoints/default'))
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/endpoints/default'))
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ name: 'moto' })
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
