import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  fetchLambdaFunctions,
  fetchLambdaFunction,
  getLambdaCodeDownloadUrl,
  invokeLambdaFunction,
  fetchLambdaEventSources,
  fetchLambdaAliases,
  fetchLambdaVersions,
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

describe('fetchLambdaFunctions', () => {
  it('calls the correct URL', async () => {
    mockOk({ functions: [] })
    const result = await fetchLambdaFunctions()
    expect(mockFetch).toHaveBeenCalledWith('/api/lambda/functions')
    expect(result.functions).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchLambdaFunctions()).rejects.toThrow('500')
  })
})

describe('fetchLambdaFunction', () => {
  it('calls correct URL with encoded name', async () => {
    mockOk({ configuration: { FunctionName: 'my-func' } })
    await fetchLambdaFunction('my-func')
    expect(mockFetch).toHaveBeenCalledWith('/api/lambda/functions/my-func')
  })

  it('encodes special characters in function name', async () => {
    mockOk({ configuration: {} })
    await fetchLambdaFunction('my func')
    expect(mockFetch).toHaveBeenCalledWith('/api/lambda/functions/my%20func')
  })
})

describe('getLambdaCodeDownloadUrl', () => {
  it('returns correct download URL', () => {
    const url = getLambdaCodeDownloadUrl('my-func')
    expect(url).toBe('/api/lambda/functions/my-func/code')
  })

  it('encodes function name in URL', () => {
    const url = getLambdaCodeDownloadUrl('my func')
    expect(url).toBe('/api/lambda/functions/my%20func/code')
  })
})

describe('invokeLambdaFunction', () => {
  it('sends POST with correct body', async () => {
    mockOk({ statusCode: 200, payload: { result: 'ok' } })
    await invokeLambdaFunction('my-func', { payload: { key: 'value' } })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/lambda/functions/my-func/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.payload).toEqual({ key: 'value' })
  })

  it('throws on non-ok response', async () => {
    mockError(404)
    await expect(
      invokeLambdaFunction('missing', { payload: {} })
    ).rejects.toThrow('404')
  })
})

describe('fetchLambdaEventSources', () => {
  it('calls correct URL', async () => {
    mockOk({ eventSourceMappings: [] })
    const result = await fetchLambdaEventSources('my-func')
    expect(mockFetch).toHaveBeenCalledWith('/api/lambda/functions/my-func/event-sources')
    expect(result.eventSourceMappings).toEqual([])
  })
})

describe('fetchLambdaAliases', () => {
  it('calls correct URL', async () => {
    mockOk({ aliases: [] })
    const result = await fetchLambdaAliases('my-func')
    expect(mockFetch).toHaveBeenCalledWith('/api/lambda/functions/my-func/aliases')
    expect(result.aliases).toEqual([])
  })
})

describe('fetchLambdaVersions', () => {
  it('calls correct URL', async () => {
    mockOk({ versions: [] })
    const result = await fetchLambdaVersions('my-func')
    expect(mockFetch).toHaveBeenCalledWith('/api/lambda/functions/my-func/versions')
    expect(result.versions).toEqual([])
  })
})
