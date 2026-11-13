import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import type { ClassifiedError, StatsResponse } from '@/lib/types'

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'emulator',
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
      endpoint_url: 'https://127.0.0.1:9297',
      region: 'us-east-1',
      services_count: 4,
      connection_type: 'local',
      writes_enabled: false,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

// Shapes from backend/routes/stats.py (_service_result).
const notImplemented = (operation: string): ClassifiedError => ({
  kind: 'not_implemented',
  message: `This endpoint doesn't implement ${operation} yet.`,
  hint: 'The emulator returned NotImplemented. StackPort shows the rest of what the endpoint supports.',
  code: 'NotImplemented',
  operation,
  cause: `An error occurred (NotImplemented) when calling the ${operation} operation: ${operation} is not implemented`,
})

const internalFailure: ClassifiedError = {
  kind: 'other',
  message: 'We encountered an internal error. Please try again.',
  code: 'InternalFailure',
  operation: 'DescribeCacheClusters',
}

const unreachable: ClassifiedError = {
  kind: 'unreachable',
  message: "StackPort couldn't reach the endpoint.",
  hint: 'Check that the emulator is running and that the endpoint URL and port are right.',
  cause: 'Could not connect to the endpoint URL: "https://127.0.0.1:9297/"',
}

const statsPayload: StatsResponse = {
  services: {
    athena: { status: 'unsupported', resources: {}, error: notImplemented('ListWorkGroups') },
    ecs: {
      status: 'available',
      resources: { clusters: 2, task_definitions: 0 },
      errors: { task_definitions: notImplemented('ListTaskDefinitions') },
    },
    elasticache: { status: 'unavailable', resources: {}, error: internalFailure },
    glue: { status: 'available', resources: { databases: 0 } },
  },
  total_resources: 2,
  uptime_seconds: 60,
  problem: null,
}

/** The emulator once ElastiCache answers again. */
const recoveredStats: StatsResponse = {
  ...statsPayload,
  services: { ...statsPayload.services, elasticache: { status: 'available', resources: { clusters: 1 } } },
  total_resources: 3,
}

/** Every service fails the same way: the backend reports it once as `problem`. */
const unreachableStats: StatsResponse = {
  services: Object.fromEntries(
    ['athena', 'ecs', 'elasticache', 'glue'].map((name) => [
      name,
      { status: 'unavailable' as const, resources: {}, error: unreachable },
    ]),
  ),
  total_resources: 0,
  uptime_seconds: 60,
  problem: unreachable,
}

// /api/resources/{svc} lists every type and counts a failed one as empty.
const resourcesPayloads: Record<string, unknown> = {
  athena: { service: 'athena', resources: { workgroups: [], data_catalogs: [] } },
  ecs: {
    service: 'ecs',
    resources: {
      clusters: [
        { id: 'arn:aws:ecs:us-east-1:000000000000:cluster/web' },
        { id: 'arn:aws:ecs:us-east-1:000000000000:cluster/jobs' },
      ],
      task_definitions: [],
    },
  },
  elasticache: { service: 'elasticache', resources: { clusters: [] } },
  glue: { service: 'glue', resources: { databases: [] } },
}

const recoveredElastiCache = { service: 'elasticache', resources: { clusters: [{ id: 'sessions' }] } }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The list routes of the services with their own view that these tests open. */
const ownViewPayloads: Record<string, unknown> = {
  '/api/sns/topics': { topics: [] },
  '/api/kms/keys': { keys: [] },
}

