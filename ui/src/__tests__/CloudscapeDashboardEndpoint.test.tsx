import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import type { ClassifiedError, ConnectionDescription, EmulatorInfo, HealthResponse, StatsResponse } from '@/lib/types'

/**
 * The Dashboard with its real health, stats and WebSocket hooks under the real
 * shell: what the page says about the active endpoint, and what Retry does.
 */

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'default',
    endpoints: [
      {
        name: 'default',
        url: 'https://127.0.0.1:9297',
        health: 'unknown',
        active: true,
        connection_type: 'local',
        region: 'us-east-1',
        source: 'env',
        auth_type: 'default',
        tls_verify: true,
        ca_bundle: null,
      },
    ],
    loading: false,
    revision: 0,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import CloudscapeDashboard from '@/pages/CloudscapeDashboard'

/** Stands in for the browser WebSocket so tests can open it and push the backend's stats. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor() {
    FakeWebSocket.instances.push(this)
  }

  send() {}

  close() {
    this.readyState = 3
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

/** A promise the test settles by hand, to control when an answer lands. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const SYSTEM_TRUST: ConnectionDescription = {
  credentials_source: 'environment',
  tls_trust_source: 'system',
  ca_bundle: null,
  aws_emulator_dir: null,
  aws_emulator_lookup_dir: null,
}

function healthFor(emulator: EmulatorInfo | null, connection: ConnectionDescription = SYSTEM_TRUST): HealthResponse {
  return {
    status: 'ok',
    version: 'test',
    uptime_seconds: 1,
    endpoint_url: 'https://127.0.0.1:9297',
    region: 'us-east-1',
    services_count: 2,
    connection_type: 'local',
    writes_enabled: true,
    connection,
    emulator,
  }
}

const AWS_EMULATOR: EmulatorInfo = { id: 'aws-emulator', name: 'AWS Emulator', version: '1.0.0', tls_trusted: true }

const healthyStats: StatsResponse = {
  services: {
    s3: { status: 'available', resources: { buckets: 2 } },
    sqs: { status: 'available', resources: { queues: 1 } },
  },
  total_resources: 3,
  uptime_seconds: 30,
  problem: null,
}

function statsWithProblem(problem: ClassifiedError): StatsResponse {
  return {
    services: {
      s3: { status: 'unavailable', resources: {}, error: problem },
      sqs: { status: 'unavailable', resources: {}, error: problem },
    },
    total_resources: 0,
    uptime_seconds: 30,
    problem,
  }
}

const unreachable: ClassifiedError = {
  kind: 'unreachable',
  message: "StackPort couldn't reach the endpoint.",
  hint: 'Check that the emulator is running and that the endpoint URL and port are right.',
  cause: 'Could not connect to the endpoint URL: "https://127.0.0.1:9297/"',
}

let health: HealthResponse
/** How the backend answers the next /api/stats request. */
let answerStats: () => Promise<StatsResponse>
let fetchMock: ReturnType<typeof vi.fn>

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  health = healthFor(null)
  answerStats = () => Promise.resolve(healthyStats)
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://stackport.test')
    if (url.pathname === '/api/health') return Promise.resolve(json(health))
    if (url.pathname === '/api/stats') return answerStats().then(json)
    return Promise.resolve(new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 }))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CloudscapeDashboard />
    </MemoryRouter>,
  )
}

function statsRequests() {
  return fetchMock.mock.calls.filter(([input]) => new URL(String(input), 'http://stackport.test').pathname === '/api/stats')
    .length
}

/** The page header's description: the endpoint, and the emulator behind it. */
function headerDescription() {
  return createWrapper().findContentLayout()!.findHeader()!.findHeader()!.findDescription()?.getElement().textContent
}

function pageAlert() {
  return createWrapper(createWrapper().findContentLayout()!.getElement()).findAlert()
}

function retryButton() {
  const action = pageAlert()?.findActionSlot()?.findButton()
  if (!action) throw new Error('no Retry button')
  return action
}

