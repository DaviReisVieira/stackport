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
  services: { monitoring: { status: 'available', resources: { alarms: 1, dashboards: 1 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const alarms = {
  alarms: [
    {
      name: 'high-cpu',
      arn: 'arn:aws:cloudwatch:us-east-1:0:alarm:high-cpu',
      description: 'CPU too high',
      state: 'ALARM',
      stateReason: 'Threshold crossed: 92 > 80',
      stateUpdated: '2026-09-01T10:00:00Z',
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      statistic: 'Average',
      period: 300,
      evaluationPeriods: 1,
      threshold: 80,
      comparisonOperator: 'GreaterThanThreshold',
      dimensions: [{ name: 'InstanceId', value: 'i-1' }],
    },
  ],
}

const dashboards = { dashboards: [{ name: 'app-overview', lastModified: '2026-09-01T09:00:00Z', size: 512 }] }

const dashboardDetail = {
  name: 'app-overview',
  body: {
    widgets: [
      {
        type: 'text',
        properties: { markdown: '# Overview note' },
      },
      {
        type: 'metric',
        properties: {
          title: 'Latency (ms)',
          view: 'timeSeries',
          metrics: [['StackPort/Demo', 'Latency', 'Service', 'api', { label: 'api latency' }]],
        },
      },
    ],
  },
}

const metricData = {
  results: [
    {
      id: 'w1m0',
      label: 'api latency',
      timestamps: ['2026-09-03T11:58:00Z', '2026-09-03T11:59:00Z'],
      values: [120.5, 131.2],
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/api/monitoring/metric-data') && method === 'POST') payload = metricData
    else if (url.includes('/api/monitoring/dashboards/app-overview')) payload = dashboardDetail
    else if (url.includes('/api/monitoring/dashboards')) payload = dashboards
    else if (url.includes('/api/monitoring/alarms')) payload = alarms
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderMonitoring(path = '/resources/monitoring') {
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

describe('CloudscapeMonitoringBrowser (via registry dispatch)', () => {
  it('lists dashboards and alarms in their tabs', async () => {
    renderMonitoring()
    expect(await screen.findByText('Dashboards (1)')).toBeInTheDocument()
    expect(await screen.findByText('app-overview')).toBeInTheDocument()

    fireEvent.click(await screen.findByText('Alarms (1)'))
    expect(await screen.findByText('high-cpu')).toBeInTheDocument()
    expect(await screen.findByText('ALARM')).toBeInTheDocument()
    expect(await screen.findByText('AWS/EC2 / CPUUtilization')).toBeInTheDocument()
    expect(await screen.findByText('Average CPUUtilization > 80')).toBeInTheDocument()
  })

  it('shows the alarm detail with state reason and dimensions', async () => {
    renderMonitoring()
    fireEvent.click(await screen.findByText('Alarms (1)'))
    fireEvent.click(await screen.findByRole('link', { name: 'high-cpu' }))

    expect(await screen.findByText('Threshold crossed: 92 > 80')).toBeInTheDocument()
    expect(await screen.findByText('InstanceId')).toBeInTheDocument()
    expect(await screen.findByText('i-1')).toBeInTheDocument()
  })

  it('renders a dashboard with widgets and fetches metric data for them', async () => {
    renderMonitoring('/resources/monitoring?dashboard=app-overview')

    expect(await screen.findByText(/Overview note/)).toBeInTheDocument()
    expect(await screen.findByText('Latency (ms)')).toBeInTheDocument()
    expect(await screen.findByText('api latency')).toBeInTheDocument()

    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/metric-data') && (init as RequestInit)?.method === 'POST',
    )
    expect(call).toBeTruthy()
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.startMinutes).toBe(180)
    expect(body.queries).toEqual([
      {
        id: 'w1m0',
        namespace: 'StackPort/Demo',
        metricName: 'Latency',
        dimensions: [{ name: 'Service', value: 'api' }],
        stat: 'Average',
        period: 60,
      },
    ])
  })
})
