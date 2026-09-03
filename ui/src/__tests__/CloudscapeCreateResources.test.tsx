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
  services: { s3: { status: 'available', resources: { buckets: 0 } }, dynamodb: { status: 'available', resources: { tables: 0 } } },
  total_resources: 0,
  uptime_seconds: 60,
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl(overrides: { s3Error?: string } = {}) {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    let ok = true
    if (url.includes('/api/s3/buckets') && method === 'POST') {
      if (overrides.s3Error) {
        ok = false
        payload = { detail: overrides.s3Error }
      } else {
        payload = { name: 'learn-bucket', region: 'us-east-1', versioning: false }
      }
    } else if (url.includes('/api/dynamodb/tables') && method === 'POST') {
      payload = { name: 'Music', status: 'ACTIVE', partitionKey: 'Artist', sortKey: null, billingMode: 'PAY_PER_REQUEST' }
    } else if (url.includes('/api/dynamodb/tables/')) {
      // creating navigates into the new table, so its detail must resolve
      payload = {
        name: 'Music',
        status: 'ACTIVE',
        item_count: 0,
        size_bytes: 0,
        billing_mode: 'PAY_PER_REQUEST',
        partition_key: 'Artist',
        sort_key: null,
        key_schema: [],
        attribute_definitions: [],
        global_secondary_indexes: [],
        local_secondary_indexes: [],
        stream_enabled: false,
        created: '2026-01-01T00:00:00Z',
      }
    } else if (url.includes('/api/s3/buckets')) payload = { buckets: [] }
    else if (url.includes('/api/dynamodb/tables')) payload = { tables: [] }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok, status: ok ? 200 : 409, statusText: ok ? 'OK' : 'Conflict', json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderService(service: string) {
  return render(
    <MemoryRouter initialEntries={[`/resources/${service}`]}>
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

function postBody(match: string) {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => String(url).includes(match) && (init as RequestInit)?.method === 'POST',
  )
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('Create bucket (#153)', () => {
  it('creates a bucket with the default settings', async () => {
    renderService('s3')
    fireEvent.click(await screen.findByRole('button', { name: 'Create bucket' }))

    fireEvent.change(await screen.findByPlaceholderText('my-bucket'), { target: { value: 'learn-bucket' } })
    fireEvent.click(screen.getByTestId('create-bucket-submit'))

    await waitFor(() => expect(postBody('/api/s3/buckets')).toBeTruthy())
    expect(postBody('/api/s3/buckets')).toEqual({ name: 'learn-bucket', versioning: false })
  })

  it('sends versioning and tags when asked', async () => {
    renderService('s3')
    fireEvent.click(await screen.findByRole('button', { name: 'Create bucket' }))

    fireEvent.change(await screen.findByPlaceholderText('my-bucket'), { target: { value: 'learn-bucket' } })
    fireEvent.click(screen.getByText('Enable versioning'))
    fireEvent.click(screen.getByText('Tags'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add tag' }))
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[inputs.length - 2], { target: { value: 'env' } })
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'learn' } })
    fireEvent.click(screen.getByTestId('create-bucket-submit'))

    await waitFor(() => expect(postBody('/api/s3/buckets')).toBeTruthy())
    expect(postBody('/api/s3/buckets')).toEqual({
      name: 'learn-bucket',
      versioning: true,
      tags: { env: 'learn' },
    })
  })

  it('blocks submit and names the failing rule for an invalid name', async () => {
    renderService('s3')
    fireEvent.click(await screen.findByRole('button', { name: 'Create bucket' }))

    const input = await screen.findByPlaceholderText('my-bucket')
    fireEvent.change(input, { target: { value: 'Invalid_Name' } })
    expect(await screen.findByText(/only lowercase letters/)).toBeInTheDocument()
    expect(screen.getByTestId('create-bucket-submit')).toBeDisabled()

    fireEvent.change(input, { target: { value: '192.168.5.4' } })
    expect(await screen.findByText(/IP address/)).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'amzn-s3-demo-bucket' } })
    expect(await screen.findByText(/reserved prefix/)).toBeInTheDocument()

    expect(postBody('/api/s3/buckets')).toBeNull()
  })

  it('surfaces a duplicate-name error from the backend', async () => {
    mockFetchByUrl({ s3Error: "A bucket named 'learn-bucket' already exists" })
    renderService('s3')
    fireEvent.click(await screen.findByRole('button', { name: 'Create bucket' }))
    fireEvent.change(await screen.findByPlaceholderText('my-bucket'), { target: { value: 'learn-bucket' } })
    fireEvent.click(screen.getByTestId('create-bucket-submit'))

    await waitFor(() => expect(postBody('/api/s3/buckets')).toBeTruthy())
    // the modal stays open so the learner can pick another name
    expect(screen.getByTestId('create-bucket-submit')).toBeInTheDocument()
  })

  it('shows the region read-only and states the security defaults', async () => {
    renderService('s3')
    fireEvent.click(await screen.findByRole('button', { name: 'Create bucket' }))
    expect(await screen.findByText('us-east-1')).toBeInTheDocument()
    expect(screen.getByText(/Block Public Access is also on by default/)).toBeInTheDocument()
  })
})