describe('CloudscapeDashboard header', () => {
  it.each<[string, EmulatorInfo | null, StatsResponse, string]>([
    ['MiniStack', { id: 'ministack', name: 'MiniStack', version: '1.3.0' }, healthyStats, 'Connected to default · MiniStack'],
    ['AWS Emulator', AWS_EMULATOR, statsWithProblem(unreachable), 'Endpoint: default · AWS Emulator'],
    ['no recognised emulator', null, healthyStats, 'Connected to default'],
  ])('names the endpoint and the emulator behind it: %s', async (_case, emulator, stats, description) => {
    health = healthFor(emulator)
    answerStats = () => Promise.resolve(stats)
    renderDashboard()

    await waitFor(() => expect(headerDescription()).toBe(description))
  })
})

describe('CloudscapeDashboard Retry', () => {
  it('shows the answer it fetched, and that it is fetching, while the socket is connected', async () => {
    health = healthFor(AWS_EMULATOR)
    answerStats = () => Promise.resolve(statsWithProblem(unreachable))
    renderDashboard()
    expect(await screen.findByText(unreachable.message)).toBeInTheDocument()

    // Connected: the socket pushes the same problem before anyone retries
    const socket = FakeWebSocket.instances.at(-1)!
    act(() => {
      socket.open()
      socket.emit({ type: 'stats', data: statsWithProblem(unreachable) })
    })
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(retryButton().findLoadingIndicator()).toBeNull()

    // The emulator is back
    const retry = deferred<StatsResponse>()
    answerStats = () => retry.promise
    const requestsBefore = statsRequests()
    act(() => retryButton().click())
    expect(statsRequests()).toBe(requestsBefore + 1)
    expect(retryButton().findLoadingIndicator()).not.toBeNull()

    await act(async () => {
      retry.resolve(healthyStats)
    })
    await waitFor(() => expect(pageAlert()).toBeNull())
    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(headerDescription()).toBe('Connected to default · AWS Emulator')
  })
})

describe('CloudscapeDashboard with the certificate warning', () => {
  it("tells the same story in the banner and the alert when AWS Emulator's folder isn't there", async () => {
    const folder = '~/.aws/emulator/9297'
    health = healthFor(
      { ...AWS_EMULATOR, tls_trusted: false },
      { ...SYSTEM_TRUST, aws_emulator_dir: null, aws_emulator_lookup_dir: folder },
    )
    // backend/routes/stats.py swaps the generic hint for the missing folder's
    const tlsProblem: ClassifiedError = {
      kind: 'tls',
      message: "StackPort doesn't trust the endpoint's TLS certificate.",
      hint: `If this endpoint is AWS Emulator: StackPort reads the keys and certificate it writes from ${folder}, and can't find that folder. Run StackPort where it can see it, share it as the Compose example does, or point STACKPORT_AWS_EMULATOR_DIR at it.`,
      cause:
        'SSL validation failed for https://127.0.0.1:9297/ [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate (_ssl.c:1000)',
    }
    answerStats = () => Promise.resolve(statsWithProblem(tlsProblem))
    renderDashboard()

    const banner = await waitFor(() => {
      const item = createWrapper().findFlashbar()?.findItemById('tls-untrusted')
      if (!item) throw new Error('no certificate warning yet')
      return item
    })
    expect(banner.findContent()!.getElement()).toHaveTextContent(
      `StackPort reached AWS Emulator but can't find the certificate and keys it writes for this port. StackPort looks in ${folder} on the machine where it runs: run StackPort where it can see that folder, share it as the Compose example does, or point STACKPORT_AWS_EMULATOR_DIR at it.`,
    )
    expect(banner.findAction()).toBeNull()

    const alert = await waitFor(() => {
      const found = pageAlert()
      if (!found) throw new Error('no problem alert yet')
      return found
    })
    expect(alert.findHeader()!.getElement()).toHaveTextContent(tlsProblem.message)
    expect(alert.findContent().getElement()).toHaveTextContent(tlsProblem.hint!)
    expect(headerDescription()).toBe('Endpoint: default · AWS Emulator')

    // Neither sends people to Settings for a CA bundle the emulator already wrote
    expect(document.body).not.toHaveTextContent(/CA bundle/i)
    expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeInTheDocument()
  })
})
