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

import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const statsPayload = {
  services: {
    elasticfilesystem: {
      status: 'available',
      resources: { file_systems: 2 },
    },
    s3: { status: 'available', resources: { buckets: 1 } },
  },
  total_resources: 3,
  uptime_seconds: 60,
}

const efsResources = {
  service: 'elasticfilesystem',
  resources: {
    file_systems: [
      { id: 'fs-alice', arn: 'arn:aws:elasticfilesystem:0:file-system/fs-alice', created: '2026-01-01' },
      { id: 'fs-bob', arn: 'arn:aws:elasticfilesystem:0:file-system/fs-bob', created: '2026-01-02' },
    ],
  },
}

const aliceDetail = {
  service: 'elasticfilesystem',
  type: 'file_systems',
  id: 'fs-alice',
  detail: { FileSystemId: 'fs-alice', Arn: 'arn:aws:elasticfilesystem:0:file-system/fs-alice' },
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/api/tags/supported'))
      payload = { supported: [{ service: 'elasticfilesystem', type: 'file_systems', writable: true }] }
    else if (url.includes('/api/tags/elasticfilesystem/file_systems/fs-alice') && method === 'PUT')
      payload = { success: true }
    else if (url.includes('/api/tags/elasticfilesystem/file_systems/fs-alice'))
      payload = { tags: { team: 'core' } }
    else if (url.includes('/api/resources/elasticfilesystem/file_systems/fs-alice'))
      payload = aliceDetail
    else if (url.includes('/api/resources/elasticfilesystem')) payload = efsResources
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderBrowser(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources" element={<CloudscapeResourceBrowser />} />
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
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
    renderBrowser('/resources')
    expect(await screen.findByText('Pick a service')).toBeInTheDocument()
    expect((await screen.findAllByText('elasticfilesystem')).length).toBeGreaterThan(0)
    expect(await screen.findByText('2 resources')).toBeInTheDocument()
  })

  it('renders one tab per resource type with counts', async () => {
    renderBrowser('/resources/elasticfilesystem')
    fireEvent.click(await screen.findByText('file_systems (2)'))
    expect(await screen.findByText('fs-alice')).toBeInTheDocument()
    expect(await screen.findByText('fs-bob')).toBeInTheDocument()
  })

  it('opens the detail modal with the raw JSON', async () => {
    renderBrowser('/resources/elasticfilesystem')
    fireEvent.click(await screen.findByText('file_systems (2)'))
    fireEvent.click(await screen.findByText('fs-alice'))
    expect(await screen.findByText(/"FileSystemId": "fs-alice"/)).toBeInTheDocument()
  })

  it('offers export and filtering controls', async () => {
    renderBrowser('/resources/elasticfilesystem')
    expect((await screen.findAllByText('Export')).length).toBeGreaterThan(0)
    expect(await screen.findByPlaceholderText('Filter file_systems')).toBeInTheDocument()
  })

  it('edits tags from the detail modal when the type supports them', async () => {
    renderBrowser('/resources/elasticfilesystem')
    fireEvent.click(await screen.findByText('file_systems (2)'))
    fireEvent.click(await screen.findByText('fs-alice'))
    await screen.findByText(/"FileSystemId": "fs-alice"/)

    const tagsTabs = screen.getAllByRole('tab', { name: 'Tags' })
    fireEvent.click(tagsTabs[tagsTabs.length - 1])

    const valueInput = await screen.findByDisplayValue('core')
    fireEvent.change(valueInput, { target: { value: 'platform' } })
    fireEvent.click(screen.getByTestId('save-resource-tags'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
    expect(String(call![0])).toContain('/api/tags/elasticfilesystem/file_systems/fs-alice')
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ tags: { team: 'platform' } })
  })

  it('navigates rows with j/k and opens the detail with Enter', async () => {
    renderBrowser('/resources/elasticfilesystem')
    fireEvent.click(await screen.findByText('file_systems (2)'))
    await screen.findByText('fs-alice')

    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(document.body, { key: 'k' })
    fireEvent.keyDown(document.body, { key: 'Enter' })

    // first j selects fs-alice (index 0), second j selects fs-bob, k moves back to fs-alice
    expect(await screen.findByText(/"FileSystemId": "fs-alice"/)).toBeInTheDocument()
  })
})