describe('Create table (#154)', () => {
  it('creates a table with a partition key only, on demand', async () => {
    renderService('dynamodb')
    fireEvent.click(await screen.findByRole('button', { name: 'Create table' }))

    fireEvent.change(await screen.findByPlaceholderText('Music'), { target: { value: 'Music' } })
    fireEvent.change(screen.getByLabelText('Partition key name'), { target: { value: 'Artist' } })
    fireEvent.click(screen.getByTestId('create-table-submit'))

    await waitFor(() => expect(postBody('/api/dynamodb/tables')).toBeTruthy())
    expect(postBody('/api/dynamodb/tables')).toEqual({
      name: 'Music',
      partitionKey: { name: 'Artist', type: 'S' },
      billingMode: 'PAY_PER_REQUEST',
    })
  })

  it('adds a sort key with its own type', async () => {
    renderService('dynamodb')
    fireEvent.click(await screen.findByRole('button', { name: 'Create table' }))

    fireEvent.change(await screen.findByPlaceholderText('Music'), { target: { value: 'Events' } })
    fireEvent.change(screen.getByLabelText('Partition key name'), { target: { value: 'userId' } })
    fireEvent.click(screen.getByText('Add a sort key'))
    fireEvent.change(await screen.findByPlaceholderText('SongTitle'), { target: { value: 'ts' } })

    const sortTypeSelect = createWrapper(screen.getByTestId('sort-key-type')).findSelect()
    sortTypeSelect!.openDropdown()
    sortTypeSelect!.selectOptionByValue('N')

    fireEvent.click(screen.getByTestId('create-table-submit'))
    await waitFor(() => expect(postBody('/api/dynamodb/tables')).toBeTruthy())
    expect(postBody('/api/dynamodb/tables')).toEqual({
      name: 'Events',
      partitionKey: { name: 'userId', type: 'S' },
      sortKey: { name: 'ts', type: 'N' },
      billingMode: 'PAY_PER_REQUEST',
    })
  })

  it('rejects a sort key equal to the partition key', async () => {
    renderService('dynamodb')
    fireEvent.click(await screen.findByRole('button', { name: 'Create table' }))

    fireEvent.change(await screen.findByPlaceholderText('Music'), { target: { value: 'Bad' } })
    fireEvent.change(screen.getByLabelText('Partition key name'), { target: { value: 'id' } })
    fireEvent.click(screen.getByText('Add a sort key'))
    fireEvent.change(await screen.findByPlaceholderText('SongTitle'), { target: { value: 'id' } })

    expect(await screen.findByText(/must differ from the partition key/)).toBeInTheDocument()
    expect(screen.getByTestId('create-table-submit')).toBeDisabled()
  })

  it('sends provisioned capacity when customized', async () => {
    renderService('dynamodb')
    fireEvent.click(await screen.findByRole('button', { name: 'Create table' }))

    fireEvent.change(await screen.findByPlaceholderText('Music'), { target: { value: 'Prov' } })
    fireEvent.change(screen.getByLabelText('Partition key name'), { target: { value: 'id' } })
    fireEvent.click(screen.getByText('Customize settings'))

    const capacitySelect = createWrapper(screen.getByTestId('capacity-mode')).findSelect()
    capacitySelect!.openDropdown()
    capacitySelect!.selectOptionByValue('PROVISIONED')

    const numbers = await screen.findAllByRole('spinbutton')
    fireEvent.change(numbers[0], { target: { value: '10' } })
    fireEvent.change(numbers[1], { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('create-table-submit'))

    await waitFor(() => expect(postBody('/api/dynamodb/tables')).toBeTruthy())
    expect(postBody('/api/dynamodb/tables')).toEqual({
      name: 'Prov',
      partitionKey: { name: 'id', type: 'S' },
      billingMode: 'PROVISIONED',
      readCapacity: 10,
      writeCapacity: 3,
    })
  })
})
