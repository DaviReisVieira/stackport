import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import { serviceStatusDisplay } from '@/components/cloudscape/service-status-display'
import type { ClassifiedError, ServiceStats, StatsResponse } from '@/lib/types'

const refresh = vi.fn()

const setActiveEndpoint = vi.fn()

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [
      {
        name: 'local',
        url: 'http://localhost:4566',
        health: 'healthy',
        active: true,
        connection_type: 'local',
        region: 'us-east-1',
        source: 'env',
        auth_type: 'default',
      },
      {
        name: 'staging',
        url: 'http://localhost:5001',
        health: 'unknown',
        active: false,
        connection_type: 'local',
        region: 'us-east-1',
        source: 'user',
        auth_type: 'default',
      },
    ],
    loading: false,
    setActiveEndpoint,
    refresh: vi.fn(),
  }),
}))

const health = {
  status: 'ok',
  version: 'test',
  uptime_seconds: 1,
  endpoint_url: 'http://localhost:4566',
  region: 'us-east-1',
  services_count: 3,
  connection_type: 'local' as const,
  writes_enabled: false,
}

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({ data: health, loading: false, error: null, refresh: vi.fn() }),
}))

const stats: StatsResponse = {
  services: {
    s3: { status: 'available', resources: { buckets: 3 } },
    dynamodb: { status: 'available', resources: { tables: 2 } },
    ec2: { status: 'unavailable', resources: {} },
  },
  total_resources: 5,
  uptime_seconds: 120,
}

let wsStats: StatsResponse | null = stats
let wsError: string | null = null
let wsLoading = false

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ data: wsStats, loading: wsLoading, error: wsError, connected: true, refresh }),
}))

import CloudscapeDashboard from '@/pages/CloudscapeDashboard'

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CloudscapeDashboard />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  refresh.mockReset()
  wsStats = stats
  wsError = null
  wsLoading = false
  // The shell fetches /api/stats once for the top-nav search options
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(stats),
  }) as unknown as typeof fetch
})

