import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const statsPayload = {
  services: {
    iam: { status: 'available', resources: { users: 2, roles: 1 } },
    s3: { status: 'available', resources: { buckets: 1 } },
  },
  total_resources: 4,
  uptime_seconds: 60,
}

const iamResources = {
  service: 'iam',
  resources: {
    users: [
      { id: 'alice', arn: 'arn:aws:iam::0:user/alice', created: '2026-01-01' },
      { id: 'bob', arn: 'arn:aws:iam::0:user/bob', created: '2026-01-02' },
    ],
    roles: [{ id: 'admin-role', arn: 'arn:aws:iam::0:role/admin-role' }],
  },
}

const aliceDetail = {
  service: 'iam',
  type: 'users',
  id: 'alice',
  detail: { UserName: 'alice', Arn: 'arn:aws:iam::0:user/alice' },
}

function mockFetchByUrl() {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let payload: unknown = statsPayload
    if (url.includes('/api/resources/iam/users/alice')) payload = aliceDetail
    else if (url.includes('/api/resources/iam')) payload = iamResources
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  }) as unknown as typeof fetch
}

function renderBrowser(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/cloudscape/resources" element={<CloudscapeResourceBrowser />} />
        <Route path="/cloudscape/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('CloudscapeResourceBrowser', () => {
  it('shows the service picker when no service is selected', async () => {
    renderBrowser('/cloudscape/resources')
    expect(await screen.findByText('Pick a service')).toBeInTheDocument()
    expect((await screen.findAllByText('iam')).length).toBeGreaterThan(0)
    expect(await screen.findByText('3 resources')).toBeInTheDocument()
  })

  it('renders one tab per resource type with counts', async () => {
    renderBrowser('/cloudscape/resources/iam')
    expect(await screen.findByText('roles (1)')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('users (2)'))
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(await screen.findByText('bob')).toBeInTheDocument()
  })

  it('opens the detail modal with the raw JSON', async () => {
    renderBrowser('/cloudscape/resources/iam')
    fireEvent.click(await screen.findByText('users (2)'))
    fireEvent.click(await screen.findByText('alice'))
    expect(await screen.findByText(/"UserName": "alice"/)).toBeInTheDocument()
  })

  it('offers export and filtering controls', async () => {
    renderBrowser('/cloudscape/resources/iam')
    expect((await screen.findAllByText('Export')).length).toBeGreaterThan(0)
    expect(await screen.findByPlaceholderText('Filter roles')).toBeInTheDocument()
  })
})
