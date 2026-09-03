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

const ARN = 'arn:aws:sns:us-east-1:000000000000:orders'

const statsPayload = {
  services: { sns: { status: 'available', resources: { topics: 2 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const topics = {
  topics: [
    {
      arn: ARN,
      name: 'orders',
      displayName: 'Orders',
      fifo: false,
      contentBasedDeduplication: false,
      subscriptionsConfirmed: 1,
      subscriptionsPending: 0,
      owner: '000000000000',
      kmsMasterKeyId: null,
    },
    {
      arn: `${ARN}-events.fifo`,
      name: 'orders-events.fifo',
      displayName: null,
      fifo: true,
      contentBasedDeduplication: true,
      subscriptionsConfirmed: 0,
      subscriptionsPending: 0,
      owner: '000000000000',
      kmsMasterKeyId: null,
    },
  ],
}

const topicDetail = {
  ...topics.topics[0],
  attributes: { DisplayName: 'Orders', TopicArn: ARN, SubscriptionsConfirmed: '1' },
  subscriptions: [
    {
      arn: `${ARN}:sub-1`,
      protocol: 'sqs',
      endpoint: 'arn:aws:sqs:us-east-1:000000000000:orders-q',
      owner: '000000000000',
      pending: false,
      filterPolicy: { type: ['order'] },
      rawMessageDelivery: false,
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/publish')) payload = { messageId: 'm-1' }
    else if (url.includes('/subscriptions') && method === 'POST') payload = { subscriptionArn: `${ARN}:sub-2` }
    else if (url.includes('/api/sns/subscriptions/') && method === 'DELETE') payload = { deleted: true }
    else if (url.includes('/api/sns/topics') && method === 'POST') payload = { arn: `${ARN}-new.fifo`, name: 'promo.fifo' }
    else if (url.includes(encodeURIComponent(ARN))) payload = topicDetail
    else if (url.includes('/api/sns/topics')) payload = topics
    else if (url.includes('/api/resources/sqs')) payload = { service: 'sqs', resources: { queues: [{ id: 'http://localhost:4566/000000000000/orders-q' }] } }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderSNS(path = '/resources/sns') {
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

describe('CloudscapeSNSBrowser (via registry dispatch)', () => {
  it('lists topics with type and subscription counts', async () => {
    renderSNS()
    expect(await screen.findByText('orders')).toBeInTheDocument()
    expect(await screen.findByText('orders-events.fifo')).toBeInTheDocument()
    expect(await screen.findByText('FIFO')).toBeInTheDocument()
    expect(await screen.findByText('Orders')).toBeInTheDocument()
  })

  it('creates a FIFO topic with deduplication', async () => {
    renderSNS()
    await screen.findByText('orders')
    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }))

    const nameInput = await screen.findByPlaceholderText('order-events')
    fireEvent.change(nameInput, { target: { value: 'promo' } })
    fireEvent.click(screen.getByText('FIFO topic'))
    fireEvent.click(await screen.findByText('Content-based deduplication'))
    fireEvent.click(screen.getByTestId('create-topic-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/api/sns/topics?') && (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/sns/topics?') && (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ name: 'promo', fifo: true, contentBasedDeduplication: true })
  })

  it('shows the topic detail with subscriptions and filter policy', async () => {
    renderSNS(`/resources/sns?topic=${encodeURIComponent(ARN)}`)
    expect(await screen.findByText('Subscriptions (1)')).toBeInTheDocument()
    expect(await screen.findByText('arn:aws:sqs:us-east-1:000000000000:orders-q')).toBeInTheDocument()
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()

    fireEvent.click(screen.getByText('View policy'))
    expect(await screen.findByText(/"order"/)).toBeInTheDocument()
  })

  it('publishes a message with subject and attributes', async () => {
    renderSNS(`/resources/sns?topic=${encodeURIComponent(ARN)}`)
    await screen.findByText('Subscriptions (1)')
    fireEvent.click(screen.getByRole('button', { name: 'Publish message' }))

    const textarea = (await screen.findAllByRole('textbox')).find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '{"orderId": 7}' } })
    fireEvent.click(screen.getByText('Message attributes'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add attribute' }))
    fireEvent.change(screen.getByPlaceholderText('Key'), { target: { value: 'type' } })
    fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: 'order' } })
    fireEvent.click(screen.getByTestId('publish-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/publish'))
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/publish'))
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.message).toBe('{"orderId": 7}')
    expect(body.messageAttributes).toEqual({ type: { dataType: 'String', stringValue: 'order' } })
  })

  it('subscribes an SQS queue with a filter policy', async () => {
    renderSNS(`/resources/sns?topic=${encodeURIComponent(ARN)}`)
    await screen.findByText('Subscriptions (1)')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))

    const endpointInput = await screen.findByLabelText('Subscription endpoint')
    fireEvent.change(endpointInput, { target: { value: 'arn:aws:sqs:us-east-1:000000000000:other-q' } })
    const policyInput = (screen.getAllByRole('textbox') as HTMLElement[]).find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    fireEvent.change(policyInput, { target: { value: '{"type": ["promo"]}' } })
    fireEvent.click(screen.getByTestId('subscribe-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/subscriptions') && (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/subscriptions') && (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({
      protocol: 'sqs',
      endpoint: 'arn:aws:sqs:us-east-1:000000000000:other-q',
      filterPolicy: { type: ['promo'] },
      rawMessageDelivery: false,
    })
  })

  it('subscribes with raw message delivery enabled', async () => {
    renderSNS(`/resources/sns?topic=${encodeURIComponent(ARN)}`)
    await screen.findByText('Subscriptions (1)')
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))

    const endpointInput = await screen.findByLabelText('Subscription endpoint')
    fireEvent.change(endpointInput, { target: { value: 'arn:aws:sqs:us-east-1:000000000000:raw-q' } })
    fireEvent.click(screen.getByText(/Raw message delivery/))
    fireEvent.click(screen.getByTestId('subscribe-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/subscriptions') && (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/subscriptions') && (init as RequestInit)?.method === 'POST',
    )
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.rawMessageDelivery).toBe(true)
  })

  it('requires a deduplication ID on FIFO topics without content-based dedup', async () => {
    const fifoArn = `${ARN}-events.fifo`
    const fifoDetail = {
      ...topics.topics[1],
      arn: fifoArn,
      contentBasedDeduplication: false,
      attributes: { FifoTopic: 'true' },
      subscriptions: [],
    }
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      let payload: unknown = statsPayload
      if (url.includes(encodeURIComponent(fifoArn))) payload = fifoDetail
      else if (url.includes('/api/stats')) payload = statsPayload
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
    })

    renderSNS(`/resources/sns?topic=${encodeURIComponent(fifoArn)}`)
    await screen.findByText('Subscriptions (0)')
    fireEvent.click(screen.getByRole('button', { name: 'Publish message' }))

    const textarea = (await screen.findAllByRole('textbox')).find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    const groupInput = screen.getAllByRole('textbox').filter((el) => el.tagName === 'INPUT')[1]
    fireEvent.change(groupInput, { target: { value: 'g1' } })

    // sem dedup ID o publish fica bloqueado (CBD desligado neste topico)
    expect(screen.getByTestId('publish-submit')).toBeDisabled()
    const dedupInput = screen.getAllByRole('textbox').filter((el) => el.tagName === 'INPUT')[2]
    fireEvent.change(dedupInput, { target: { value: 'd1' } })
    expect(screen.getByTestId('publish-submit')).toBeEnabled()
  })

  it('unsubscribes and deletes with type-the-name confirmation', async () => {
    renderSNS(`/resources/sns?topic=${encodeURIComponent(ARN)}`)
    await screen.findByText('Subscriptions (1)')

    fireEvent.click(screen.getByRole('button', { name: /Unsubscribe/ }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/api/sns/subscriptions/') && (init as RequestInit)?.method === 'DELETE',
      )
      expect(call).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByTestId('confirm-delete-topic')
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('orders'), { target: { value: 'orders' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(`/api/sns/topics/${encodeURIComponent(ARN)}`) && (init as RequestInit)?.method === 'DELETE',
      )
      expect(call).toBeTruthy()
    })
  })
})
