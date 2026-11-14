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
      endpoint_url: 'https://127.0.0.1:9631',
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
import type { ConnectionDetailsResponse } from '@/lib/types'

const KAFKA_ARN = 'arn:aws:kafka:us-east-1:000000000000:cluster/orders/a1b2'

const statsPayload = {
  services: {
    sqs: { status: 'available', resources: { queues: 1 } },
    kafka: { status: 'available', resources: { clusters: 1 } },
    elasticache: { status: 'available', resources: { cache_clusters: 1 } },
  },
  total_resources: 3,
  uptime_seconds: 60,
}

const queue = {
  name: 'jobs',
  url: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs',
  type: 'Standard',
  approximateNumberOfMessages: 0,
  approximateNumberOfMessagesNotVisible: 0,
  approximateNumberOfMessagesDelayed: 0,
  visibilityTimeout: 30,
  messageRetentionPeriod: 345600,
  delaySeconds: 0,
  redrivePolicy: null,
  tags: {},
}

const queueDetails: ConnectionDetailsResponse = {
  connections: [
    {
      label: 'Queue URL',
      address: 'https://127.0.0.1:9631/000000000000/jobs',
      returned: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs',
      snippets: [
        {
          label: 'AWS CLI',
          text: 'aws sqs receive-message --queue-url https://127.0.0.1:9631/000000000000/jobs --region us-east-1 --endpoint-url https://127.0.0.1:9631',
        },
      ],
    },
  ],
  problem: null,
  notes: [],
  cliSetup: { emulator: 'AWS Emulator', script: 'export AWS_CA_BUNDLE=~/.aws/emulator/9631/ca.pem', note: null },
}

const brokerDetails: ConnectionDetailsResponse = {
  connections: [
    {
      label: 'Bootstrap brokers (Plaintext)',
      address: 'b-1.orders.ministack.local:9092',
      returned: null,
      snippets: [{ label: 'kafka-topics', text: 'kafka-topics.sh --bootstrap-server b-1.orders.ministack.local:9092 --list' }],
    },
  ],
  problem: null,
  notes: ["MiniStack doesn't run Kafka brokers: this address is a placeholder unless MiniStack was started with MINISTACK_MSK_BOOTSTRAP naming a broker."],
  cliSetup: null,
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch() {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let payload: unknown = statsPayload
    if (url.includes('/api/connection-details/sqs/')) payload = queueDetails
    else if (url.includes('/api/connection-details/kafka/')) payload = brokerDetails
    else if (url.includes('/api/connection-details/elasticache/'))
      payload = {
        connections: [],
        problem: "The endpoint hasn't given this resource an address yet (status: creating).",
        notes: [],
        cliSetup: null,
      }
    else if (url.includes('/api/tags/supported')) payload = { supported: [] }
    else if (url.includes('/api/resources/kafka/clusters/'))
      payload = { service: 'kafka', type: 'clusters', id: KAFKA_ARN, detail: { ClusterArn: KAFKA_ARN } }
    else if (url.includes('/api/resources/kafka'))
      payload = { service: 'kafka', resources: { clusters: [{ id: KAFKA_ARN, ClusterName: 'orders' }] } }
    else if (url.includes('/api/resources/elasticache/cache_clusters/'))
      payload = { service: 'elasticache', type: 'cache_clusters', id: 'sessions', detail: {} }
    else if (url.includes('/api/resources/elasticache'))
      payload = { service: 'elasticache', resources: { cache_clusters: [{ id: 'sessions' }] } }
    else if (url.includes('/tags')) payload = { tags: {} }
    else if (url.includes('/messages')) payload = { messages: [] }
    else if (url.includes('/api/sqs/queues/jobs'))
      payload = { ...queue, arn: 'arn:aws:sqs:us-east-1:000000000000:jobs', maximumMessageSize: 262144, receiveMessageWaitTime: 0, contentBasedDeduplication: false }
    else if (url.includes('/api/sqs/queues')) payload = { queues: [queue] }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function requested(fragment: string): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes(fragment))
}

function renderAt(path: string) {
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
  mockFetch()
})

describe('Connection details', () => {
  it("shows a queue URL that works from this machine, with the emulator's CLI setup", async () => {
    renderAt('/resources/sqs?queue=jobs')
    fireEvent.click(await screen.findByRole('tab', { name: 'Connect' }))

    expect(await screen.findByText('https://127.0.0.1:9631/000000000000/jobs')).toBeInTheDocument()
    expect(screen.getByText('The endpoint returned https://sqs.us-east-1.amazonaws.com/000000000000/jobs')).toBeInTheDocument()
    expect(screen.getByText(queueDetails.connections[0].snippets[0].text)).toBeInTheDocument()
    expect(screen.getByText('AWS Emulator needs a little setup first')).toBeInTheDocument()
    expect(requested('/api/connection-details/')).toEqual(['/api/connection-details/sqs/queues/jobs?endpoint=local'])
  })

  it('adds a Connect tab to the generic detail of a broker cluster, by its ARN', async () => {
    renderAt('/resources/kafka')
    fireEvent.click(await screen.findByRole('link', { name: KAFKA_ARN }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Connect' }))

    expect(await screen.findByText('b-1.orders.ministack.local:9092')).toBeInTheDocument()
    expect(screen.getByText(brokerDetails.notes[0])).toBeInTheDocument()
    expect(requested('/api/connection-details/')).toEqual([
      `/api/connection-details/kafka/clusters/${encodeURIComponent(KAFKA_ARN)}?endpoint=local`,
    ])
  })

  it('says when there is nothing to connect to yet', async () => {
    renderAt('/resources/elasticache')
    fireEvent.click(await screen.findByRole('link', { name: 'sessions' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Connect' }))

    expect(await screen.findByText("The endpoint hasn't given this resource an address yet (status: creating).")).toBeInTheDocument()
  })
})