/** A promise the test settles by hand, to control when an answer lands. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** What the mocked backend answers; tests change it to play the endpoint recovering. */
let backend: {
  /** A promise holds the answer back until the test settles it. */
  stats: StatsResponse | Promise<StatsResponse>
  resources: Record<string, unknown>
  /** How /api/resources/{svc} fails, when it does. */
  failResources: { status: number; body: unknown } | null
}
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  backend = { stats: statsPayload, resources: resourcesPayloads, failResources: null }
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://stackport.test')
    if (url.pathname === '/api/stats') return Promise.resolve(backend.stats).then((stats) => json(200, stats))
    if (url.pathname === '/api/tags/supported') return Promise.resolve(json(200, { supported: [] }))
    if (url.pathname in ownViewPayloads) return Promise.resolve(json(200, ownViewPayloads[url.pathname]))
    const service = url.pathname.match(/^\/api\/resources\/([^/]+)$/)?.[1]
    if (service && backend.failResources) {
      return Promise.resolve(json(backend.failResources.status, backend.failResources.body))
    }
    if (service && service in backend.resources) return Promise.resolve(json(200, backend.resources[service]))
    if (service) return Promise.resolve(json(404, { detail: `Unknown service: ${service}` }))
    return Promise.resolve(json(404, { detail: 'Not Found' }))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

function requestsTo(pathname: string) {
  return fetchMock.mock.calls.filter(([input]) => new URL(String(input), 'http://stackport.test').pathname === pathname)
    .length
}

function statsRequests() {
  return requestsTo('/api/stats')
}

function renderBrowser(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources" element={<CloudscapeResourceBrowser />} />
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

function pageAlert() {
  return createWrapper(createWrapper().findContentLayout()!.getElement()).findAlert()
}

/** Wait for the service's resource list to load: the Refresh button stops spinning. */
async function resourcesLoaded() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute('aria-disabled'))
}

function pageAlerts() {
  return createWrapper(createWrapper().findContentLayout()!.getElement()).findAllAlerts()
}

function retryButton() {
  const button = pageAlert()?.findActionSlot()?.findButton()
  if (!button) throw new Error('no Retry button')
  return button
}

function followSideNavLink(href: string) {
  createWrapper().findSideNavigation()!.findLinkByHref(href)!.click()
}

describe('CloudscapeResourceBrowser service statuses', () => {
  it('shows the same statuses as the dashboard in the service picker', async () => {
    renderBrowser('/resources')
    expect(await screen.findByText('Pick a service')).toBeInTheDocument()

    const cards = createWrapper().findCards()!
    const statusOf = (name: string) =>
      cards
        .findItems()
        .find((item) => item.findCardHeader()!.getElement().textContent === name)!
        .findSections()[0]
        .findContent()!
        .getElement().textContent
    expect(statusOf('ecs')).toBe('Available2 resources')
    expect(statusOf('glue')).toBe('Available0 resources')
    expect(statusOf('elasticache')).toBe('Unavailable0 resources')
    expect(statusOf('athena')).toBe('Not supported0 resources')

    fireEvent.click(screen.getByRole('button', { name: 'athena status: Not supported' }))
    const popover = createWrapper().findPopover()!
    expect(popover.findHeader({ renderWithPortal: true })!.getElement()).toHaveTextContent(
      'Not supported by this endpoint',
    )
    expect(popover.findContent({ renderWithPortal: true })!.getElement()).toHaveTextContent(
      "This endpoint doesn't implement ListWorkGroups yet.",
    )
  })

  it('lists services the endpoint does not implement last', async () => {
    renderBrowser('/resources')
    await screen.findByText('Pick a service')
    const names = createWrapper()
      .findCards()!
      .findItems()
      .map((item) => item.findCardHeader()!.getElement().textContent)
    expect(names).toEqual(['ecs', 'elasticache', 'glue', 'athena'])
  })

  it('explains an endpoint-wide problem once instead of failing every service', async () => {
    backend.stats = unreachableStats
    renderBrowser('/resources')

    expect(await screen.findByText(unreachable.message)).toBeInTheDocument()
    const alerts = pageAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0].findContent().getElement()).toHaveTextContent(unreachable.hint!)
    expect(createWrapper().findCards()).toBeNull()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()

    // Retry asks again, says so while it waits, and the picker comes back once the endpoint answers
    expect(retryButton().findLoadingIndicator()).toBeNull()
    const retry = deferred<StatsResponse>()
    backend.stats = retry.promise
    const requestsBefore = statsRequests()
    fireEvent.click(within(alerts[0].getElement()).getByRole('button', { name: 'Retry' }))
    expect(statsRequests()).toBe(requestsBefore + 1)
    expect(retryButton().findLoadingIndicator()).not.toBeNull()

    await act(async () => {
      retry.resolve(statsPayload)
    })
    expect(await screen.findByText('Pick a service')).toBeInTheDocument()
    expect(pageAlert()).toBeNull()
  })
})

