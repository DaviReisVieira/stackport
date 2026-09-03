import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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
  services: { s3: { status: 'available', resources: { buckets: 2 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const buckets = [
  {
    name: 'app-assets',
    created: '2026-01-01T00:00:00Z',
    region: 'us-east-1',
    object_count: 3,
    total_size: 2048,
    versioning: 'Enabled',
    encryption: 'Enabled',
    tags: { env: 'dev' },
  },
  {
    name: 'logs-archive',
    created: '2026-02-01T00:00:00Z',
    region: 'us-east-1',
    object_count: 0,
    total_size: 0,
    versioning: 'Disabled',
    encryption: 'Disabled',
    tags: {},
  },
]

const objectsRoot = {
  bucket: 'app-assets',
  prefix: '',
  delimiter: '/',
  folders: ['images/'],
  files: [
    {
      key: 'readme.md',
      name: 'readme.md',
      size: 512,
      content_type: 'text/markdown',
      etag: 'etag-1',
      last_modified: '2026-03-01T10:00:00Z',
    },
  ],
}

const objectDetail = {
  bucket: 'app-assets',
  key: 'readme.md',
  size: 512,
  content_type: 'text/markdown',
  content_encoding: null,
  etag: 'etag-1',
  last_modified: '2026-03-01T10:00:00Z',
  version_id: 'v-abc',
  metadata: { author: 'davi' },
  preserved_headers: { 'Cache-Control': 'no-store' },
  tags: { kind: 'docs' },
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/api/s3/upload-config')) payload = { max_upload_bytes: 100 * 1024 * 1024 }
    else if (url.includes('/objects/delete-batch')) payload = { deleted: 1, errors: [] }
    else if (url.includes('/api/s3/buckets/app-assets/folders')) payload = { bucket: 'app-assets', prefix: 'incoming/' }
    else if (url.includes('/api/s3/buckets/app-assets/objects/readme.md') && method === 'DELETE')
      payload = { bucket: 'app-assets', key: 'readme.md', deleted: true }
    else if (url.includes('/api/s3/buckets/app-assets/objects/readme.md')) payload = objectDetail
    else if (url.includes('/api/s3/buckets/app-assets/objects')) payload = objectsRoot
    else if (url.includes('/api/tags/s3/buckets/app-assets')) payload = { tags: { env: 'dev' } }
    else if (url.includes('/api/s3/buckets')) payload = { buckets }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderS3(path = '/cloudscape/resources/s3') {
  return render(
    <MemoryRouter initialEntries={[path]}>
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CloudscapeS3Browser (via registry dispatch)', () => {
  it('lists buckets with size, counts and feature badges', async () => {
    renderS3()
    expect(await screen.findByText('app-assets')).toBeInTheDocument()
    expect(await screen.findByText('logs-archive')).toBeInTheDocument()
    expect(await screen.findByText('2 KB')).toBeInTheDocument()
    expect(await screen.findByText('Versioning')).toBeInTheDocument()
    expect(await screen.findByText('Encrypted')).toBeInTheDocument()
    expect(await screen.findByText('1 tags')).toBeInTheDocument()
  })

  it('opens a bucket via deep link and lists folders and files', async () => {
    renderS3('/cloudscape/resources/s3?bucket=app-assets')
    expect(await screen.findByText('images/')).toBeInTheDocument()
    expect(await screen.findByText('readme.md')).toBeInTheDocument()
    expect(await screen.findByText('text/markdown')).toBeInTheDocument()
    expect(await screen.findByText('(1 folders, 1 files)')).toBeInTheDocument()
  })

  it('navigates into a folder updating the prefix query', async () => {
    renderS3('/cloudscape/resources/s3?bucket=app-assets')
    fireEvent.click(await screen.findByRole('link', { name: 'images/' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('prefix=images%2F'))
      expect(call).toBeTruthy()
    })
  })

  it('opens the object detail with metadata and preserved headers', async () => {
    renderS3('/cloudscape/resources/s3?bucket=app-assets')
    fireEvent.click(await screen.findByRole('link', { name: 'readme.md' }))
    expect(await screen.findByText('v-abc')).toBeInTheDocument()
    expect(await screen.findByText('author')).toBeInTheDocument()
    expect(await screen.findByText('Cache-Control')).toBeInTheDocument()

    // the modal's Tags tab is the last "Tags" trigger on the page
    const tagsTabs = screen.getAllByText('Tags')
    fireEvent.click(tagsTabs[tagsTabs.length - 1])
    expect(await screen.findByText('kind: docs')).toBeInTheDocument()
  })

  it('creates a folder sending the full prefix', async () => {
    renderS3('/cloudscape/resources/s3?bucket=app-assets')
    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    const input = await screen.findByPlaceholderText('my-folder')
    fireEvent.change(input, { target: { value: 'incoming' } })
    fireEvent.click(screen.getByTestId('create-folder-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/folders'))
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/folders'))
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ prefix: 'incoming/' })
  })

  it('deletes selected objects through the batch endpoint after confirmation', async () => {
    renderS3('/cloudscape/resources/s3?bucket=app-assets')
    await screen.findByText('readme.md')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select readme.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    fireEvent.click(await screen.findByTestId('confirm-delete'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/delete-batch'))
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/delete-batch'))
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ keys: ['readme.md'] })
  })

  it('uploads a file as multipart form data to the objects endpoint', async () => {
    const sent: Array<{ url: string; body: FormData }> = []
    class FakeXHR {
      upload = { onprogress: null as ((ev: ProgressEvent) => void) | null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 200
      statusText = 'OK'
      response = { bucket: 'app-assets', key: 'notes.txt', size: 4 }
      responseType = ''
      private url = ''
      open(_method: string, url: string) {
        this.url = url
      }
      send(body: FormData) {
        sent.push({ url: this.url, body })
        this.onload?.()
      }
      abort() {
        this.onabort?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)

    renderS3('/cloudscape/resources/s3?bucket=app-assets')
    await screen.findByText('readme.md')

    const file = new File(['data'], 'notes.txt', { type: 'text/plain' })
    const input = screen.getByTestId('s3-file-input')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(sent.length).toBe(1))
    expect(sent[0].url).toContain('/api/s3/buckets/app-assets/objects')
    expect(sent[0].body.get('file')).toBeInstanceOf(File)
    expect((sent[0].body.get('file') as File).name).toBe('notes.txt')
  })

  it('edits bucket tags from the Tags tab', async () => {
    renderS3('/cloudscape/resources/s3?bucket=app-assets')
    await screen.findByText('readme.md')
    fireEvent.click(screen.getByText('Tags'))

    const keyInput = await screen.findByDisplayValue('env')
    expect(keyInput).toBeInTheDocument()
    const valueInput = screen.getByDisplayValue('dev')
    fireEvent.change(valueInput, { target: { value: 'prod' } })
    fireEvent.click(screen.getByTestId('save-bucket-tags'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
    expect(String(call![0])).toContain('/api/tags/s3/buckets/app-assets')
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ tags: { env: 'prod' } })
  })
})
