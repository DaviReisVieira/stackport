import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import type { ActivityEvent, ActivityPage, HealthResponse } from '@/lib/types'

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [],
    loading: false,
    revision: 0,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const exportData = vi.fn()
vi.mock('@/lib/export', () => ({ exportData: (...args: unknown[]) => exportData(...args) }))

import CloudscapeActivity from '@/pages/CloudscapeActivity'

const HOUR = 3_600_000

function event(eventName: string, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  const record = {
    eventVersion: '1.09',
    eventName,
    eventSource: 'sqs.amazonaws.com',
    requestParameters: { queueName: 'orders' },
    sourceIPAddress: '203.0.113.7',
  }
  return {
    eventId: `${eventName}-id`,
    eventName,
    eventSource: 'sqs.amazonaws.com',
    eventTime: '2026-11-14T12:00:00Z',
    username: 'alice',
    accessKeyId: 'AKIAEXAMPLE',
    readOnly: false,
    resources: [],
    errorCode: null,
    errorMessage: null,
    sourceIpAddress: '203.0.113.7',
    userAgent: 'aws-cli/2.17.0',
    awsRegion: 'us-east-1',
    record,
    rawRecord: null,
    ...overrides,
  }
}

const DELETE_QUEUE = event('DeleteQueue', { resources: [{ type: 'AWS::SQS::Queue', name: 'orders' }] })
const DELETE_USER = event('DeleteUser', {
  eventSource: 'iam.amazonaws.com',
  errorCode: 'NoSuchEntityException',
  errorMessage: 'The user with name ghost cannot be found.',
  record: { eventName: 'DeleteUser', requestParameters: { userName: 'ghost' }, errorCode: 'NoSuchEntityException' },
})
const CREATE_ROLE = event('CreateRole', { eventSource: 'iam.amazonaws.com', record: { eventName: 'CreateRole', requestParameters: { roleName: 'app' } } })

function page(events: ActivityEvent[], overrides: Partial<ActivityPage> = {}): ActivityPage {
  return { events, nextToken: null, startTime: '2026-11-14T11:00:00Z', endTime: null, ...overrides }
}

let answerEvents: (params: URLSearchParams) => Response
let fetchMock: ReturnType<typeof vi.fn>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const health: HealthResponse = {
  status: 'ok',
  version: 'test',
  uptime_seconds: 1,
  endpoint_url: 'https://127.0.0.1:9621',
  region: 'us-east-1',
  services_count: 51,
  connection_type: 'local',
  writes_enabled: true,
  emulator: { id: 'aws-emulator', name: 'AWS Emulator' },
}