describe('CloudscapeDashboard', () => {
  it('renders the summary and every service', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Connected to local')).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('s3')).toBeInTheDocument()
    expect(screen.getByText('dynamodb')).toBeInTheDocument()
    expect(screen.getByText('ec2')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('filters services by name', () => {
    renderDashboard()
    const filterInput = screen.getAllByPlaceholderText('Find a service')[0]
    fireEvent.change(filterInput, { target: { value: 'dyna' } })
    expect(screen.getByText('dynamodb')).toBeInTheDocument()
    expect(screen.queryByText('s3')).not.toBeInTheDocument()
  })

  it('switches between grid and list view', () => {
    renderDashboard()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('List'))
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(localStorage.getItem('stackport:view-mode')).toBe('list')
  })

  it('marks a favorite and persists it', () => {
    renderDashboard()
    const star = screen.getByLabelText('Add ec2 to favorites')
    fireEvent.click(star)
    expect(JSON.parse(localStorage.getItem('stackport:favorites') ?? '[]')).toContain('ec2')
    expect(screen.getByLabelText('Remove ec2 from favorites')).toBeInTheDocument()
  })

  it('shows the top-nav service search', () => {
    renderDashboard()
    expect(screen.getAllByPlaceholderText(/Search services/).length).toBeGreaterThan(0)
  })

  it('pins a favorited service to the top navigation', () => {
    renderDashboard()
    expect(screen.getAllByText('dynamodb')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Add dynamodb to favorites'))
    // dashboard entry + pinned top-nav shortcut
    expect(screen.getAllByText('dynamodb').length).toBeGreaterThan(1)
  })

  it('refreshes on demand', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the active endpoint and switches endpoints from the top nav', () => {
    renderDashboard()
    fireEvent.click(screen.getAllByText('local')[0])
    fireEvent.click(screen.getAllByText('staging')[0])
    expect(setActiveEndpoint).toHaveBeenCalledWith('staging')
  })

  it('shows the read-only badge when writes are disabled', () => {
    renderDashboard()
    expect(screen.getAllByText('Read-only').length).toBeGreaterThan(0)
  })

  it('opens the keyboard shortcuts modal', () => {
    renderDashboard()
    fireEvent.click(screen.getAllByLabelText('Keyboard shortcuts')[0])
    expect(screen.getByText('Toggle sidebar')).toBeInTheDocument()
  })

  it('focuses the service search with Alt+S', () => {
    renderDashboard()
    fireEvent.keyDown(document.body, { code: 'KeyS', altKey: true })
    expect((document.activeElement as HTMLInputElement)?.placeholder).toContain('Search services')
  })
})

// Shapes from backend/routes/stats.py (_service_result) for an emulator that
// implements some services, part of one, and fails another.
const notImplemented = (operation: string): ClassifiedError => ({
  kind: 'not_implemented',
  message: `This endpoint doesn't implement ${operation} yet.`,
  hint: 'The emulator returned NotImplemented. StackPort shows the rest of what the endpoint supports.',
  code: 'NotImplemented',
  operation,
  cause: `An error occurred (NotImplemented) when calling the ${operation} operation: ${operation} is not implemented`,
})

const emulatorStats: StatsResponse = {
  services: {
    athena: { status: 'unsupported', resources: {}, error: notImplemented('ListWorkGroups') },
    ecs: {
      status: 'available',
      resources: { clusters: 1, task_definitions: 0 },
      errors: { task_definitions: notImplemented('ListTaskDefinitions') },
    },
    elasticache: {
      status: 'unavailable',
      resources: {},
      error: {
        kind: 'other',
        message: 'We encountered an internal error. Please try again.',
        code: 'InternalFailure',
        operation: 'DescribeCacheClusters',
      },
    },
    glue: { status: 'unsupported', resources: {}, error: notImplemented('GetDatabases') },
    kms: { status: 'available', resources: { keys: 0 } },
    s3: { status: 'available', resources: { buckets: 3 } },
    sqs: { status: 'available', resources: { queues: 2 } },
  },
  total_resources: 6,
  uptime_seconds: 30,
  problem: null,
}

function statsWithProblem(problem: ClassifiedError): StatsResponse {
  return {
    services: Object.fromEntries(
      ['dynamodb', 's3', 'sqs'].map((name) => [name, { status: 'unavailable' as const, resources: {}, error: problem }]),
    ),
    total_resources: 0,
    uptime_seconds: 30,
    problem,
  }
}

const credentialsProblem: ClassifiedError = {
  kind: 'credentials',
  message: 'AWS Emulator rejected the credentials StackPort signed with.',
  hint: 'AWS Emulator creates new keys every time it starts. StackPort reads them from ~/.aws/emulator/<port>/ when it can see that folder, so check that it can (see STACKPORT_AWS_EMULATOR_DIR), and that the endpoint has no keys of its own.',
  code: 'AccessDenied',
  operation: 'ListBuckets',
  cause: 'An error occurred (AccessDenied) when calling the ListBuckets operation: Sign the request with the emulator credentials',
}

const tlsProblem: ClassifiedError = {
  kind: 'tls',
  message: "StackPort doesn't trust the endpoint's TLS certificate.",
  hint: "For an emulator with a self-signed certificate, set the endpoint's CA bundle in Settings. For AWS Emulator, StackPort uses ~/.aws/emulator/<port>/ca.pem by itself when the endpoint URL is https://127.0.0.1:<port> and that folder is readable.",
  cause: 'SSL validation failed for https://127.0.0.1:9297/ [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate (_ssl.c:1000)',
}

/** Open a service's status popover, read it, and close it again. */
function readStatusPopover(name: string, label: string) {
  const trigger = screen.getByRole('button', { name: `${name} status: ${label}` })
  fireEvent.click(trigger)
  // Rendered in a portal: test-utils finds the open one anywhere in the document.
  const popover = createWrapper().findPopover()!
  const text = {
    header: popover.findHeader({ renderWithPortal: true })?.getElement().textContent,
    content: popover.findContent({ renderWithPortal: true })?.getElement().textContent,
  }
  fireEvent.keyDown(trigger, { key: 'Escape', keyCode: 27 })
  expect(popover.findContent({ renderWithPortal: true })).toBeNull()
  return text
}

describe('CloudscapeDashboard service statuses', () => {
  beforeEach(() => {
    wsStats = emulatorStats
  })

  it('counts services out of the ones the endpoint implements', () => {
    renderDashboard()
    expect(screen.getByText('4/5')).toBeInTheDocument()
    expect(screen.getByText('2 not supported by this endpoint')).toBeInTheDocument()
  })

  it('counts no services, rather than 0 out of 0, when the endpoint implements none', () => {
    wsStats = {
      ...emulatorStats,
      services: {
        athena: emulatorStats.services.athena,
        glue: emulatorStats.services.glue,
      },
      total_resources: 0,
    }
    renderDashboard()
    expect(screen.queryByText('0/0')).not.toBeInTheDocument()
    const servicesAvailable = screen.getByText('Services available').parentElement!
    expect(servicesAvailable).toHaveTextContent('Services available02 not supported by this endpoint')
  })

  it.each([
    ['grid', false],
    ['list', true],
  ])('shows available, not supported and unavailable apart in the %s view', (_view, switchToList) => {
    renderDashboard()
    if (switchToList) fireEvent.click(screen.getByText('List'))
    expect(createWrapper().findTable() !== null).toBe(switchToList)

    expect(screen.getAllByText('Available')).toHaveLength(4)
    expect(screen.getAllByText('Not supported')).toHaveLength(2)
    expect(screen.getAllByText('Unavailable')).toHaveLength(1)

    const athena = readStatusPopover('athena', 'Not supported')
    expect(athena.header).toBe('Not supported by this endpoint')
    expect(athena.content).toContain("This endpoint doesn't implement ListWorkGroups yet.")
    expect(athena.content).toContain('The emulator returned NotImplemented.')
    // Popovers stay non-interactive; the original error is on the service's page.
    expect(athena.content).not.toContain('An error occurred')

    const elasticache = readStatusPopover('elasticache', 'Unavailable')
    expect(elasticache.header).toBe('Unavailable')
    expect(elasticache.content).toContain('We encountered an internal error. Please try again.')
  })

  it('uses a neutral indicator, not an error, for a service the endpoint does not implement', () => {
    expect(serviceStatusDisplay('unsupported')).toEqual({ type: 'stopped', label: 'Not supported' })
    expect(serviceStatusDisplay('unavailable')).toEqual({ type: 'error', label: 'Unavailable' })
    expect(serviceStatusDisplay('available')).toEqual({ type: 'success', label: 'Available' })
  })

  it('shows a status this UI does not know yet as it is, without counting it', () => {
    // A newer backend may add statuses; the page has to keep rendering
    const throttled = { status: 'throttled', resources: {} } as unknown as ServiceStats
    wsStats = { ...emulatorStats, services: { ...emulatorStats.services, firehose: throttled } }
    renderDashboard()

    expect(serviceStatusDisplay('throttled')).toEqual({ type: 'info', label: 'throttled' })
    expect(screen.getByText('throttled')).toBeInTheDocument()
    expect(screen.getByText('4/5')).toBeInTheDocument()
  })

  it('lists the resource types a partly available service could not list', () => {
    renderDashboard()
    const ecs = readStatusPopover('ecs', 'Available')
    expect(ecs.header).toBe("Some resource types weren't listed")
    expect(ecs.content).toContain("task_definitions: This endpoint doesn't implement ListTaskDefinitions yet.")
  })

  it('keeps a plain status when there is nothing to explain', () => {
    renderDashboard()
    expect(screen.queryByRole('button', { name: 's3 status: Available' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'kms status: Available' })).not.toBeInTheDocument()
  })

  it('sorts services the endpoint does not implement after the ones it does', () => {
    renderDashboard()
    fireEvent.click(screen.getByText('List'))
    const rows = createWrapper().findTable()!.findRows()
    const names = rows.map((row) => row.findAll('td')[1].getElement().textContent)
    expect(names).toEqual(['s3', 'sqs', 'ecs', 'elasticache', 'kms', 'athena', 'glue'])
  })

  it('still filters by name', () => {
    renderDashboard()
    fireEvent.change(screen.getAllByPlaceholderText('Find a service')[0], { target: { value: 'gl' } })
    expect(screen.getAllByText('Not supported')).toHaveLength(1)
    expect(screen.queryByText('Available')).not.toBeInTheDocument()
  })
})

describe('CloudscapeDashboard endpoint problems', () => {
  it.each([
    ['credentials', credentialsProblem],
    ['TLS', tlsProblem],
  ])('explains a %s problem once instead of failing every service', (_kind, problem) => {
    wsStats = statsWithProblem(problem)
    renderDashboard()

    const alert = createWrapper().findAlert()!
    expect(alert.findHeader()!.getElement()).toHaveTextContent(problem.message)
    expect(alert.findContent().getElement()).toHaveTextContent(problem.hint!)

    const original = createWrapper(alert.getElement()).findExpandableSection()!
    expect(original.findHeaderText()!.getElement()).toHaveTextContent('Original error')
    expect(original.findExpandedContent()).toBeNull()
    original.findExpandButton().click()
    expect(original.findExpandedContent()!.getElement()).toHaveTextContent(problem.cause!)

    expect(screen.getByText('0/3')).toBeInTheDocument()
    expect(createWrapper().findCards()).toBeNull()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    // The header doesn't claim a connection the alert says isn't there
    expect(screen.queryByText('Connected to local')).not.toBeInTheDocument()
    expect(screen.getByText('Endpoint: local')).toBeInTheDocument()

    fireEvent.click(within(alert.getElement()).getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalled()
  })

  it("shows the API's message when the stats can't be loaded at all", () => {
    // What useFetch keeps from the ApiError of a /api/stats that answered without JSON.
    wsStats = null
    wsError = '500: Internal Server Error'
    renderDashboard()

    const alert = createWrapper().findAlert()!
    expect(alert.findHeader()!.getElement()).toHaveTextContent('Could not load service stats')
    expect(alert.findContent().getElement()).toHaveTextContent('500: Internal Server Error')
    expect(screen.getByText('Endpoint: local')).toBeInTheDocument()
    fireEvent.click(within(alert.getElement()).getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalled()
  })

  it.each<[string, StatsResponse | null, string | null]>([
    ['an endpoint problem', statsWithProblem(credentialsProblem), null],
    ["stats that couldn't be loaded", null, '500: Internal Server Error'],
  ])('shows Retry working while the stats are asked for again, for %s', (_case, current, error) => {
    wsStats = current
    wsError = error
    wsLoading = true
    renderDashboard()

    const retry = createWrapper().findAlert()!.findActionSlot()!.findButton()!
    expect(retry.getElement()).toHaveTextContent('Retry')
    expect(retry.findLoadingIndicator()).not.toBeNull()
  })
})
