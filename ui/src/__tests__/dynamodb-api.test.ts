import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  batchWriteDynamoDBItems,
  deleteDynamoDBItem,
  fetchDynamoDBTable,
  fetchDynamoDBItems,
  fetchDynamoDBTables,
  putDynamoDBItem,
  queryDynamoDBTable,
  updateDynamoDBItem,
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
    json: () => Promise.resolve({}),
  })
}

describe('fetchDynamoDBTables', () => {
  it('calls the correct URL', async () => {
    const data = { tables: [] }
    mockOk(data)
    const result = await fetchDynamoDBTables()
    expect(mockFetch).toHaveBeenCalledWith('/api/dynamodb/tables')
    expect(result.tables).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchDynamoDBTables()).rejects.toThrow('500')
  })
})

describe('fetchDynamoDBTable', () => {
  it('calls correct URL with encoded name', async () => {
    mockOk({ name: 'my-table', status: 'ACTIVE' })
    await fetchDynamoDBTable('my-table')
    expect(mockFetch).toHaveBeenCalledWith('/api/dynamodb/tables/my-table')
  })

  it('encodes special characters in table name', async () => {
    mockOk({ name: 'my table', status: 'ACTIVE' })
    await fetchDynamoDBTable('my table')
    expect(mockFetch).toHaveBeenCalledWith('/api/dynamodb/tables/my%20table')
  })
})

describe('fetchDynamoDBItems', () => {
  it('calls correct URL with default params', async () => {
    mockOk({ table: 'users', items: [], count: 0 })
    await fetchDynamoDBItems('users')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/dynamodb/tables/users/items')
    expect(url).toContain('limit=25')
  })

  it('passes custom limit', async () => {
    mockOk({ table: 'users', items: [], count: 0 })
    await fetchDynamoDBItems('users', 50)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('limit=50')
  })

  it('passes next token for pagination', async () => {
    mockOk({ table: 'users', items: [], count: 0 })
    await fetchDynamoDBItems('users', 25, 'abc123')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('exclusive_start_key=abc123')
  })

  it('omits next token when null', async () => {
    mockOk({ table: 'users', items: [], count: 0 })
    await fetchDynamoDBItems('users', 25, null)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).not.toContain('exclusive_start_key')
  })
})

describe('queryDynamoDBTable', () => {
  it('sends POST with correct body', async () => {
    mockOk({ table: 'users', items: [], count: 0 })
    await queryDynamoDBTable('users', {
      partition_key_value: 'user1',
      sort_key_value: 'profile',
      sort_key_operator: '=',
      limit: 25,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dynamodb/tables/users/query',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.partition_key_value).toBe('user1')
    expect(body.sort_key_value).toBe('profile')
    expect(body.sort_key_operator).toBe('=')
    expect(body.limit).toBe(25)
  })

  it('throws on non-ok response', async () => {
    mockError(400)
    await expect(
      queryDynamoDBTable('users', { partition_key_value: 'test' })
    ).rejects.toThrow('400')
  })
})

describe('putDynamoDBItem / updateDynamoDBItem / deleteDynamoDBItem / batchWriteDynamoDBItems', () => {
  it('putDynamoDBItem uses POST and JSON body', async () => {
    mockOk({ ok: true, table: 't' })
    await putDynamoDBItem('t', { pk: { S: 'a' } }, 'dynamodb')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dynamodb/tables/t/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ item: { pk: { S: 'a' } }, item_format: 'dynamodb' }),
      })
    )
  })

  it('updateDynamoDBItem uses PUT', async () => {
    mockOk({ ok: true, table: 't' })
    await updateDynamoDBItem('t', { pk: { S: 'a' } }, 'dynamodb')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dynamodb/tables/t/items',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('deleteDynamoDBItem sends DELETE with key body', async () => {
    mockOk({ ok: true, table: 't' })
    await deleteDynamoDBItem('t', { pk: { S: 'a' } })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dynamodb/tables/t/items',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ key: { pk: { S: 'a' } }, item_format: 'dynamodb' }),
      })
    )
  })

  it('batchWriteDynamoDBItems posts to batch path', async () => {
    mockOk({ ok: true, table: 't' })
    const ops = [
      { op: 'put' as const, item: { pk: { S: '1' } } },
      { op: 'delete' as const, key: { pk: { S: '2' } } },
    ]
    await batchWriteDynamoDBItems('t', ops)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dynamodb/tables/t/items/batch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ item_format: 'dynamodb', operations: ops }),
      })
    )
  })

  it('batchWriteDynamoDBItems forwards unprocessed items so callers can warn', async () => {
    const unprocessed = { t: [{ PutRequest: { Item: { pk: { S: '1' } } } }] }
    mockOk({ ok: true, table: 't', unprocessed, message: 'partial' })
    const resp = await batchWriteDynamoDBItems('t', [
      { op: 'put' as const, item: { pk: { S: '1' } } },
    ])
    expect(resp.unprocessed).toEqual(unprocessed)
    expect(resp.message).toBe('partial')
  })
})