describe('CloudscapeResourceBrowser generic error path', () => {
  it('says the endpoint does not support a service and leaves out its empty tabs', async () => {
    renderBrowser('/resources/athena')
    expect(await screen.findByText("This endpoint doesn't support athena")).toBeInTheDocument()
    const alert = pageAlert()!
    expect(alert.getElement()).toHaveTextContent("This endpoint doesn't implement ListWorkGroups yet.")
    expect(alert.getElement()).toHaveTextContent('The emulator returned NotImplemented.')
    expect(screen.queryByText('Could not load resources')).not.toBeInTheDocument()

    const original = createWrapper(alert.getElement()).findExpandableSection()!
    expect(original.findExpandedContent()).toBeNull()
    original.findExpandButton().click()
    expect(original.findExpandedContent()!.getElement()).toHaveTextContent(
      'An error occurred (NotImplemented) when calling the ListWorkGroups operation',
    )

    // The list answered (with nothing): wait for it before checking what it rendered
    await resourcesLoaded()
    expect(createWrapper().findTabs()).toBeNull()
    expect(screen.queryByText(/workgroups/)).not.toBeInTheDocument()
    expect(screen.queryByText('No resources found for athena')).not.toBeInTheDocument()
  })

  it('names the resource types a partly available service could not list', async () => {
    renderBrowser('/resources/ecs')
    expect(await screen.findByText("Some resource types weren't listed")).toBeInTheDocument()
    expect(pageAlert()!.findContent().getElement()).toHaveTextContent(
      "task_definitions: This endpoint doesn't implement ListTaskDefinitions yet.",
    )
    expect(await screen.findByText('clusters (2)')).toBeInTheDocument()
  })

  it('explains why an unavailable service has no resources, without empty tabs', async () => {
    renderBrowser('/resources/elasticache')
    expect(await screen.findByText("StackPort couldn't list elasticache resources")).toBeInTheDocument()
    expect(pageAlert()!.findContent().getElement()).toHaveTextContent(
      'We encountered an internal error. Please try again.',
    )
    await resourcesLoaded()
    expect(createWrapper().findTabs()).toBeNull()
    expect(screen.queryByText('clusters (0)')).not.toBeInTheDocument()
  })

  it('shows the endpoint problem on a service page instead of blaming the service', async () => {
    backend.stats = unreachableStats
    renderBrowser('/resources/elasticache')
    expect(await screen.findByText(unreachable.message)).toBeInTheDocument()
    await resourcesLoaded()
    expect(pageAlerts()).toHaveLength(1)
    expect(screen.queryByText("StackPort couldn't list elasticache resources")).not.toBeInTheDocument()
    expect(createWrapper().findTabs()).toBeNull()

    // Retry reloads the stats with the resources, and says so until both are back
    const retry = deferred<StatsResponse>()
    backend.stats = retry.promise
    backend.resources = { ...resourcesPayloads, elasticache: recoveredElastiCache }
    fireEvent.click(retryButton().getElement())
    expect(retryButton().findLoadingIndicator()).not.toBeNull()
    expect(await screen.findByText('clusters (1)')).toBeInTheDocument()
    expect(retryButton().findLoadingIndicator()).not.toBeNull()

    await act(async () => {
      retry.resolve(recoveredStats)
    })
    await waitFor(() => expect(pageAlert()).toBeNull())
  })

  it('has nothing to add for a service that answered every call', async () => {
    renderBrowser('/resources/glue')
    expect(await screen.findByText('databases (0)')).toBeInTheDocument()
    expect(pageAlert()).toBeNull()
  })

  it("shows the API's message when the resources can't be loaded", async () => {
    renderBrowser('/resources/nosuch')
    expect(await screen.findByText('Could not load resources')).toBeInTheDocument()
    expect(pageAlert()!.findContent().getElement()).toHaveTextContent('Unknown service: nosuch')
  })

  it('adds the hint when the backend classified why the resources could not be loaded', async () => {
    const credentials: ClassifiedError = {
      kind: 'credentials',
      message: "The endpoint rejected StackPort's credentials (InvalidClientTokenId).",
      hint: 'Check the credentials this endpoint uses in Settings, or the AWS_* variables StackPort runs with.',
      code: 'InvalidClientTokenId',
    }
    backend.failResources = { status: 401, body: { detail: credentials.message, error: credentials } }
    renderBrowser('/resources/glue')

    expect(await screen.findByText('Could not load resources')).toBeInTheDocument()
    const content = pageAlert()!.findContent().getElement()
    expect(content).toHaveTextContent(credentials.message)
    expect(content).toHaveTextContent(credentials.hint!)
  })
})

