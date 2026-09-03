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
    if (url.includes('/messages/batch')) {
      payload =
        method === 'POST'
          ? { successful: [{ id: 'msg-1', messageId: 'x1' }, { id: 'msg-2', messageId: 'x2' }], failed: [] }
          : {}
    } else if (url.includes('/api/sqs/queues/orders/messages')) {
      if (method === 'POST') payload = { messageId: 'sent-1', md5OfMessageBody: 'md5' }
      else
      payload = {
        messages: [
          { messageId: 'm-1', receiptHandle: 'rh-1', body: 'hello one', md5OfBody: 'md5-1', attributes: {}, messageAttributes: {} },
          { messageId: 'm-2', receiptHandle: 'rh-2', body: 'hello two', md5OfBody: 'md5-2', attributes: {}, messageAttributes: {} },
        ],
      }
    } else if (url.includes('/purge')) {
      payload = { success: true, message: 'purged' }
    } else if (url.includes('/tags')) {
      payload = { tags: { env: 'dev' } }
    } else if (url.includes('/api/sqs/queues/orders')) {
      payload = {
        ...queuesPayload.queues[0],
        arn: 'arn:aws:sqs:us-east-1:000000000000:orders',
        maximumMessageSize: 262144,
        contentBasedDeduplication: false,
      }
    } else if (url.includes('/api/sqs/queues') && method === 'POST') {
      payload = { queueName: 'new-queue', queueUrl: 'http://x/new-queue', queueArn: 'arn:x' }
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
    <MemoryRouter initialEntries={['/resources/sqs']}>
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

  it('opens the queue detail via deep link and shows configuration', async () => {
    renderSQS()
    fireEvent.click(await screen.findByRole('link', { name: 'orders' }))
    expect(await screen.findByText('arn:aws:sqs:us-east-1:000000000000:orders')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Configuration'))
    expect(await screen.findByText('Content-based deduplication')).toBeInTheDocument()
    expect(screen.getByText('262144 bytes')).toBeInTheDocument()
  })

  it('polls messages and batch-deletes the selection in the detail view', async () => {
    renderSQS()
    fireEvent.click(await screen.findByRole('link', { name: 'orders' }))
    fireEvent.click(await screen.findByText('Poll for messages'))
    expect(await screen.findByText('hello one')).toBeInTheDocument()

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // select-all header checkbox
    fireEvent.click(screen.getByText(/Delete selected \(2\)/))

    await screen.findByText('Poll for messages')
    const batchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/messages/batch'))
    expect(batchCall).toBeTruthy()
    const body = JSON.parse((batchCall![1] as RequestInit).body as string)
    expect(body.receiptHandles).toEqual(['rh-1', 'rh-2'])
  })

  it('sends DLQ settings from the advanced create form', async () => {
    renderSQS()
    fireEvent.click(await screen.findByText('Create queue'))
    fireEvent.change(await screen.findByPlaceholderText('my-queue'), { target: { value: 'with-dlq' } })
    fireEvent.click(screen.getByText('Advanced settings'))
    fireEvent.click(await screen.findByText('Create a dead-letter queue'))
    const submitButtons = screen.getAllByRole('button', { name: 'Create queue' })
    fireEvent.click(submitButtons[submitButtons.length - 1])

    await screen.findByText('orders')
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/sqs/queues?endpoint=local') && (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((createCall![1] as RequestInit).body as string)
    expect(body.dlqEnabled).toBe(true)
    expect(body.maxReceiveCount).toBe(5)
    expect(body.sqsManagedSseEnabled).toBe(true)
  })

  it('batch-sends messages from the JSON template', async () => {
    renderSQS()
    fireEvent.click(await screen.findByRole('link', { name: 'orders' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send batch' }))
    fireEvent.click(await screen.findByTestId('batch-send-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/messages/batch') && (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/messages/batch') && (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0].id).toBe('msg-1')
    expect(JSON.parse(body.entries[0].messageBody).documentNumber).toBe('123456789')
  })

  it('creates a saved message template and sends it to the queue', async () => {
    renderSQS()
    fireEvent.click(await screen.findByRole('link', { name: 'orders' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Saved messages' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create saved message' }))

    fireEvent.change(await screen.findByPlaceholderText('Order created event'), { target: { value: 'ping' } })
    const textarea = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '{"kind":"ping"}' } })
    fireEvent.click(screen.getByTestId('save-favorite-submit'))

    // persisted to the legacy localStorage key and listed in the table
    expect(await screen.findByRole('link', { name: 'ping' })).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem('stackport:sqs-favorite-messages') ?? '{}')
    expect(stored.messages).toHaveLength(1)
    expect(stored.messages[0].sourceQueue).toBe('orders')

    fireEvent.click(screen.getByRole('button', { name: 'Send ping' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/api/sqs/queues/orders/messages') &&
          !String(url).includes('/batch') &&
          (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/api/sqs/queues/orders/messages') &&
        !String(url).includes('/batch') &&
        (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.messageBody).toBe('{"kind":"ping"}')
  })

  it('saves a polled message as a template from the messages table', async () => {
    renderSQS()
    fireEvent.click(await screen.findByRole('link', { name: 'orders' }))
    fireEvent.click(await screen.findByText('Poll for messages'))
    await screen.findByText('hello one')

    fireEvent.click(screen.getByRole('button', { name: 'Save message m-1' }))
    const nameInput = await screen.findByDisplayValue('Message from orders')
    fireEvent.change(nameInput, { target: { value: 'replayable' } })
    fireEvent.click(screen.getByTestId('save-favorite-submit'))

    const stored = JSON.parse(localStorage.getItem('stackport:sqs-favorite-messages') ?? '{}')
    expect(stored.messages).toHaveLength(1)
    expect(stored.messages[0].messageBody).toBe('hello one')
    expect(stored.messages[0].originalMessageId).toBe('m-1')
  })

  it('navigates queues with j/k and opens the selection with Enter', async () => {
    renderSQS()
    await screen.findByRole('link', { name: 'orders' })

    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(document.body, { key: 'k' })
    fireEvent.keyDown(document.body, { key: 'Enter' })

    expect(await screen.findByText('arn:aws:sqs:us-east-1:000000000000:orders')).toBeInTheDocument()
  })
})
