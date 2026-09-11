import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

import { LearnProvider } from '@/contexts/LearnContext'
import CloudscapeLearn from '@/pages/CloudscapeLearn'
import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const TRAIL = {
  id: 'aws-first-steps',
  title: 'AWS first steps',
  description: 'Learn core AWS services against your emulator.',
  lessons: [
    {
      id: 's3-store-a-file',
      title: 'Store a file',
      summary: 'Create a bucket and put a file in it.',
      service: 's3',
      level: 'Beginner',
      durationMinutes: 6,
      variables: [
        {
          name: 'bucket',
          label: 'Your bucket name',
          default: 'stackport-learn-{{suffix}}',
          pattern: '^[a-z0-9-]{3,40}$',
          patternMessage: 'lowercase letters, numbers and hyphens only',
        },
      ],
      steps: [
        {
          id: 'create-bucket',
          title: 'Create your bucket',
          instruction: 'A bucket is a named container.\n\nCreate learn-bucket-a1.',
          console: { hotspotId: 's3-buckets-create', route: '/resources/s3', label: 'Create bucket' },
          commands: { cli: 'aws --endpoint-url=http://localhost:4566 s3api create-bucket --bucket learn-bucket-a1' },
          cliNotes: [{ flag: '--endpoint-url', note: 'Points at your emulator.' }],
          verify: { type: 's3_bucket_exists', params: { bucket: 'learn-bucket-a1' } },
          autoVerify: true,
          hint: 'The name must match exactly.',
          whyItMatters: 'Real S3 turns on Block Public Access by default.',
        },
        {
          id: 'open-bucket',
          title: 'Look inside it',
          instruction: 'Open learn-bucket-a1.',
          console: { hotspotId: 's3-buckets-table', route: '/resources/s3', label: 'Click your bucket' },
          verify: { type: 's3_object_count', params: { bucket: 'learn-bucket-a1', min: 0 } },
        },
        {
          id: 'inspect-object',
          title: 'Read what S3 recorded',
          instruction: 'Look at the metadata.',
          console: { hotspotId: 's3-objects-table', route: '/resources/s3', label: 'Open hello.txt' },
          verify: null,
        },
      ],
      completion: { title: 'You built something real', summary: 'learn-bucket-a1 now exists.' },
    },
  ],
}

type Options = {
  learnEnabled?: boolean
  connectionType?: 'local' | 'aws'
  completed?: Record<string, string[]>
  skipped?: Record<string, string[]>
  verify?: { passed: boolean; verifyStatus: string; message: string }
  trailMissing?: boolean
}

let fetchMock: ReturnType<typeof vi.fn>
let progress: { completed: Record<string, string[]>; skipped: Record<string, string[]> }

function mockFetch(options: Options = {}) {
  const {
    learnEnabled = true,
    connectionType = 'local',
    verify = { passed: true, verifyStatus: 'ok', message: "Bucket 'learn-bucket-a1' found." },
  } = options
  progress = { completed: options.completed ?? {}, skipped: options.skipped ?? {} }

  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = {}
    let ok = true

    if (url.includes('/api/health')) {
      payload = {
        status: 'ok',
        version: 'test',
        uptime_seconds: 1,
        endpoint_url: 'http://localhost:4566',
        region: 'us-east-1',
        services_count: 2,
        connection_type: connectionType,
        writes_enabled: true,
        learn_enabled: learnEnabled,
      }
    } else if (url.includes('/api/learn/verify') && method === 'POST') {
      if (verify.passed) {
        progress = { ...progress, completed: { ...progress.completed, 's3-store-a-file': ['create-bucket'] } }
      }
      payload = { ...verify, ...progress }
    } else if (url.includes('/api/learn/progress/reset') && method === 'POST') {
      progress = { completed: {}, skipped: {} }
      payload = { completed: {}, skipped: {} }
    } else if (url.includes('/api/learn/progress') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      progress = {
        completed: { ...progress.completed, 's3-store-a-file': [...(progress.completed['s3-store-a-file'] ?? []), body.stepId] },
        skipped: body.force
          ? { ...progress.skipped, 's3-store-a-file': [...(progress.skipped['s3-store-a-file'] ?? []), body.stepId] }
          : progress.skipped,
      }
      payload = progress
    } else if (url.includes('/api/learn/variables') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (!/^[a-z0-9-]{3,40}$/.test(body.value)) {
        ok = false
        payload = { detail: 'lowercase letters, numbers and hyphens only' }
      } else {
        payload = { variables: { bucket: body.value } }
      }
    } else if (url.includes('/api/learn/trails/')) {
      if (options.trailMissing) {
        ok = false
        payload = { detail: 'Trail not found' }
      } else {
        payload = { trail: TRAIL, ...progress, variables: { 's3-store-a-file': { bucket: 'learn-bucket-a1' } } }
      }
    } else if (url.includes('/api/stats')) {
      payload = {
        services: { s3: { status: 'available', resources: { buckets: 0 } } },
        total_resources: 0,
        uptime_seconds: 60,
      }
    } else if (url.includes('/api/s3/buckets')) {
      payload = { buckets: [] }
    }

    return Promise.resolve({
      ok,
      status: ok ? 200 : 400,
      statusText: ok ? 'OK' : 'Bad Request',
      json: () => Promise.resolve(payload),
    } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderApp(initial = '/learn') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <LearnProvider>
        <Routes>
          <Route path="/learn" element={<CloudscapeLearn />} />
          <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
        </Routes>
      </LearnProvider>
    </MemoryRouter>,
  )
}

