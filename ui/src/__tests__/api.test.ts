import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  addEndpoint,
  ApiError,
  batchWriteDynamoDBItems,
  bulkDelete,
  bulkTag,
  checkEndpointHealth,
  createDynamoDBTable,
  createLogGroup,
  createS3Bucket,
  createS3Folder,
  createSecret,
  createSNSTopic,
  createSQSQueue,
  deleteDynamoDBItem,
  deleteEndpoint,
  deleteLogGroup,
  deleteLogStream,
  deleteS3Lifecycle,
  deleteS3Object,
  deleteS3ObjectsBatch,
  deleteSecret,
  deleteSNSTopic,
  deleteSQSMessage,
  deleteSQSMessagesBatch,
  deleteSQSQueue,
  fetchEndpoints,
  fetchMetricData,
  fetchStats,
  fetchResources,
  fetchResourceDetail,
  fetchS3Buckets,
  fetchS3Objects,
  getS3DownloadUrl,
  invokeLambdaFunction,
  markLearnStep,
  publishSNSMessage,
  purgeSQSQueue,
  putDynamoDBItem,
  putS3BucketTags,
  putS3CORS,
  putS3Lifecycle,
  putS3Notifications,
  putS3Versioning,
  queryDynamoDBTable,
  rebootEC2Instance,
  resetEndpointEmulator,
  resetLearnProgress,
  restoreSecret,
  sendSQSMessage,
  sendSQSMessagesBatch,
  setDefaultEndpoint,
  setLearnVariable,
  setLogGroupRetention,
  startEC2Instance,
  startStepFunctionsExecution,
  stopEC2Instance,
  stopStepFunctionsExecution,
  subscribeSNSTopic,
  terminateEC2Instance,
  testEndpointConnection,
  unsubscribeSNS,
  updateDynamoDBItem,
  updateEndpoint,
  updateLambdaConfiguration,
  updateResourceTags,
  updateSecretMetadata,
  updateSecretValue,
  updateSQSQueueAttributes,
  updateSQSRedrivePolicy,
  verifyLearnStep,
} from '@/lib/api'
import type { ClassifiedError } from '@/lib/types'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

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

/** A failed call as the backend answers it (backend/error_handlers.py). */
function mockResponse(status: number, statusText: string, body: string) {
  mockFetch.mockResolvedValueOnce(new Response(body, { status, statusText }))
}

