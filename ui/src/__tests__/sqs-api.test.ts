import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  fetchSQSQueues,
  fetchSQSQueueDetail,
  sendSQSMessage,
  receiveSQSMessages,
  deleteSQSMessage,
  purgeSQSQueue,
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

describe('fetchSQSQueues', () => {
  it('calls the correct URL', async () => {
    mockOk({ queues: [] })
    const result = await fetchSQSQueues()
    expect(mockFetch).toHaveBeenCalledWith('/api/sqs/queues')
    expect(result.queues).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchSQSQueues()).rejects.toThrow('500')
  })
})

describe('fetchSQSQueueDetail', () => {
  it('calls correct URL with encoded name', async () => {
    mockOk({ name: 'my-queue' })
    await fetchSQSQueueDetail('my-queue')
    expect(mockFetch).toHaveBeenCalledWith('/api/sqs/queues/my-queue')
  })

  it('encodes special characters', async () => {
    mockOk({ name: 'my queue' })
    await fetchSQSQueueDetail('my queue')
    expect(mockFetch).toHaveBeenCalledWith('/api/sqs/queues/my%20queue')
  })
})

describe('sendSQSMessage', () => {
  it('sends POST with correct body', async () => {
    mockOk({ messageId: 'msg-123', md5OfMessageBody: 'abc' })
    await sendSQSMessage('my-queue', {
      messageBody: 'hello world',
      delaySeconds: 5,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sqs/queues/my-queue/messages',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.messageBody).toBe('hello world')
    expect(body.delaySeconds).toBe(5)
  })

  it('throws on non-ok response', async () => {
    mockError(400)
    await expect(
      sendSQSMessage('my-queue', { messageBody: '' })
    ).rejects.toThrow('400')
  })
})

describe('receiveSQSMessages', () => {
  it('calls correct URL with default params', async () => {
    mockOk({ messages: [] })
    await receiveSQSMessages('my-queue')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/sqs/queues/my-queue/messages')
    expect(url).toContain('max_messages=10')
    expect(url).toContain('visibility_timeout=0')
  })

  it('passes custom params', async () => {
    mockOk({ messages: [] })
    await receiveSQSMessages('my-queue', 5, 30)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('max_messages=5')
    expect(url).toContain('visibility_timeout=30')
  })
})

describe('deleteSQSMessage', () => {
  it('sends DELETE with receipt handle', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    await deleteSQSMessage('my-queue', 'handle-123')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('/api/sqs/queues/my-queue/messages')
    expect(url).toContain('receipt_handle=handle-123')
    expect(opts.method).toBe('DELETE')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request' })
    await expect(deleteSQSMessage('my-queue', 'bad')).rejects.toThrow('400')
  })
})

describe('purgeSQSQueue', () => {
  it('sends POST to purge endpoint', async () => {
    mockOk({ success: true, message: 'purged' })
    const result = await purgeSQSQueue('my-queue')

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sqs/queues/my-queue/purge',
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.success).toBe(true)
  })

  it('throws on non-ok response', async () => {
    mockError(409)
    await expect(purgeSQSQueue('my-queue')).rejects.toThrow('409')
  })
})