describe('CloudscapeResourceBrowser keeps the status alert in step with the table', () => {
  it('drops the alert once Refresh lists the service', async () => {
    renderBrowser('/resources/elasticache')
    expect(await screen.findByText("StackPort couldn't list elasticache resources")).toBeInTheDocument()

    backend.stats = recoveredStats
    backend.resources = { ...resourcesPayloads, elasticache: recoveredElastiCache }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('clusters (1)')).toBeInTheDocument()
    await waitFor(() => expect(pageAlert()).toBeNull())
  })

  it('drops the alert once Retry loads the resources', async () => {
    backend.failResources = { status: 500, body: { detail: 'We encountered an internal error. Please try again.' } }
    renderBrowser('/resources/elasticache')
    expect(await screen.findByText('Could not load resources')).toBeInTheDocument()

    backend.failResources = null
    backend.stats = recoveredStats
    backend.resources = { ...resourcesPayloads, elasticache: recoveredElastiCache }
    fireEvent.click(within(pageAlert()!.getElement()).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('clusters (1)')).toBeInTheDocument()
    await waitFor(() => expect(pageAlert()).toBeNull())
  })

  it("doesn't look at the stats again between services with their own view", async () => {
    // Those views only take the side nav's service names from the stats
    backend.stats = {
      ...statsPayload,
      services: {
        ...statsPayload.services,
        kms: { status: 'available', resources: { keys: 0 } },
        sns: { status: 'available', resources: { topics: 0 } },
      },
    }
    renderBrowser('/resources/sns')
    await waitFor(() => expect(requestsTo('/api/sns/topics')).toBe(1))
    // One for the shell's service search, one for this page
    await waitFor(() => expect(statsRequests()).toBe(2))

    followSideNavLink('/resources/kms')
    await waitFor(() => expect(requestsTo('/api/kms/keys')).toBe(1))
    expect(await screen.findByText('Keys')).toBeInTheDocument()
    expect(statsRequests()).toBe(2)

    // A generic page shows the service's status, so it does
    followSideNavLink('/resources/glue')
    expect(await screen.findByText('databases (0)')).toBeInTheDocument()
    expect(statsRequests()).toBe(3)
  })

  it('looks at the stats again for the service picked next', async () => {
    renderBrowser('/resources/glue')
    expect(await screen.findByText('databases (0)')).toBeInTheDocument()

    backend.stats = recoveredStats
    backend.resources = { ...resourcesPayloads, elasticache: recoveredElastiCache }
    createWrapper().findSideNavigation()!.findLinkByHref('/resources/elasticache')!.click()

    expect(await screen.findByText('clusters (1)')).toBeInTheDocument()
    await waitFor(() => expect(pageAlert()).toBeNull())
    expect(screen.queryByText("StackPort couldn't list elasticache resources")).not.toBeInTheDocument()
  })
})
