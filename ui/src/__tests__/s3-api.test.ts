import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  deleteS3Object,
  deleteS3ObjectsBatch,
  createS3Folder,
  fetchS3UploadConfig,
  uploadS3Object,
  fetchS3Object,
  getS3DownloadUrl,
} from '@/lib/api'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

function mockOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  })
}

function mockError(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
  })
}

describe('fetchS3UploadConfig', () => {
  it('returns max_upload_bytes from the API', async () => {
    mockOk({ max_upload_bytes: 100 * 1024 * 1024 })
    const cfg = await fetchS3UploadConfig()
    expect(cfg.max_upload_bytes).toBe(100 * 1024 * 1024)
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/upload-config')
  })
})

describe('deleteS3Object', () => {
  it('calls DELETE with encoded bucket', async () => {
    mockOk({ bucket: 'b', deleted: true, key: 'a/b.txt' })
    await deleteS3Object('my bucket', 'a/b.txt')
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/buckets/my%20bucket/objects/a/b.txt', {
      method: 'DELETE',
    })
  })

  it('encodes special characters in key path segments', async () => {
    mockOk({ bucket: 'b', deleted: true, key: 'folder/file#1.txt' })
    await deleteS3Object('b', 'folder/file#1.txt')
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/buckets/b/objects/folder/file%231.txt', {
      method: 'DELETE',
    })
  })

  it('throws on error', async () => {
    mockError(500)
    await expect(deleteS3Object('b', 'k')).rejects.toThrow('500')
  })
})

describe('fetchS3Object', () => {
  it('GETs with encoded key segments', async () => {
    mockOk({
      key: 'a?b/c',
      bucket: 'b',
      size: 0,
      content_type: 'application/octet-stream',
      content_encoding: null,
      etag: '"x"',
      last_modified: '2020-01-01T00:00:00Z',
      version_id: null,
      metadata: {},
      preserved_headers: {},
      tags: {},
    })
    await fetchS3Object('b', 'a?b/c')
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/buckets/b/objects/a%3Fb/c')
  })
})

describe('getS3DownloadUrl', () => {
  it('includes encoded key segments in the path', () => {
    const url = getS3DownloadUrl('my', 'p/q r.txt')
    expect(url).toBe('/api/s3/buckets/my/objects/p/q%20r.txt?download=1')
  })
})

describe('deleteS3ObjectsBatch', () => {
  it('posts keys JSON', async () => {
    mockOk({ bucket: 'b', deleted: 2, keys: ['a', 'b'] })
    await deleteS3ObjectsBatch('bkt', { keys: ['a', 'b'] })
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/buckets/bkt/objects/delete-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: ['a', 'b'] }),
    })
  })

  it('posts prefix JSON', async () => {
    mockOk({ bucket: 'b', deleted: 1, keys: ['p/x'] })
    await deleteS3ObjectsBatch('bkt', { prefix: 'p/' })
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/buckets/bkt/objects/delete-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'p/' }),
    })
  })
})

describe('createS3Folder', () => {
  it('posts folder prefix', async () => {
    mockOk({ bucket: 'b', prefix: 'foo/' })
    await createS3Folder('bkt', 'foo/')
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/buckets/bkt/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'foo/' }),
    })
  })
})

describe('uploadS3Object', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  type XhrOpts = {
    status?: number
    responseBody?: Record<string, unknown>
    simulateProgress?: boolean
  }

  function stubXHR(opts: XhrOpts = {}) {
    const instances: MockXhr[] = []
    class MockXhr {
      upload: { onprogress: ((ev: Event) => void) | null } = { onprogress: null }
      status = opts.status ?? 200
      statusText = 'OK'
      responseType = ''
      response: unknown = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      private _aborted = false

      open = vi.fn((method: string, url: string) => {
        expect(method).toBe('POST')
        this._url = url
      })
      _url = ''

      abort = vi.fn(() => {
        this._aborted = true
        queueMicrotask(() => this.onabort?.())
      })

      send = vi.fn((body?: FormData) => {
        this._sentForm = body
        queueMicrotask(() => {
          if (this._aborted) return
          if (opts.status === 413) {
            this.status = 413
            this.responseType = 'json'
            this.response = {}
            this.onload?.()
            return
          }
          if (opts.simulateProgress && this.upload.onprogress) {
            this.upload.onprogress({
              lengthComputable: true,
              loaded: 3,
              total: 10,
            } as unknown as ProgressEvent)
          }
          this.responseType = 'json'
          this.response =
            opts.responseBody ??
            ({
              bucket: 'bkt',
              key: 'prefix/a.txt',
              size: 4,
              content_type: 'text/plain',
            } as Record<string, unknown>)
          this.onload?.()
        })
      })
      _sentForm?: FormData
    }

    class XHRShim {
      constructor() {
        const x = new MockXhr()
        instances.push(x)
        return x as unknown as XMLHttpRequest
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHRShim as unknown as typeof XMLHttpRequest)
    return instances
  }

  it('opens POST with prefix query and sends FormData file field', async () => {
    const xhrs = stubXHR()
    const file = new File(['hey'], 'a.txt', { type: 'text/plain' })

    await uploadS3Object('my bucket', file, 'prefix/', {})

    expect(xhrs).toHaveLength(1)
    expect(xhrs[0].open).toHaveBeenCalledWith(
      'POST',
      '/api/s3/buckets/my%20bucket/objects?prefix=prefix%2F',
    )
    expect(xhrs[0].send).toHaveBeenCalled()
    const fd = xhrs[0]._sentForm
    expect(fd?.get('file')).toBe(file)
  })

  it('calls onProgress when upload reports lengthComputable progress', async () => {
    stubXHR({ simulateProgress: true })
    const onProgress = vi.fn()
    const file = new File(['x'], 't.bin', { type: 'application/octet-stream' })

    await uploadS3Object('bkt', file, '', { onProgress })

    expect(onProgress).toHaveBeenCalledWith(3, 10)
  })

  it('rejects with size message when server returns 413', async () => {
    stubXHR({ status: 413 })
    const file = new File(['x'], 't.bin')

    await expect(uploadS3Object('bkt', file, '')).rejects.toThrow(
      'File exceeds maximum upload size',
    )
  })

  it('rejects with AbortError when onRegisterAbort triggers abort before load', async () => {
    stubXHR()
    const file = new File(['x'], 't.bin')

    let abortUpload: () => void
    const p = uploadS3Object('bkt', file, '', {
      onRegisterAbort: (fn) => {
        abortUpload = fn
      },
    })
    abortUpload!()

    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('passes AbortSignal abort to xhr', async () => {
    stubXHR()
    const file = new File(['x'], 't.bin')
    const ac = new AbortController()
    ac.abort()

    await expect(uploadS3Object('bkt', file, '', { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
