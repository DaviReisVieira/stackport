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
  services: { logs: { status: 'available', resources: { log_groups: 1 } } },
  total_resources: 1,
  uptime_seconds: 60,
}

const logGroups = {
  log_groups: [
    {
      name: '/aws/lambda/orders',
      arn: 'arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/orders',
      creation_time: '2026-01-01T00:00:00Z',
      retention_days: 14,
      stored_bytes: 4096,
      metric_filter_count: 0,
    },
  ],
  next_token: null,
}

const logStreams = {
  log_group: '/aws/lambda/orders',
  log_streams: [
    {
      name: '2026/03/01/[$LATEST]abc',
      creation_time: '2026-03-01T00:00:00Z',
      first_event_time: '2026-03-01T10:00:00Z',
      last_event_time: '2026-03-01T10:05:00Z',
      last_ingestion_time: '2026-03-01T10:05:00Z',
      stored_bytes: 2048,
    },
  ],
  next_token: null,
}

const logEvents = {
  events: [
    {
      timestamp: '2026-03-01T10:00:00Z',
      timestamp_millis: 1772359200000,
      message: 'START RequestId: xyz',
      ingestion_time: '2026-03-01T10:00:01Z',
      event_id: 'e1',
    },
    {
      timestamp: '2026-03-01T10:00:02Z',
      timestamp_millis: 1772359202000,
      message: '{"level":"info","msg":"order processed"}',
      ingestion_time: '2026-03-01T10:00:03Z',
      event_id: 'e2',
    },
  ],
  next_token: null,
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/events')) payload = logEvents
    else if (url.includes('/retention')) payload = { name: '/aws/lambda/orders', retention_in_days: 30 }
    else if (url.includes('/streams') && method === 'DELETE') payload = { success: true, message: 'deleted' }
    else if (url.includes('/streams')) payload = logStreams
    else if (url.includes('/api/logs/groups') && method === 'POST') payload = { name: 'new-group', retention_in_days: 7 }
    else if (url.includes('/api/logs/groups') && method === 'DELETE') payload = { success: true, message: 'deleted' }
    else if (url.includes('/api/logs/groups')) payload = logGroups
    else if (url.includes('/api/tags/logs/log_groups')) payload = { tags: { app: 'orders' } }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderLogs(path = '/resources/logs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

describe('CloudscapeLogsBrowser (via registry dispatch)', () => {
  it('lists log groups with retention and size', async () => {
    renderLogs()
    expect(await screen.findByText('/aws/lambda/orders')).toBeInTheDocument()
    expect(await screen.findByText('14d')).toBeInTheDocument()
    expect(await screen.findByText('4 KB')).toBeInTheDocument()
  })

  it('deep-links into a group and stream showing events with JSON detection', async () => {
    renderLogs('/resources/logs?group=%2Faws%2Flambda%2Forders&stream=2026%2F03%2F01%2F%5B%24LATEST%5Dabc')
    expect(await screen.findByText(/START RequestId/)).toBeInTheDocument()
    expect(await screen.findByText('JSON')).toBeInTheDocument()
    expect(await screen.findByText(/"order processed"/)).toBeInTheDocument()

    const eventsCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/events'))
    expect(String(eventsCall![0])).toContain('limit=100')
  })

  it('applies a filter pattern to the events query', async () => {
    renderLogs('/resources/logs?group=%2Faws%2Flambda%2Forders&stream=2026%2F03%2F01%2F%5B%24LATEST%5Dabc')
    await screen.findByText(/START RequestId/)

    fireEvent.click(screen.getByText('Filters'))
    const input = await screen.findByPlaceholderText('Filter pattern (CloudWatch syntax)')
    fireEvent.change(input, { target: { value: 'ERROR' } })
    fireEvent.click(screen.getByTestId('apply-filter'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('filter_pattern=ERROR'))
      expect(call).toBeTruthy()
    })
  })

  it('creates a log group with retention and tags', async () => {
    renderLogs()
    await screen.findByText('/aws/lambda/orders')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const nameInput = await screen.findByPlaceholderText('/aws/lambda/my-function')
    fireEvent.change(nameInput, { target: { value: 'new-group' } })

    const select = createWrapper().findSelect()
    select!.openDropdown()
    select!.selectOptionByValue('7')

    fireEvent.click(screen.getByTestId('create-group-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ name: 'new-group', retentionInDays: 7, tags: {} })
  })

  it('updates retention through the settings modal', async () => {
    renderLogs()
    await screen.findByText('/aws/lambda/orders')
    fireEvent.click(screen.getByRole('button', { name: 'Edit retention for /aws/lambda/orders' }))

    const select = createWrapper().findSelect()
    select!.openDropdown()
    select!.selectOptionByValue('30')
    fireEvent.click(screen.getByTestId('save-retention'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/retention') && (init as RequestInit)?.method === 'PUT',
      )
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/retention') && (init as RequestInit)?.method === 'PUT',
    )
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ retentionInDays: 30 })
  })

  it('requires typing the group name before deleting it', async () => {
    renderLogs()
    await screen.findByText('/aws/lambda/orders')
    fireEvent.click(screen.getByRole('button', { name: 'Delete log group /aws/lambda/orders' }))

    const confirmButton = await screen.findByTestId('confirm-delete-group')
    expect(confirmButton).toBeDisabled()

    const input = screen.getByPlaceholderText('/aws/lambda/orders')
    fireEvent.change(input, { target: { value: '/aws/lambda/orders' } })
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/api/logs/groups/%2Faws%2Flambda%2Forders') && (init as RequestInit)?.method === 'DELETE',
      )
      expect(call).toBeTruthy()
    })
  })

  it('deletes a stream after name confirmation', async () => {
    renderLogs('/resources/logs?group=%2Faws%2Flambda%2Forders')
    await screen.findByText('2026/03/01/[$LATEST]abc')
    fireEvent.click(screen.getByRole('button', { name: 'Delete stream 2026/03/01/[$LATEST]abc' }))

    const input = await screen.findByPlaceholderText('2026/03/01/[$LATEST]abc')
    fireEvent.change(input, { target: { value: '2026/03/01/[$LATEST]abc' } })
    fireEvent.click(screen.getByTestId('confirm-delete-stream'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/streams/') && (init as RequestInit)?.method === 'DELETE',
      )
      expect(call).toBeTruthy()
    })
  })

  it('edits log group tags via the group ARN', async () => {
    renderLogs('/resources/logs?group=%2Faws%2Flambda%2Forders')
    await screen.findByText('2026/03/01/[$LATEST]abc')
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }))

    const valueInput = await screen.findByDisplayValue('orders')
    fireEvent.change(valueInput, { target: { value: 'orders-v2' } })
    fireEvent.click(screen.getByTestId('save-group-tags'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
    expect(String(call![0])).toContain('/api/tags/logs/log_groups/')
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ tags: { app: 'orders-v2' } })
  })
})
