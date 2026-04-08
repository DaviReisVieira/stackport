import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchLogGroups, fetchLogStreams, fetchLogEvents } from '@/lib/api'

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

describe('fetchLogGroups', () => {
  it('calls correct URL with no params', async () => {
    mockOk({ log_groups: [], next_token: null })
    const result = await fetchLogGroups()
    expect(mockFetch).toHaveBeenCalledWith('/api/logs/groups')
    expect(result.log_groups).toEqual([])
  })

  it('includes prefix query param when provided', async () => {
    mockOk({ log_groups: [], next_token: null })
    await fetchLogGroups('/aws/lambda')
    expect(mockFetch).toHaveBeenCalledWith('/api/logs/groups?prefix=%2Faws%2Flambda')
  })

  it('includes next_token query param when provided', async () => {
    mockOk({ log_groups: [], next_token: null })
    await fetchLogGroups('', 'token123')
    expect(mockFetch).toHaveBeenCalledWith('/api/logs/groups?next_token=token123')
  })

  it('includes both prefix and next_token when provided', async () => {
    mockOk({ log_groups: [], next_token: null })
    await fetchLogGroups('/aws/lambda', 'token123')
    expect(mockFetch).toHaveBeenCalledWith('/api/logs/groups?prefix=%2Faws%2Flambda&next_token=token123')
  })

  it('returns log groups data', async () => {
    const mockData = {
      log_groups: [
        {
          name: '/aws/lambda/my-function',
          arn: 'arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/my-function',
          creation_time: '2021-01-01T00:00:00Z',
          retention_days: 7,
          stored_bytes: 1024,
          metric_filter_count: 0,
        },
      ],
      next_token: 'token456',
    }
    mockOk(mockData)
    const result = await fetchLogGroups()
    expect(result.log_groups).toHaveLength(1)
    expect(result.log_groups[0].name).toBe('/aws/lambda/my-function')
    expect(result.next_token).toBe('token456')
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchLogGroups()).rejects.toThrow('500')
  })
})

describe('fetchLogStreams', () => {
  it('calls correct URL with encoded log group name', async () => {
    mockOk({ log_group: '/aws/lambda/my-function', log_streams: [], next_token: null })
    await fetchLogStreams('/aws/lambda/my-function')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/logs/groups/%2Faws%2Flambda%2Fmy-function/streams?order_by=LastEventTime&descending=true&limit=50'
    )
  })

  it('includes prefix query param when provided', async () => {
    mockOk({ log_group: 'my-group', log_streams: [], next_token: null })
    await fetchLogStreams('my-group', '2024')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('prefix=2024')
    )
  })

  it('includes custom order_by, descending, and limit', async () => {
    mockOk({ log_group: 'my-group', log_streams: [], next_token: null })
    await fetchLogStreams('my-group', '', 'LogStreamName', false, 10)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/logs/groups/my-group/streams?order_by=LogStreamName&descending=false&limit=10'
    )
  })

  it('includes next_token when provided', async () => {
    mockOk({ log_group: 'my-group', log_streams: [], next_token: null })
    await fetchLogStreams('my-group', '', 'LastEventTime', true, 50, 'stream_token')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('next_token=stream_token')
    )
  })

  it('returns log streams data', async () => {
    const mockData = {
      log_group: 'my-group',
      log_streams: [
        {
          name: '2024/01/01/[$LATEST]abc123',
          creation_time: '2021-01-01T00:00:00Z',
          first_event_time: '2021-01-01T00:01:00Z',
          last_event_time: '2021-01-01T00:02:00Z',
          last_ingestion_time: '2021-01-01T00:03:00Z',
          stored_bytes: 2048,
        },
      ],
      next_token: 'stream_token',
    }
    mockOk(mockData)
    const result = await fetchLogStreams('my-group')
    expect(result.log_streams).toHaveLength(1)
    expect(result.log_streams[0].name).toBe('2024/01/01/[$LATEST]abc123')
    expect(result.next_token).toBe('stream_token')
  })

  it('throws on non-ok response', async () => {
    mockError(404)
    await expect(fetchLogStreams('missing-group')).rejects.toThrow('404')
  })
})

describe('fetchLogEvents', () => {
  it('calls correct URL with encoded names', async () => {
    mockOk({ log_group: 'my-group', log_stream: 'my-stream', events: [], next_token: null })
    await fetchLogEvents('/aws/lambda/my-function', '2024/01/01/[$LATEST]abc')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/logs/groups/%2Faws%2Flambda%2Fmy-function/streams/2024%2F01%2F01%2F%5B%24LATEST%5Dabc/events?start_time=0&end_time=0&limit=100'
    )
  })

  it('includes time range parameters', async () => {
    mockOk({ log_group: 'my-group', log_stream: 'my-stream', events: [], next_token: null })
    const startTime = 1609459200000
    const endTime = 1609459800000
    await fetchLogEvents('my-group', 'my-stream', startTime, endTime)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`start_time=${startTime}`)
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`end_time=${endTime}`)
    )
  })

  it('includes filter_pattern when provided', async () => {
    mockOk({ log_group: 'my-group', log_stream: 'my-stream', events: [], next_token: null })
    await fetchLogEvents('my-group', 'my-stream', 0, 0, 'ERROR')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('filter_pattern=ERROR')
    )
  })

  it('includes custom limit', async () => {
    mockOk({ log_group: 'my-group', log_stream: 'my-stream', events: [], next_token: null })
    await fetchLogEvents('my-group', 'my-stream', 0, 0, '', 50)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=50')
    )
  })

  it('includes next_token when provided', async () => {
    mockOk({ log_group: 'my-group', log_stream: 'my-stream', events: [], next_token: null })
    await fetchLogEvents('my-group', 'my-stream', 0, 0, '', 100, 'event_token')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('next_token=event_token')
    )
  })

  it('returns log events data', async () => {
    const mockData = {
      log_group: 'my-group',
      log_stream: 'my-stream',
      events: [
        {
          timestamp: '2021-01-01T00:00:00Z',
          timestamp_millis: 1609459200000,
          message: 'START RequestId: abc123',
          ingestion_time: '2021-01-01T00:00:01Z',
          event_id: 'evt123',
        },
        {
          timestamp: '2021-01-01T00:00:01Z',
          timestamp_millis: 1609459201000,
          message: '{"level": "INFO", "message": "Processing request"}',
          ingestion_time: '2021-01-01T00:00:02Z',
          event_id: 'evt124',
        },
      ],
      next_token: 'event_token',
    }
    mockOk(mockData)
    const result = await fetchLogEvents('my-group', 'my-stream')
    expect(result.events).toHaveLength(2)
    expect(result.events[0].message).toBe('START RequestId: abc123')
    expect(result.events[1].message).toContain('Processing request')
    expect(result.next_token).toBe('event_token')
  })

  it('throws on non-ok response', async () => {
    mockError(404)
    await expect(fetchLogEvents('missing-group', 'missing-stream')).rejects.toThrow('404')
  })
})