beforeEach(() => {
  localStorage.clear()
  exportData.mockReset()
  answerEvents = () => json(page([DELETE_QUEUE, DELETE_USER, CREATE_ROLE]))
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://stackport.test')
    if (url.pathname === '/api/health') return Promise.resolve(json(health))
    if (url.pathname === '/api/stats') return Promise.resolve(json({ services: {}, total_resources: 0, uptime_seconds: 1 }))
    if (url.pathname === '/api/activity/events') return Promise.resolve(answerEvents(url.searchParams))
    return Promise.resolve(json({ detail: 'Not Found' }, 404))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderActivity(path = '/activity') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/activity"
          element={
            <>
              <CloudscapeActivity />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** The query of each lookup the page asked the backend for. */
function lookups(): URLSearchParams[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://stackport.test'))
    .filter((url) => url.pathname === '/api/activity/events')
    .map((url) => url.searchParams)
}

function location(): URLSearchParams {
  return new URLSearchParams((screen.getByTestId('location').textContent ?? '').split('?')[1] ?? '')
}

function table() {
  return createWrapper().findTable()!
}

/** The lookup attribute's Select, the first control of the table's filter. */
function attributeSelect() {
  return table().findFilterSlot()!.findSelect()!
}

/** The modal that is open (the keyboard shortcuts one is always there, hidden). */
function openModal() {
  const modal = createWrapper()
    .findAllModals()
    .find((found) => found.isVisible())
  expect(modal).toBeDefined()
  return modal!
}

function eventNames(): string[] {
  return table()
    .findRows()
    .map((row) => row.findAll('td')[1].getElement().textContent ?? '')
}

async function rowsShown(names: string[]) {
  await waitFor(() => expect(eventNames()).toEqual(names))
}

function expectAbout(iso: string | null, expected: number) {
  expect(iso).not.toBeNull()
  expect(Math.abs(Date.parse(iso ?? '') - expected)).toBeLessThan(5_000)
}

describe('Activity', () => {
  it('looks up the last hour of write calls on the active endpoint, newest first', async () => {
    renderActivity()
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])

    const [query] = lookups()
    expect([...query.keys()].sort()).toEqual(['attribute', 'endpoint', 'start_time', 'value'])
    expect(query.get('endpoint')).toBe('local')
    expect(query.get('attribute')).toBe('ReadOnly')
    expect(query.get('value')).toBe('false')
    expectAbout(query.get('start_time'), Date.now() - HOUR)

    const failed = table().findRows()[1]
    expect(failed.getElement()).toHaveTextContent('NoSuchEntityException')
    expect(table().findRows()[0].getElement()).toHaveTextContent('orders')
    expect(screen.getByText('Where Read-only is false')).toBeInTheDocument()
  })

  it('takes its filters from the URL, and keeps the text filter in the browser', async () => {
    renderActivity('/activity?attribute=EventSource&value=iam.amazonaws.com&range=15m&filter=ghost')
    await rowsShown(['DeleteUser'])

    const [query] = lookups()
    expect(query.get('attribute')).toBe('EventSource')
    expect(query.get('value')).toBe('iam.amazonaws.com')
    expectAbout(query.get('start_time'), Date.now() - 15 * 60_000)
    expect(query.has('end_time')).toBe(false)
    expect(query.has('filter')).toBe(false)
    expect(screen.getByRole('heading', { name: /Events/ })).toHaveTextContent('(1/3)')
  })

  it('falls back to the default lookup for an attribute CloudTrail does not have', async () => {
    renderActivity('/activity?attribute=constructor&value=x&range=0h')
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])
    const [query] = lookups()
    expect(query.get('attribute')).toBe('ReadOnly')
    expect(query.get('value')).toBe('false')
    expectAbout(query.get('start_time'), Date.now() - HOUR)
  })

  it('sends an absolute range as it is', async () => {
    renderActivity('/activity?start=2026-11-14T09:00:00.000Z&end=2026-11-14T10:30:00.000Z&attribute=none')
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])
    const [query] = lookups()
    expect(query.get('start_time')).toBe('2026-11-14T09:00:00.000Z')
    expect(query.get('end_time')).toBe('2026-11-14T10:30:00.000Z')
    expect(query.has('attribute')).toBe(false)
    expect(query.has('value')).toBe(false)
  })

  it('looks up the attribute and value picked, one at a time', async () => {
    renderActivity()
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])

    attributeSelect().openDropdown()
    attributeSelect().selectOptionByValue('EventName')
    const value = screen.getByRole('searchbox', { name: 'Event name' })
    fireEvent.change(value, { target: { value: ' CreateRole ' } })
    // Nothing is looked up until the value is applied
    expect(lookups()).toHaveLength(1)
    fireEvent.keyDown(value, { key: 'Enter', keyCode: 13 })

    await waitFor(() => expect(lookups()).toHaveLength(2))
    expect(lookups()[1].get('attribute')).toBe('EventName')
    expect(lookups()[1].get('value')).toBe('CreateRole')
    expect(location().get('attribute')).toBe('EventName')
    expect(location().get('value')).toBe('CreateRole')

    attributeSelect().openDropdown()
    attributeSelect().selectOptionByValue('none')
    await waitFor(() => expect(lookups()).toHaveLength(3))
    expect(lookups()[2].has('attribute')).toBe(false)
    expect(location().get('attribute')).toBe('none')

    // Read-only has two values, so picking it looks up at once
    attributeSelect().openDropdown()
    attributeSelect().selectOptionByValue('ReadOnly')
    await waitFor(() => expect(lookups()).toHaveLength(4))
    expect(lookups()[3].get('value')).toBe('false')
    const readOnly = table().findFilterSlot()!.findAllSelects()[1]
    readOnly.openDropdown()
    readOnly.selectOptionByValue('true')
    await waitFor(() => expect(lookups()).toHaveLength(5))
    expect(lookups()[4].get('attribute')).toBe('ReadOnly')
    expect(lookups()[4].get('value')).toBe('true')
  })

  it('picks a time range and keeps it in the URL', async () => {
    renderActivity()
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])

    const picker = createWrapper().findDateRangePicker()!
    picker.openDropdown()
    const dropdown = picker.findDropdown({ expandToViewport: true })!
    dropdown.findRelativeRangeRadioGroup()!.findInputByValue('3h')!.click()
    dropdown.findApplyButton().click()

    await waitFor(() => expect(lookups()).toHaveLength(2))
    expectAbout(lookups()[1].get('start_time'), Date.now() - 3 * HOUR)
    expect(location().get('range')).toBe('3h')
  })

  it('loads older events by continuing the same lookup with its token', async () => {
    answerEvents = (params) =>
      json(
        params.get('next_token') === 'page-2'
          ? page([CREATE_ROLE], { startTime: '2026-11-14T11:00:07Z' })
          : page([DELETE_QUEUE, DELETE_USER], { nextToken: 'page-2', startTime: '2026-11-14T11:00:07Z' }),
      )
    renderActivity('/activity?attribute=EventSource&value=sqs.amazonaws.com')
    await rowsShown(['DeleteQueue', 'DeleteUser'])
    expect(screen.getByRole('heading', { name: /Events/ })).toHaveTextContent('(2+)')

    fireEvent.click(screen.getByRole('button', { name: 'Load older events' }))
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])

    const older = lookups()[1]
    expect(older.get('next_token')).toBe('page-2')
    // The window the first page used, as the backend echoed it
    expect(older.get('start_time')).toBe('2026-11-14T11:00:07Z')
    expect(older.has('end_time')).toBe(false)
    expect(older.get('attribute')).toBe('EventSource')
    expect(older.get('value')).toBe('sqs.amazonaws.com')
    expect(screen.queryByRole('button', { name: 'Load older events' })).not.toBeInTheDocument()
  })

  it('opens an event with its whole record, to copy or export', async () => {
    renderActivity()
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])
    fireEvent.click(screen.getByRole('link', { name: 'DeleteUser' }))

    const modal = await waitFor(openModal)
    const content = within(modal.getElement())
    expect(content.getByText('The user with name ghost cannot be found.')).toBeInTheDocument()
    expect(content.getByText(/"userName": "ghost"/)).toBeInTheDocument()
    expect(modal.findContent().findCopyToClipboard()).not.toBeNull()

    fireEvent.click(content.getByRole('button', { name: 'Export JSON' }))
    expect(exportData).toHaveBeenCalledWith({ service: 'cloudtrail', resourceType: 'event', data: [DELETE_USER.record], format: 'json' })
  })

  it('shows a record that is not valid JSON as the endpoint sent it', async () => {
    const broken = event('CreateQueue', { record: null, rawRecord: '{"eventName": "CreateQueue", ' })
    answerEvents = () => json(page([broken]))
    renderActivity()
    await rowsShown(['CreateQueue'])
    fireEvent.click(screen.getByRole('link', { name: 'CreateQueue' }))

    const content = within((await waitFor(openModal)).getElement())
    expect(await content.findByText(/isn't a JSON object, so it's shown as it came/)).toBeInTheDocument()
    expect(content.getByText('{"eventName": "CreateQueue",')).toBeInTheDocument()
    fireEvent.click(content.getByRole('button', { name: 'Export JSON' }))
    expect(exportData).toHaveBeenCalledWith({ service: 'cloudtrail', resourceType: 'event', data: [broken], format: 'json' })
  })

  it('exports the events shown', async () => {
    renderActivity('/activity?filter=ghost')
    await rowsShown(['DeleteUser'])
    const dropdown = createWrapper().findButtonDropdown()!
    dropdown.openDropdown()
    dropdown.findItemById('csv')!.click()
    const [[options]] = exportData.mock.calls as [[{ data: Record<string, unknown>[]; format: string }]]
    expect(options.format).toBe('csv')
    expect(options.data).toEqual([
      expect.objectContaining({ eventName: 'DeleteUser', errorCode: 'NoSuchEntityException', eventSource: 'iam.amazonaws.com' }),
    ])
    expect(options.data[0]).not.toHaveProperty('record')
  })

  it('says when there is nothing, and that reads are left out', async () => {
    answerEvents = () => json(page([]))
    renderActivity()
    expect(await screen.findByText(/Nothing where Read-only is false in this time range/)).toBeInTheDocument()
    expect(screen.getByText(/Calls that only read are left out/)).toBeInTheDocument()
  })

  it('says when the endpoint does not implement LookupEvents', async () => {
    const message = "This endpoint doesn't implement LookupEvents yet."
    answerEvents = () =>
      json(
        { detail: message, error: { kind: 'not_implemented', message, code: 'InternalFailure', operation: 'LookupEvents' } },
        501,
      )
    renderActivity()
    expect(await screen.findByRole('heading', { name: 'Not supported by this endpoint' })).toBeInTheDocument()
    expect(screen.getByText(/doesn't implement CloudTrail's LookupEvents/)).toBeInTheDocument()
    expect(createWrapper().findTable()).toBeNull()
  })

  it('refreshes every 10 seconds when asked, and not while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderActivity()
    await rowsShown(['DeleteQueue', 'DeleteUser', 'CreateRole'])
    expect(lookups()).toHaveLength(1)

    act(() => createWrapper().findToggle()!.findNativeInput().click())
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(lookups()).toHaveLength(2)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(lookups()).toHaveLength(2)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(lookups()).toHaveLength(3)
  })
})
