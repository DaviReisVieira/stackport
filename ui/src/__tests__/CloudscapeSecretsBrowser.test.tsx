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

const statsPayload = {
  services: { secretsmanager: { status: 'available', resources: { secrets: 1 } } },
  total_resources: 1,
  uptime_seconds: 60,
}

const secretsPayload = {
  secrets: [
    {
      name: 'db-credentials',
      arn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-credentials',
      description: 'Database login',
      createdDate: '2026-01-01T00:00:00Z',
      lastChangedDate: '2026-02-01T00:00:00Z',
      lastAccessedDate: null,
      rotationEnabled: true,
      tags: { env: 'dev' },
    },
  ],
}

const detailPayload = {
  ...secretsPayload.secrets[0],
  rotationRules: { AutomaticallyAfterDays: 30 },
  rotationLambdaARN: null,
  deletedDate: null,
  versionId: 'v-1',
  versionStages: ['AWSCURRENT'],
  secretValue: '{"user":"admin","password":"hunter2"}',
  secretBinary: null,
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/api/secretsmanager/secrets/db-credentials') && method === 'DELETE') {
      payload = { name: 'db-credentials', arn: 'arn:x', deletionDate: '2026-03-01' }
    } else if (url.includes('/api/secretsmanager/secrets/db-credentials')) {
      payload = detailPayload
    } else if (url.includes('/api/secretsmanager/secrets') && method === 'POST') {
      payload = { name: 'new-secret', arn: 'arn:new', versionId: 'v-1' }
    } else if (url.includes('/api/secretsmanager/secrets')) {
      payload = secretsPayload
    } else if (url.includes('/api/stats')) {
      payload = statsPayload
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderSecrets() {
  return render(
    <MemoryRouter initialEntries={['/cloudscape/resources/secretsmanager']}>
      <Routes>
        <Route path="/cloudscape/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('CloudscapeSecretsManagerBrowser (via registry dispatch)', () => {
  it('lists secrets with rotation status', async () => {
    renderSecrets()
    expect(await screen.findByText('db-credentials')).toBeInTheDocument()
    expect(await screen.findByText('Database login')).toBeInTheDocument()
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
  })

  it('opens the detail, hides the value by default and reveals it as JSON', async () => {
    renderSecrets()
    fireEvent.click(await screen.findByRole('link', { name: 'db-credentials' }))
    expect(await screen.findByText(/arn:aws:secretsmanager/)).toBeInTheDocument()
    expect(await screen.findByText('Every 30 days')).toBeInTheDocument()

    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Show value'))
    expect(await screen.findByText(/hunter2/)).toBeInTheDocument()
    expect(screen.getByText('JSON')).toBeInTheDocument()
  })

  it('deletes with the recovery-window default and force when checked', async () => {
    renderSecrets()
    fireEvent.click(await screen.findByRole('link', { name: 'db-credentials' }))
    fireEvent.click(await screen.findByText('Delete'))
    fireEvent.click(screen.getByText('Force delete immediately (cannot be recovered)'))
    fireEvent.click(await screen.findByTestId('confirm-delete-secret'))

    expect(await screen.findByText('Secrets')).toBeInTheDocument()
    const deleteCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'DELETE')
    expect(deleteCall).toBeTruthy()
    expect(String(deleteCall![0])).toContain('force=true')
  })

  it('creates a secret with the typed value', async () => {
    renderSecrets()
    fireEvent.click(await screen.findByText('Create secret'))
    fireEvent.change(await screen.findByPlaceholderText('my-app/api-key'), { target: { value: 'api-token' } })
    const textareas = screen.getAllByRole('textbox')
    fireEvent.change(textareas[textareas.length - 1], { target: { value: 'sekret' } })
    const buttons = screen.getAllByRole('button', { name: 'Create secret' })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url).includes('/api/secretsmanager/secrets?') && (init as RequestInit)?.method === 'POST',
        ),
      ).toBe(true)
    })
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/secretsmanager/secrets?') && (init as RequestInit)?.method === 'POST',
    )
    expect(createCall).toBeTruthy()
    const body = JSON.parse((createCall![1] as RequestInit).body as string)
    expect(body.name).toBe('api-token')
    expect(body.secretString).toBe('sekret')
  })
})
