import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchStats, fetchResources, fetchResourceDetail, fetchS3Buckets, fetchS3Objects, getS3DownloadUrl } from '@/lib/api'

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

describe('fetchStats', () => {
  it('calls the correct URL', async () => {
    const data = { services: {}, total_resources: 0, uptime_seconds: 1 }
    mockOk(data)
    const result = await fetchStats()
    expect(mockFetch).toHaveBeenCalledWith('/api/stats')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchStats()).rejects.toThrow('500')
  })
})

describe('fetchResources', () => {
  it('calls correct URL for service', async () => {
    mockOk({ service: 's3', resources: {} })
    await fetchResources('s3')
    expect(mockFetch).toHaveBeenCalledWith('/api/resources/s3')
  })

  it('appends type param when provided', async () => {
    mockOk({ service: 's3', resources: {} })
    await fetchResources('s3', 'buckets')
    expect(mockFetch).toHaveBeenCalledWith('/api/resources/s3?type=buckets')
  })
})

describe('fetchResourceDetail', () => {
  it('encodes resource ID', async () => {
    mockOk({ service: 's3', type: 'buckets', id: 'my/bucket', detail: {} })
    await fetchResourceDetail('s3', 'buckets', 'my/bucket')
    expect(mockFetch).toHaveBeenCalledWith('/api/resources/s3/buckets/my%2Fbucket')
  })
})

describe('fetchS3Buckets', () => {
  it('calls correct URL', async () => {
    mockOk({ buckets: [] })
    const result = await fetchS3Buckets()
    expect(mockFetch).toHaveBeenCalledWith('/api/s3/buckets')
    expect(result.buckets).toEqual([])
  })
})

describe('fetchS3Objects', () => {
  it('passes prefix and delimiter as params', async () => {
    mockOk({ bucket: 'b', prefix: 'p/', delimiter: '/', folders: [], files: [] })
    await fetchS3Objects('test-bucket', 'p/', '/')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/s3/buckets/test-bucket/objects')
    expect(url).toContain('prefix=p%2F')
    expect(url).toContain('delimiter=%2F')
  })
})

describe('getS3DownloadUrl', () => {
  it('returns correct download URL', () => {
    const url = getS3DownloadUrl('my-bucket', 'path/to/file.txt')
    expect(url).toBe('/api/s3/buckets/my-bucket/objects/path/to/file.txt?download=1')
  })
})
