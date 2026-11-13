import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

/** What health says the active endpoint is; reset to a local emulator before each test. */
let connectionType: 'local' | 'aws' = 'local'

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    data: {
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      endpoint_url: 'http://localhost:4566',
      region: 'us-east-1',
      services_count: 1,
      connection_type: connectionType,
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
    { id: { S: '1' }, name: { S: 'Ada' }, score: { N: '95' }, tags: { SS: ['a', 'b'] } },
    { id: { S: '2' }, name: { S: 'Grace' }, score: { N: '98' } },
  ],
  count: 2,
  scanned_count: 2,
  next_token: null,
}

const queryPayload = {
  table: 'learners',
  items: [{ id: { S: '1' }, name: { S: 'Ada' }, score: { N: '95' } }],
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
    else if (url.includes('/item-count')) payload = { table: 'learners', count: 5 }
    else if (url.includes('/query')) payload = queryPayload
    else if (url.includes('/items')) payload = method === 'GET' ? scanPayload : { ok: true, table: 'learners' }
    else if (url.includes('/tags')) payload = { tags: { team: 'data' } }
    else if (url.includes('/api/dynamodb/tables/learners')) payload = tableDetail
    else if (url.includes('/api/dynamodb/tables')) payload = tablesPayload
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

/** Answer requests whose URL contains `fragment` with an error, the rest as before. */
function failFor(fragment: string, status: number, detail: string) {
  const answer = globalThis.fetch
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes(fragment)
      ? Promise.resolve({ ok: false, status, statusText: '', json: () => Promise.resolve({ detail }) } as Response)
      : answer(input, init),
  )
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
  connectionType = 'local'
  mockFetchByUrl()
})

const itemCountCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/item-count'))

describe('CloudscapeDynamoDBBrowser (via registry dispatch)', () => {
  it('lists tables with keys and billing', async () => {
    renderDynamo()
    expect(await screen.findByText('learners')).toBeInTheDocument()
    expect(await screen.findByText('PAY_PER_REQUEST')).toBeInTheDocument()
    expect(await screen.findByText('2.0 KB')).toBeInTheDocument()
  })

  it('says a table does not exist instead of showing it empty', async () => {
    failFor('/api/dynamodb/tables/NoSuchTable', 404, "Table 'NoSuchTable' not found")
    renderDynamo('/resources/dynamodb?table=NoSuchTable')

    expect(await screen.findByText('Could not load table')).toBeInTheDocument()
    expect(screen.getByText("Table 'NoSuchTable' not found")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    // Nor asks for the tags of a table that isn't there, which would fail with a second error
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/tags/dynamodb/'))).toBe(false)
  })

  it('labels the stored item count as approximate and, on an emulator, gets the live count in one click', async () => {
    renderDynamo('/resources/dynamodb?table=learners')

    const approximate = (await screen.findByText('Item count (approximate)')).parentElement as HTMLElement
    expect(within(approximate).getByText('2')).toBeInTheDocument()
    const live = screen.getByText('Live item count').parentElement as HTMLElement
    expect(itemCountCalls()).toHaveLength(0)

    fireEvent.click(within(live).getByRole('button', { name: 'Get live item count' }))

    expect(await within(live).findByText('5')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start scan' })).not.toBeInTheDocument()
    expect(itemCountCalls()).toHaveLength(1)
    const [url, init] = itemCountCalls()[0]
    expect(String(url)).toBe('/api/dynamodb/tables/learners/item-count?endpoint=local')
    expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET')
    expect(within(live).getByRole('button', { name: 'Count items again' })).toBeInTheDocument()
  })

  it('on real AWS, scans for the live count only once confirmed', async () => {
    connectionType = 'aws'
    renderDynamo('/resources/dynamodb?table=learners')
    const live = (await screen.findByText('Live item count')).parentElement as HTMLElement

    fireEvent.click(within(live).getByRole('button', { name: 'Get live item count' }))
    expect(await screen.findByText(/consumes read capacity on your AWS account/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start scan' })).not.toBeInTheDocument())
    expect(itemCountCalls()).toHaveLength(0)

    fireEvent.click(within(live).getByRole('button', { name: 'Get live item count' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start scan' }))

    expect(await within(live).findByText('5')).toBeInTheDocument()
    expect(itemCountCalls()).toHaveLength(1)
    const [url, init] = itemCountCalls()[0]
    expect(String(url)).toBe('/api/dynamodb/tables/learners/item-count?endpoint=local')
    expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET')
    expect(screen.queryByRole('button', { name: 'Start scan' })).not.toBeInTheDocument()
  })

  it('opens the table and scans items', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    expect(await screen.findByText('id (S)')).toBeInTheDocument()
    expect(await screen.findByText('team: data')).toBeInTheDocument()
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

  it('renders scanned items as plain values, not DynamoDB-typed JSON', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('95')).toBeInTheDocument()
    expect(screen.queryByText(/"S":/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"N":/)).not.toBeInTheDocument()
  })

  it('keeps the Edit/Delete column from shrinking next to wide attributes', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    const editCell = (await screen.findAllByText('Edit'))[0].closest('td') as HTMLElement
    expect(editCell.style.minWidth).toBe('140px')
  })

  it('opens an existing item as plain JSON and shows exact DynamoDB JSON on switch', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    await screen.findByText('Ada')
    fireEvent.click(screen.getAllByText('Edit')[0])

    const getTextarea = () =>
      screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    await waitFor(() => expect(JSON.parse(getTextarea().value)).toEqual({ id: '1', name: 'Ada', score: 95, tags: ['a', 'b'] }))

    fireEvent.click(screen.getByText('DynamoDB JSON'))
    await waitFor(() =>
      expect(JSON.parse(getTextarea().value)).toEqual({
        id: { S: '1' },
        name: { S: 'Ada' },
        score: { N: '95' },
        tags: { SS: ['a', 'b'] },
      }),
    )

    fireEvent.click(screen.getByText('Plain JSON'))
    await waitFor(() => expect(JSON.parse(getTextarea().value)).toEqual({ id: '1', name: 'Ada', score: 95, tags: ['a', 'b'] }))
  })

  it('saves an edited item without double-encoding it', async () => {
    renderDynamo()
    fireEvent.click(await screen.findByRole('link', { name: 'learners' }))
    await screen.findByText('Ada')
    fireEvent.click(screen.getAllByText('Edit')[1])
    fireEvent.click(await screen.findByRole('button', { name: 'Save item' }))

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/items?') && (init as RequestInit)?.method === 'PUT',
      )
      expect(putCall).toBeTruthy()
      const body = JSON.parse((putCall![1] as RequestInit).body as string)
      expect(body.item_format).toBe('plain')
      expect(body.item).toEqual({ id: '2', name: 'Grace', score: 98 })
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
