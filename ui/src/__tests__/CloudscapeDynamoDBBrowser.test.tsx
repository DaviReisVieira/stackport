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
  services: { dynamodb: { status: 'available', resources: { tables: 1 } } },
  total_resources: 1,
  uptime_seconds: 60,
}

const tablesPayload = {
  tables: [
    {
      name: 'learners',
      status: 'ACTIVE',
      item_count: 2,
      size_bytes: 2048,
      partition_key: 'id',
      sort_key: null,
      billing_mode: 'PAY_PER_REQUEST',
      created: '2026-01-01T00:00:00Z',
    },
  ],
}

const tableDetail = {
  ...tablesPayload.tables[0],
  partition_key_type: 'S',
  sort_key_type: null,
  attribute_definitions: { id: 'S' },
  key_schema: [{ AttributeName: 'id', KeyType: 'HASH' }],
  global_secondary_indexes: [],
  local_secondary_indexes: [],
}

const scanPayload = {
  table: 'learners',
  items: [
    { id: '1', name: 'Ada', score: 95 },
    { id: '2', name: 'Grace', score: 98 },
  ],
  count: 2,
  scanned_count: 2,
  next_token: null,
}

const queryPayload = {
  table: 'learners',
  items: [{ id: '1', name: 'Ada', score: 95 }],
  count: 1,
  scanned_count: 1,
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/items/batch')) payload = { ok: true, table: 'learners' }
    else if (url.includes('/query')) payload = queryPayload
    else if (url.includes('/items')) payload = method === 'GET' ? scanPayload : { ok: true, table: 'learners' }
    else if (url.includes('/tags')) payload = { tags: {} }
    else if (url.includes('/api/dynamodb/tables/learners')) payload = tableDetail
    else if (url.includes('/api/dynamodb/tables')) payload = tablesPayload
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderDynamo(path = '/resources/dynamodb') {
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

describe('CloudscapeDynamoDBBrowser (via registry dispatch)', () => {
  it('lists tables with keys and billing', async () => {
    renderDynamo()
    expect(await screen.findByText('learners')).toBeInTheDocument()
    expect(await screen.findByText('PAY_PER_REQUEST')).toBeInTheDocument()
    expect(await screen.findByText('2.0 KB')).toBeInTheDocument()
  })

  it('opens the table and scans items', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    expect(await screen.findByText('id (S)')).toBeInTheDocument()
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(await screen.findByText('Grace')).toBeInTheDocument()
  })

  it('runs a query with the typed partition key', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    await screen.findByText('Ada')
    fireEvent.click(screen.getByText('Query'))
    const pkInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(pkInput, { target: { value: '1' } })
    fireEvent.click(screen.getByText('Run query'))

    await waitFor(() => {
      const queryCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/query'))
      expect(queryCall).toBeTruthy()
    })
    const queryCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/query'))
    const body = JSON.parse((queryCall![1] as RequestInit).body as string)
    expect(body.partition_key_value).toBe('1')
  })

  it('creates an item prefilled with the key skeleton and converts formats', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    await screen.findByText('Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

    const textarea = (await screen.findAllByRole('textbox')).find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    expect(textarea.value).toContain('"id"')

    fireEvent.change(textarea, { target: { value: '{"id": "3", "name": "Alan"}' } })
    fireEvent.click(screen.getByText('DynamoDB JSON'))
    await waitFor(() => {
      const updated = (screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement).value
      expect(updated).toContain('"S": "Alan"')
    })

    const buttons = screen.getAllByRole('button', { name: 'Create item' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/items?') && (init as RequestInit)?.method === 'POST',
      )
      expect(postCall).toBeTruthy()
      const body = JSON.parse((postCall![1] as RequestInit).body as string)
      expect(body.item_format).toBe('dynamodb')
      expect(body.item.name.S).toBe('Alan')
    })
  })

  it('batch-deletes selected items', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    await screen.findByText('Ada')

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // select all
    fireEvent.click(screen.getByText(/Delete selected \(2\)/))

    await waitFor(() => {
      const batchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/items/batch'))
      expect(batchCall).toBeTruthy()
    })
    const batchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/items/batch'))
    const body = JSON.parse((batchCall![1] as RequestInit).body as string)
    expect(body.operations).toHaveLength(2)
    expect(body.operations[0].op).toBe('delete')
    expect(body.operations[0].key.id.S).toBe('1')
  })
})
