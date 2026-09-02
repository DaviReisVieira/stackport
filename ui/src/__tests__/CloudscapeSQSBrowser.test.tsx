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
  services: { sqs: { status: 'available', resources: { queues: 2 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const queuesPayload = {
  queues: [
    {
      name: 'orders',
      url: 'http://localhost:4566/000000000000/orders',
      type: 'Standard',
      approximateNumberOfMessages: 5,
      approximateNumberOfMessagesNotVisible: 1,
      approximateNumberOfMessagesDelayed: 0,
      visibilityTimeout: 30,
      messageRetentionPeriod: 345600,
      delaySeconds: 0,
      redrivePolicy: null,
      tags: {},
    },
    {
      name: 'events.fifo',
      url: 'http://localhost:4566/000000000000/events.fifo',
      type: 'FIFO',
      approximateNumberOfMessages: 2,
      approximateNumberOfMessagesNotVisible: 0,
      approximateNumberOfMessagesDelayed: 0,
      visibilityTimeout: 30,
      messageRetentionPeriod: 345600,
      delaySeconds: 0,
      redrivePolicy: { deadLetterTargetArn: 'arn:aws:sqs:us-east-1:0:dlq', maxReceiveCount: 3 },
      tags: {},
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/api/sqs/queues') && method === 'POST' && !url.includes('/purge')) {
      payload = { queueName: 'new-queue', queueUrl: 'http://x/new-queue', queueArn: 'arn:x' }
    } else if (url.includes('/purge')) {
      payload = { success: true, message: 'purged' }
    } else if (url.includes('/api/sqs/queues')) {
      payload = queuesPayload
    } else if (url.includes('/api/stats')) {
      payload = statsPayload
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderSQS() {
  return render(
    <MemoryRouter initialEntries={['/cloudscape/resources/sqs']}>
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

describe('CloudscapeSQSBrowser (via registry dispatch)', () => {
  it('renders the queue table through CLOUDSCAPE_SERVICE_VIEWS', async () => {
    renderSQS()
    expect(await screen.findByText('orders')).toBeInTheDocument()
    expect(await screen.findByText('events.fifo')).toBeInTheDocument()
    expect(await screen.findByText('FIFO')).toBeInTheDocument()
    expect(await screen.findByText('max 3')).toBeInTheDocument()
  })

  it('creates a queue from the modal', async () => {
    renderSQS()
    fireEvent.click(await screen.findByText('Create queue'))
    const nameInput = await screen.findByPlaceholderText('my-queue')
    fireEvent.change(nameInput, { target: { value: 'payments' } })
    const submitButtons = screen.getAllByRole('button', { name: 'Create queue' })
    fireEvent.click(submitButtons[submitButtons.length - 1])

    await screen.findByText('orders') // wait a tick for the POST to fire
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/sqs/queues?endpoint=local') && (init as RequestInit)?.method === 'POST',
    )
    expect(createCall).toBeTruthy()
    const body = JSON.parse((createCall![1] as RequestInit).body as string)
    expect(body.queueName).toBe('payments')
    expect(body.queueType).toBe('Standard')
  })

  it('gates queue actions on selection and purges with type-to-confirm', async () => {
    renderSQS()
    await screen.findByText('orders')
    expect(screen.getByRole('button', { name: 'Purge' })).toBeDisabled()

    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(screen.getByRole('button', { name: 'Purge' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Purge' }))
    const confirm = await screen.findByTestId('confirm-purge')
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('orders'), { target: { value: 'orders' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await screen.findByText('orders')
    const purgeCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/sqs/queues/orders/purge'))
    expect(purgeCall).toBeTruthy()
  })
})