async function apiErrorFrom(call: () => Promise<unknown>): Promise<ApiError> {
  const error: unknown = await call().then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

const notImplemented: ClassifiedError = {
  kind: 'not_implemented',
  message: "This endpoint doesn't implement GetWebACL yet.",
  hint: 'The emulator returned NotImplemented. StackPort shows the rest of what the endpoint supports.',
  code: 'NotImplemented',
  operation: 'GetWebACL',
  cause: 'An error occurred (NotImplemented) when calling the GetWebACL operation: GetWebACL is not implemented',
}

describe('ApiError from GET requests', () => {
  it.each([
    ['fetchStats', () => fetchStats('local')],
    ['fetchResources', () => fetchResources('wafv2')],
    ['fetchResourceDetail', () => fetchResourceDetail('wafv2', 'web_acls', 'acl-1')],
    ['fetchS3Buckets', () => fetchS3Buckets()],
    ['fetchEndpoints', () => fetchEndpoints()],
  ])('%s throws the backend detail with the classified error', async (_name, call) => {
    mockResponse(501, 'Not Implemented', JSON.stringify({ detail: notImplemented.message, error: notImplemented }))
    const error = await apiErrorFrom(call)
    expect(error.status).toBe(501)
    expect(error.message).toBe("This endpoint doesn't implement GetWebACL yet.")
    expect(error.classified).toEqual(notImplemented)
  })

  it('keeps the detail of a plain HTTPException without a classification', async () => {
    mockResponse(404, 'Not Found', JSON.stringify({ detail: 'Unknown service: nosuch' }))
    const error = await apiErrorFrom(() => fetchResources('nosuch'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('Unknown service: nosuch')
    expect(error.classified).toBeNull()
  })

  it('reads the first validation message of a 422', async () => {
    mockResponse(
      422,
      'Unprocessable Entity',
      JSON.stringify({ detail: [{ loc: ['query', 'endpoint'], msg: 'Value error, endpoint is not saved', type: 'value_error' }] }),
    )
    const error = await apiErrorFrom(() => fetchStats('missing'))
    expect(error.message).toBe('endpoint is not saved')
  })

  it.each([
    ['no kind', { message: 'Something failed' }],
    ['an unknown kind', { kind: 'throttled', message: 'Slow down' }],
    ['a message that is not a string', { kind: 'credentials', message: { text: 'nope' } }],
    ['a string instead of an object', 'credentials'],
  ])('ignores an error object with %s', async (_case, malformed) => {
    mockResponse(502, 'Bad Gateway', JSON.stringify({ detail: 'StackPort could not finish the request.', error: malformed }))
    const error = await apiErrorFrom(() => fetchStats())
    expect(error.message).toBe('StackPort could not finish the request.')
    expect(error.classified).toBeNull()
  })

  it('falls back to the status line when the body is not JSON', async () => {
    mockResponse(502, 'Bad Gateway', '<html><body>502 Bad Gateway</body></html>')
    const error = await apiErrorFrom(() => fetchS3Buckets())
    expect(error.status).toBe(502)
    expect(error.message).toBe('502: Bad Gateway')
    expect(error.classified).toBeNull()
  })

  it('falls back to the status line when the response has no body to read', async () => {
    mockError(503)
    const error = await apiErrorFrom(() => fetchStats())
    expect(error.status).toBe(503)
    expect(error.message).toBe('503: Error')
    expect(error.classified).toBeNull()
  })
})

/** Every call that sends a write, with arguments that make a valid request. */
const WRITE_CALLS: Array<[string, () => Promise<unknown>]> = [
  ['addEndpoint', () => addEndpoint('lab', 'https://10.0.0.5:4566', null, { tls_verify: true, ca_bundle: null })],
  ['updateEndpoint', () => updateEndpoint('lab', 'https://10.0.0.5:4566')],
  ['deleteEndpoint', () => deleteEndpoint('lab')],
  ['setDefaultEndpoint', () => setDefaultEndpoint('lab')],
  ['checkEndpointHealth', () => checkEndpointHealth('lab')],
  ['resetEndpointEmulator', () => resetEndpointEmulator('lab')],
  ['testEndpointConnection', () => testEndpointConnection({ name: 'lab', url: 'https://10.0.0.5:4566', region: null })],
  ['createS3Bucket', () => createS3Bucket({ name: 'reports' })],
  ['deleteS3Object', () => deleteS3Object('reports', 'q1.csv')],
  ['deleteS3ObjectsBatch', () => deleteS3ObjectsBatch('reports', { keys: ['q1.csv'] })],
  ['createS3Folder', () => createS3Folder('reports', '2026/')],
  ['putS3Versioning', () => putS3Versioning('reports', 'Enabled')],
  ['putS3Lifecycle', () => putS3Lifecycle('reports', [{ id: 'expire', prefix: 'tmp/', expirationDays: 7, enabled: true }])],
  ['deleteS3Lifecycle', () => deleteS3Lifecycle('reports')],
  [
    'putS3Notifications',
    () =>
      putS3Notifications('reports', [
        {
          id: 'n1',
          destinationType: 'sqs',
          destinationArn: 'arn:aws:sqs:us-east-1:000000000000:q',
          events: ['s3:ObjectCreated:*'],
          filterPrefix: '',
          filterSuffix: '',
        },
      ]),
  ],
  ['putS3BucketTags', () => putS3BucketTags('reports', { team: 'core' })],
  ['putS3CORS', () => putS3CORS('reports', [{ allowedOrigins: ['*'], allowedMethods: ['GET'] }])],
  ['createDynamoDBTable', () => createDynamoDBTable({ name: 'Music', partitionKey: { name: 'Artist', type: 'S' } })],
  ['queryDynamoDBTable', () => queryDynamoDBTable('Music', { partition_key_value: 'Nina' })],
  ['putDynamoDBItem', () => putDynamoDBItem('Music', { Artist: { S: 'Nina' } })],
  ['updateDynamoDBItem', () => updateDynamoDBItem('Music', { Artist: { S: 'Nina' } })],
  ['deleteDynamoDBItem', () => deleteDynamoDBItem('Music', { Artist: { S: 'Nina' } })],
  ['batchWriteDynamoDBItems', () => batchWriteDynamoDBItems('Music', [{ op: 'put', item: { Artist: { S: 'Nina' } } }])],
  ['invokeLambdaFunction', () => invokeLambdaFunction('resize', { payload: {} })],
  ['updateLambdaConfiguration', () => updateLambdaConfiguration('resize', { timeout: 30 })],
  ['sendSQSMessage', () => sendSQSMessage('jobs', { messageBody: 'hi' })],
  ['deleteSQSMessage', () => deleteSQSMessage('jobs', 'receipt-1')],
  ['purgeSQSQueue', () => purgeSQSQueue('jobs')],
  ['createSQSQueue', () => createSQSQueue({ queueName: 'jobs', queueType: 'Standard' })],
  ['deleteSQSQueue', () => deleteSQSQueue('jobs')],
  ['updateSQSQueueAttributes', () => updateSQSQueueAttributes('jobs', { visibilityTimeout: 30 })],
  ['sendSQSMessagesBatch', () => sendSQSMessagesBatch('jobs', { entries: [] })],
  ['deleteSQSMessagesBatch', () => deleteSQSMessagesBatch('jobs', { receiptHandles: ['receipt-1'] })],
  ['updateSQSRedrivePolicy', () => updateSQSRedrivePolicy('jobs', null)],
  ['startEC2Instance', () => startEC2Instance('i-1')],
  ['stopEC2Instance', () => stopEC2Instance('i-1')],
  ['rebootEC2Instance', () => rebootEC2Instance('i-1')],
  ['terminateEC2Instance', () => terminateEC2Instance('i-1')],
  ['createSecret', () => createSecret({ name: 'db', secretString: 's3cret' })],
  ['updateSecretValue', () => updateSecretValue('db', { secretString: 's3cret' })],
  ['updateSecretMetadata', () => updateSecretMetadata('db', { description: 'Database password' })],
  ['deleteSecret', () => deleteSecret('db', false)],
  ['restoreSecret', () => restoreSecret('db')],
  ['createLogGroup', () => createLogGroup('/app/api')],
  ['deleteLogGroup', () => deleteLogGroup('/app/api')],
  ['setLogGroupRetention', () => setLogGroupRetention('/app/api', 7)],
  ['deleteLogStream', () => deleteLogStream('/app/api', 'stream-1')],
  ['updateResourceTags', () => updateResourceTags('sqs', 'queues', 'jobs', { team: 'core' })],
  ['bulkTag', () => bulkTag({ action: 'add', tags: { team: 'core' }, resources: [] })],
  ['bulkDelete', () => bulkDelete({ resources: [] })],
  ['startStepFunctionsExecution', () => startStepFunctionsExecution('arn:aws:states:us-east-1:000000000000:stateMachine:m', {})],
  ['stopStepFunctionsExecution', () => stopStepFunctionsExecution('arn:aws:states:us-east-1:000000000000:execution:m:e', {})],
  ['fetchMetricData', () => fetchMetricData([{ id: 'm1', namespace: 'AWS/SQS', metricName: 'NumberOfMessagesSent' }], 60)],
  ['createSNSTopic', () => createSNSTopic({ name: 'alerts' })],
  ['deleteSNSTopic', () => deleteSNSTopic('arn:aws:sns:us-east-1:000000000000:alerts')],
  ['subscribeSNSTopic', () => subscribeSNSTopic('arn:aws:sns:us-east-1:000000000000:alerts', { protocol: 'sqs', endpoint: 'arn:aws:sqs:us-east-1:000000000000:q' })],
  ['unsubscribeSNS', () => unsubscribeSNS('arn:aws:sns:us-east-1:000000000000:alerts:sub-1')],
  ['publishSNSMessage', () => publishSNSMessage('arn:aws:sns:us-east-1:000000000000:alerts', { message: 'hi' })],
  ['verifyLearnStep', () => verifyLearnStep('s3-basics', 'buckets', 'create')],
  ['markLearnStep', () => markLearnStep('s3-basics', 'buckets', 'create', true)],
  ['setLearnVariable', () => setLearnVariable('s3-basics', 'buckets', 'bucketName', 'learn-bucket')],
  ['resetLearnProgress', () => resetLearnProgress()],
]

describe('ApiError from write requests', () => {
  it.each(WRITE_CALLS)('%s throws the backend detail with the classified error', async (_name, call) => {
    mockResponse(501, 'Not Implemented', JSON.stringify({ detail: notImplemented.message, error: notImplemented }))
    const error = await apiErrorFrom(call)
    expect(error.status).toBe(501)
    expect(error.message).toBe("This endpoint doesn't implement GetWebACL yet.")
    expect(error.classified).toEqual(notImplemented)
  })

  it.each(WRITE_CALLS)('%s falls back to the status when the body is not JSON', async (_name, call) => {
    mockResponse(502, 'Bad Gateway', '<html><body>502 Bad Gateway</body></html>')
    const error = await apiErrorFrom(call)
    expect(error.status).toBe(502)
    expect(error.message).toBe('502: Bad Gateway')
    expect(error.classified).toBeNull()
  })

  it('reads as the backend detail alone when written into a sentence', async () => {
    // How the views word their failure toasts
    mockResponse(409, 'Conflict', JSON.stringify({ detail: 'Topic orders already exists' }))
    const error = await apiErrorFrom(() => createSNSTopic({ name: 'orders' }))
    expect(`Failed to create topic: ${error}`).toBe('Failed to create topic: Topic orders already exists')
    expect(String(error)).toBe('Topic orders already exists')
    // Still named for what it is, for stack traces and the console
    expect(error.name).toBe('ApiError')
  })
})

describe('ApiError without a status text', () => {
  // HTTP/2 has no reason phrase, so browsers report an empty statusText
  it.each<[string, () => Promise<unknown>]>([
    ['a GET', () => fetchStats()],
    ['a write', () => createSQSQueue({ queueName: 'jobs', queueType: 'Standard' })],
  ])('names the status for %s', async (_case, call) => {
    mockResponse(502, '', '')
    const error = await apiErrorFrom(call)
    expect(error.message).toBe('HTTP 502')
  })
})