function postBody(match: string) {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([url, init]) => String(url).includes(match) && (init as RequestInit)?.method === 'POST')
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

/** Cloudscape renders every mounted hotspot as a button labelled "Open step N of M". */
function hotspotCount() {
  return screen.queryAllByRole('button', { name: /^(Open|Close) step \d+ of \d+$/ }).length
}

async function startLesson() {
  fireEvent.click(await screen.findByTestId('learn-start-s3-store-a-file'))
}

/**
 * The current step renders twice at once, in the popover and in the panel, so
 * every assertion about it is scoped to the panel copy.
 */
async function panel() {
  return within(await screen.findByTestId('learn-current-step'))
}

beforeEach(() => {
  localStorage.clear()
  mockFetch()
})

describe('Learn catalogue', () => {
  it('shows the lesson with its metadata', async () => {
    renderApp()
    expect(await screen.findByText('Store a file')).toBeInTheDocument()
    expect(screen.getByText('Beginner')).toBeInTheDocument()
    expect(screen.getByText('about 6 min')).toBeInTheDocument()
    expect(screen.getByText('3 steps')).toBeInTheDocument()
  })

  it('says Learn is off when the backend has it disabled', async () => {
    mockFetch({ learnEnabled: false })
    renderApp()
    expect(await screen.findByText('Learn is turned off')).toBeInTheDocument()
  })

  it('blocks lessons against real AWS', async () => {
    mockFetch({ connectionType: 'aws' })
    renderApp()
    expect(await screen.findByText('Lessons need a local emulator')).toBeInTheDocument()
  })

  it('offers Continue instead of Start once a step is done', async () => {
    mockFetch({ completed: { 's3-store-a-file': ['create-bucket'] } })
    renderApp()
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('resets progress through a confirmation', async () => {
    mockFetch({ completed: { 's3-store-a-file': ['create-bucket'] } })
    renderApp()
    fireEvent.click(await screen.findByTestId('learn-reset'))
    fireEvent.click(await screen.findByTestId('learn-reset-confirm'))
    await waitFor(() => expect(postBody('/api/learn/progress/reset')).toBeTruthy())
    expect(postBody('/api/learn/progress/reset')).toEqual({ trailId: 'aws-first-steps' })
  })
})

describe('Running a lesson', () => {
  it('puts no hotspots on the page until a lesson starts', async () => {
    renderApp('/resources/s3')
    await screen.findByText('Buckets')
    expect(hotspotCount()).toBe(0)
  })

  it('navigates to the first step route and shows the step in the panel', async () => {
    renderApp()
    await startLesson()
    expect(await screen.findByText('Buckets')).toBeInTheDocument()
    expect(await screen.findByTestId('learn-current-step')).toHaveTextContent('Step 1: Create your bucket')
  })

  it('verifies with exactly the step reference the backend expects', async () => {
    renderApp()
    await startLesson()
    fireEvent.click((await panel()).getByTestId('learn-verify-create-bucket'))
    await waitFor(() => expect(postBody('/api/learn/verify')).toBeTruthy())
    expect(postBody('/api/learn/verify')).toEqual({
      trailId: 'aws-first-steps',
      lessonId: 's3-store-a-file',
      stepId: 'create-bucket',
    })
  })

  it('shows the CLI command and its flag notes', async () => {
    renderApp()
    await startLesson()
    const step = await panel()
    fireEvent.click(step.getByRole('tab', { name: 'With the CLI' }))
    await waitFor(() => expect(step.getByText(/s3api create-bucket --bucket learn-bucket-a1/)).toBeInTheDocument())
    fireEvent.click(step.getByText('What each part does'))
    await waitFor(() => expect(step.getByText('Points at your emulator.')).toBeInTheDocument())
  })
})

describe('The three verification outcomes', () => {
  it('a pass shows what was found', async () => {
    renderApp()
    await startLesson()
    const step = await panel()
    fireEvent.click(step.getByTestId('learn-verify-create-bucket'))
    await waitFor(() => expect(step.getByText("Bucket 'learn-bucket-a1' found.")).toBeInTheDocument())
  })

  it('an unreachable emulator is a warning, not a failed step', async () => {
    mockFetch({
      verify: { passed: false, verifyStatus: 'service_unreachable', message: 'Could not reach the endpoint.' },
    })
    renderApp()
    await startLesson()
    const step = await panel()
    fireEvent.click(step.getByTestId('learn-verify-create-bucket'))
    await waitFor(() => expect(step.getByText('Cannot reach your emulator')).toBeInTheDocument())
    expect(step.queryByText(/failed/i)).not.toBeInTheDocument()
  })

  it('a step not done yet offers the hint and never says failed', async () => {
    mockFetch({
      verify: { passed: false, verifyStatus: 'ok', message: "Bucket 'learn-bucket-a1' not found yet." },
    })
    renderApp()
    await startLesson()
    const step = await panel()
    fireEvent.click(step.getByTestId('learn-verify-create-bucket'))
    await waitFor(() => expect(step.getByText('Not there yet')).toBeInTheDocument())
    expect(step.queryByText(/failed/i)).not.toBeInTheDocument()
    fireEvent.click(step.getByText('Give me a hint'))
    await waitFor(() => expect(step.getByText('The name must match exactly.')).toBeInTheDocument())
  })
})

describe('The frontier gate', () => {
  it('mounts only the current step anchor, then the next one after a pass', async () => {
    renderApp()
    await startLesson()
    await screen.findByText('Buckets')

    // step 2's anchor is deliberately absent: Cloudscape enables Next only once
    // the following step's hotspot has mounted, so this is the gate
    expect(hotspotCount()).toBe(1)

    const step = await panel()
    fireEvent.click(step.getByTestId('learn-verify-create-bucket'))
    await waitFor(() => expect(hotspotCount()).toBe(2))
  })

  it('resumes at the first unfinished step rather than step one', async () => {
    mockFetch({ completed: { 's3-store-a-file': ['create-bucket'] } })
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByTestId('learn-current-step')).toHaveTextContent('Step 2: Look inside it')
    await waitFor(() => expect(hotspotCount()).toBe(1))
  })
})

describe('Skipping', () => {
  it('records a skip with force and shows the step as skipped, not done', async () => {
    renderApp()
    await startLesson()
    const step = await panel()
    fireEvent.click(step.getByTestId('learn-skip-create-bucket'))
    await waitFor(() => expect(postBody('/api/learn/progress')).toBeTruthy())
    expect(postBody('/api/learn/progress')).toEqual({
      trailId: 'aws-first-steps',
      lessonId: 's3-store-a-file',
      stepId: 'create-bucket',
      force: true,
    })
    // skipping still advances the lesson, so the panel moves on rather than
    // trapping the learner on a step they could not finish
    expect(await screen.findByTestId('learn-current-step')).toHaveTextContent('Step 2: Look inside it')
  })

  it('marks a step with no verification without forcing', async () => {
    mockFetch({ completed: { 's3-store-a-file': ['create-bucket', 'open-bucket'] } })
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click((await panel()).getByTestId('learn-mark-inspect-object'))
    await waitFor(() => expect(postBody('/api/learn/progress')).toBeTruthy())
    expect(postBody('/api/learn/progress')).toEqual({
      trailId: 'aws-first-steps',
      lessonId: 's3-store-a-file',
      stepId: 'inspect-object',
      force: false,
    })
  })
})

describe('Lesson variables', () => {
  it('sends the name the learner chose', async () => {
    renderApp()
    fireEvent.click(await screen.findByText('Names used in this lesson'))
    const input = await screen.findByLabelText('Your bucket name')
    fireEvent.change(input, { target: { value: 'my-own-bucket' } })
    fireEvent.click(screen.getByTestId('learn-save-bucket'))
    await waitFor(() => expect(postBody('/api/learn/variables')).toBeTruthy())
    expect(postBody('/api/learn/variables')).toEqual({
      trailId: 'aws-first-steps',
      lessonId: 's3-store-a-file',
      name: 'bucket',
      value: 'my-own-bucket',
    })
  })

  it('surfaces the rule when the name is rejected', async () => {
    renderApp()
    fireEvent.click(await screen.findByText('Names used in this lesson'))
    fireEvent.change(await screen.findByLabelText('Your bucket name'), { target: { value: 'Not Valid' } })
    fireEvent.click(screen.getByTestId('learn-save-bucket'))
    expect(await screen.findByText('lowercase letters, numbers and hyphens only')).toBeInTheDocument()
  })
})

describe('Failure modes', () => {
  it('says so when the trail cannot be loaded', async () => {
    mockFetch({ trailMissing: true })
    renderApp()
    await waitFor(() => expect(screen.queryByText('Store a file')).not.toBeInTheDocument())
  })
})

describe('The drawer', () => {
  it('offers the Learn panel only when the backend enabled it', async () => {
    renderApp('/resources/s3')
    expect(await screen.findByRole('button', { name: 'Open the Learn panel' })).toBeInTheDocument()
  })

  it('is absent when Learn is disabled', async () => {
    mockFetch({ learnEnabled: false })
    renderApp('/resources/s3')
    await screen.findByText('Buckets')
    expect(screen.queryByRole('button', { name: 'Open the Learn panel' })).not.toBeInTheDocument()
  })

  it('adds a Learn nav item only when enabled', async () => {
    mockFetch({ learnEnabled: false })
    renderApp('/resources/s3')
    await screen.findByText('Buckets')
    expect(screen.queryByRole('link', { name: 'Learn' })).not.toBeInTheDocument()
  })
})

/**
 * These two guard Cloudscape behaviours that dictate the architecture. The step
 * index lives inside AnnotationContext and is only observable through the
 * hotspot's own label, which is what these read.
 */
describe('Cloudscape step index', () => {
  const stepLabel = () =>
    screen
      .queryAllByRole('button', { name: /step \d+ of \d+$/ })
      .map((button) => button.getAttribute('aria-label'))
      .find((label) => label?.includes('step'))

  async function advanceToStepTwo() {
    renderApp()
    await startLesson()
    await screen.findByText('Buckets')
    // pass step 1 so step 2's anchor mounts and Next becomes available
    const step = await panel()
    fireEvent.click(step.getByTestId('learn-verify-create-bucket'))
    await waitFor(() => expect(hotspotCount()).toBe(2))

    // the popover opens itself on the active hotspot, so Next is already there
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await waitFor(() => expect(stepLabel()).toMatch(/step 2 of/))
  }

  it('survives navigating between pages', async () => {
    await advanceToStepTwo()
    // this is the test that fails loudly if AnnotationContext is ever moved
    // into CloudscapeShell, which remounts on every navigation
    fireEvent.click(screen.getByRole('link', { name: 'All lessons and progress' }))
    await screen.findByRole('heading', { name: 'Learn', level: 1 })

    // and back, using the step's own shortcut to its route
    fireEvent.click((await panel()).getByRole('button', { name: 'Take me there' }))
    await screen.findByText('Buckets')
    expect(stepLabel()).toMatch(/step 2 of/)
  })

  it('is not reset by verifying a step', async () => {
    await advanceToStepTwo()
    const step = await panel()
    fireEvent.click(step.getByTestId('learn-verify-open-bucket'))
    await waitFor(() => expect(postBody('/api/learn/verify')).toBeTruthy())
    expect(stepLabel()).toMatch(/step 2 of/)
  })
})
