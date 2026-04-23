import type {
  HealthResponse,
  StatsResponse,
  ResourceListResponse,
  ResourceDetailResponse,
  TagsSupportedResponse,
  ResourceTagsResponse,
  BulkTagRequest,
  BulkDeleteRequest,
  BulkOperationResponse,
  EndpointsResponse,
  S3Bucket,
  S3ObjectsResponse,
  S3ObjectDetail,
  S3UploadResponse,
  S3UploadConfig,
  S3DeleteObjectResponse,
  S3DeleteBatchResponse,
  S3CreateFolderResponse,
  DynamoDBTable,
  DynamoDBTableDetail,
  DynamoDBScanResponse,
  DynamoDBQueryRequest,
  DynamoDBQueryResponse,
  LambdaFunction,
  LambdaFunctionDetail,
  LambdaInvokeRequest,
  LambdaInvokeResponse,
  LambdaEventSourceMapping,
  LambdaAlias,
  LambdaVersion,
  SQSQueue,
  SQSQueueDetail,
  SQSMessage,
  SQSSendMessageRequest,
  SQSSendMessageResponse,
  IAMUser,
  IAMRole,
  IAMGroup,
  IAMPolicy,
  IAMUserDetail,
  IAMRoleDetail,
  IAMGroupDetail,
  IAMPolicyDetail,
  EC2Instance,
  EC2InstanceDetail,
  EC2SecurityGroup,
  EC2VPC,
  EC2KeyPair,
  EC2ActionResponse,
  Secret,
  SecretDetail,
  LogGroupsResponse,
  LogStreamsResponse,
  LogEventsResponse,
} from './types'

const API_BASE = '/api'

function buildUrl(path: string, endpoint?: string | null, params?: URLSearchParams): string {
  const p = params ?? new URLSearchParams()
  if (endpoint) p.set('endpoint', endpoint)
  const qs = p.toString()
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`
}

/** Encode each path segment of an S3 key for use in a URL path (preserves `/` as separator). */
function encodeS3ObjectKeyInPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

// --- Endpoints ---

export async function fetchEndpoints(): Promise<EndpointsResponse> {
  return fetchJSON<EndpointsResponse>(`${API_BASE}/endpoints`)
}

// --- Health & Stats ---

export async function fetchHealth(endpoint?: string | null): Promise<HealthResponse> {
  return fetchJSON<HealthResponse>(buildUrl('/health', endpoint))
}

export async function fetchStats(endpoint?: string | null): Promise<StatsResponse> {
  return fetchJSON<StatsResponse>(buildUrl('/stats', endpoint))
}

// --- Generic Resources ---

export async function fetchResources(service: string, type?: string, endpoint?: string | null): Promise<ResourceListResponse> {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  return fetchJSON<ResourceListResponse>(buildUrl(`/resources/${service}`, endpoint, params))
}

export async function fetchResourceDetail(service: string, type: string, id: string, endpoint?: string | null): Promise<ResourceDetailResponse> {
  return fetchJSON<ResourceDetailResponse>(buildUrl(`/resources/${service}/${type}/${encodeURIComponent(id)}`, endpoint))
}

// --- S3 ---

export async function fetchS3Buckets(endpoint?: string | null): Promise<{ buckets: S3Bucket[] }> {
  return fetchJSON<{ buckets: S3Bucket[] }>(buildUrl('/s3/buckets', endpoint))
}

export async function fetchS3Bucket(bucket: string, endpoint?: string | null) {
  return fetchJSON(buildUrl(`/s3/buckets/${encodeURIComponent(bucket)}`, endpoint))
}

export async function fetchS3Objects(bucket: string, prefix = '', delimiter = '/', endpoint?: string | null): Promise<S3ObjectsResponse> {
  const params = new URLSearchParams({ prefix, delimiter })
  return fetchJSON<S3ObjectsResponse>(buildUrl(`/s3/buckets/${encodeURIComponent(bucket)}/objects`, endpoint, params))
}

export async function fetchS3Object(bucket: string, key: string, endpoint?: string | null): Promise<S3ObjectDetail> {
  return fetchJSON<S3ObjectDetail>(
    buildUrl(`/s3/buckets/${encodeURIComponent(bucket)}/objects/${encodeS3ObjectKeyInPath(key)}`, endpoint),
  )
}

export function getS3DownloadUrl(bucket: string, key: string, endpoint?: string | null): string {
  const params = new URLSearchParams({ download: '1' })
  return buildUrl(`/s3/buckets/${encodeURIComponent(bucket)}/objects/${encodeS3ObjectKeyInPath(key)}`, endpoint, params)
}

export async function fetchS3UploadConfig(): Promise<S3UploadConfig> {
  return fetchJSON<S3UploadConfig>(`${API_BASE}/s3/upload-config`)
}

export function uploadS3Object(
  bucket: string,
  file: File,
  prefix: string,
  options?: {
    onProgress?: (loaded: number, total: number) => void
    signal?: AbortSignal
    onRegisterAbort?: (abort: () => void) => void
    endpoint?: string | null
  },
): Promise<S3UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    options?.onRegisterAbort?.(() => xhr.abort())

    const params = new URLSearchParams()
    if (prefix) params.set('prefix', prefix)
    if (options?.endpoint) params.set('endpoint', options.endpoint)
    const qs = params.toString()
    const url = `${API_BASE}/s3/buckets/${encodeURIComponent(bucket)}/objects${qs ? `?${qs}` : ''}`

    xhr.open('POST', url)
    xhr.responseType = 'json'

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && options?.onProgress && ev.total > 0) {
        options.onProgress(ev.loaded, ev.total)
      }
    }

    xhr.onload = () => {
      if (xhr.status === 413) {
        reject(new Error('File exceeds maximum upload size'))
        return
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as S3UploadResponse)
        return
      }
      reject(new Error(`${xhr.status}: ${xhr.statusText}`))
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))

    if (options?.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      options.signal.addEventListener('abort', () => xhr.abort())
    }

    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

export async function deleteS3Object(bucket: string, key: string, endpoint?: string | null): Promise<S3DeleteObjectResponse> {
  const url = buildUrl(`/s3/buckets/${encodeURIComponent(bucket)}/objects/${encodeS3ObjectKeyInPath(key)}`, endpoint)
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json() as Promise<S3DeleteObjectResponse>
}

export async function deleteS3ObjectsBatch(
  bucket: string,
  body: { keys: string[] } | { prefix: string },
  endpoint?: string | null,
): Promise<S3DeleteBatchResponse> {
  const url = buildUrl(`/s3/buckets/${encodeURIComponent(bucket)}/objects/delete-batch`, endpoint)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json() as Promise<S3DeleteBatchResponse>
}

export async function createS3Folder(bucket: string, folderPrefix: string, endpoint?: string | null): Promise<S3CreateFolderResponse> {
  const url = buildUrl(`/s3/buckets/${encodeURIComponent(bucket)}/folders`, endpoint)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: folderPrefix }),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json() as Promise<S3CreateFolderResponse>
}

// --- DynamoDB ---

export async function fetchDynamoDBTables(endpoint?: string | null): Promise<{ tables: DynamoDBTable[] }> {
  return fetchJSON<{ tables: DynamoDBTable[] }>(buildUrl('/dynamodb/tables', endpoint))
}

export async function fetchDynamoDBTable(name: string, endpoint?: string | null): Promise<DynamoDBTableDetail> {
  return fetchJSON<DynamoDBTableDetail>(buildUrl(`/dynamodb/tables/${encodeURIComponent(name)}`, endpoint))
}

export async function fetchDynamoDBItems(
  name: string,
  limit = 25,
  nextToken?: string | null,
  endpoint?: string | null,
): Promise<DynamoDBScanResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (nextToken) params.set('exclusive_start_key', nextToken)
  return fetchJSON<DynamoDBScanResponse>(buildUrl(`/dynamodb/tables/${encodeURIComponent(name)}/items`, endpoint, params))
}

export async function queryDynamoDBTable(name: string, request: DynamoDBQueryRequest, endpoint?: string | null): Promise<DynamoDBQueryResponse> {
  const url = buildUrl(`/dynamodb/tables/${encodeURIComponent(name)}/query`, endpoint)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

// --- Lambda ---

export async function fetchLambdaFunctions(endpoint?: string | null): Promise<{ functions: LambdaFunction[] }> {
  return fetchJSON<{ functions: LambdaFunction[] }>(buildUrl('/lambda/functions', endpoint))
}

export async function fetchLambdaFunction(functionName: string, endpoint?: string | null): Promise<LambdaFunctionDetail> {
  return fetchJSON<LambdaFunctionDetail>(buildUrl(`/lambda/functions/${encodeURIComponent(functionName)}`, endpoint))
}

export function getLambdaCodeDownloadUrl(functionName: string, endpoint?: string | null): string {
  return buildUrl(`/lambda/functions/${encodeURIComponent(functionName)}/code`, endpoint)
}

export async function invokeLambdaFunction(functionName: string, payload: LambdaInvokeRequest, endpoint?: string | null): Promise<LambdaInvokeResponse> {
  const url = buildUrl(`/lambda/functions/${encodeURIComponent(functionName)}/invoke`, endpoint)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchLambdaEventSources(functionName: string, endpoint?: string | null): Promise<{ eventSourceMappings: LambdaEventSourceMapping[] }> {
  return fetchJSON<{ eventSourceMappings: LambdaEventSourceMapping[] }>(buildUrl(`/lambda/functions/${encodeURIComponent(functionName)}/event-sources`, endpoint))
}

export async function fetchLambdaAliases(functionName: string, endpoint?: string | null): Promise<{ aliases: LambdaAlias[] }> {
  return fetchJSON<{ aliases: LambdaAlias[] }>(buildUrl(`/lambda/functions/${encodeURIComponent(functionName)}/aliases`, endpoint))
}

export async function fetchLambdaVersions(functionName: string, endpoint?: string | null): Promise<{ versions: LambdaVersion[] }> {
  return fetchJSON<{ versions: LambdaVersion[] }>(buildUrl(`/lambda/functions/${encodeURIComponent(functionName)}/versions`, endpoint))
}

// --- SQS ---

export async function fetchSQSQueues(endpoint?: string | null): Promise<{ queues: SQSQueue[] }> {
  return fetchJSON<{ queues: SQSQueue[] }>(buildUrl('/sqs/queues', endpoint))
}

export async function fetchSQSQueueDetail(queueName: string, endpoint?: string | null): Promise<SQSQueueDetail> {
  return fetchJSON<SQSQueueDetail>(buildUrl(`/sqs/queues/${encodeURIComponent(queueName)}`, endpoint))
}

export async function sendSQSMessage(queueName: string, request: SQSSendMessageRequest, endpoint?: string | null): Promise<SQSSendMessageResponse> {
  const url = buildUrl(`/sqs/queues/${encodeURIComponent(queueName)}/messages`, endpoint)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function receiveSQSMessages(
  queueName: string,
  maxMessages = 10,
  visibilityTimeout = 0,
  endpoint?: string | null,
): Promise<{ messages: SQSMessage[] }> {
  const params = new URLSearchParams({
    max_messages: String(maxMessages),
    visibility_timeout: String(visibilityTimeout),
  })
  return fetchJSON<{ messages: SQSMessage[] }>(
    buildUrl(`/sqs/queues/${encodeURIComponent(queueName)}/messages`, endpoint, params),
  )
}

export async function deleteSQSMessage(queueName: string, receiptHandle: string, endpoint?: string | null): Promise<void> {
  const params = new URLSearchParams({ receipt_handle: receiptHandle })
  const url = buildUrl(`/sqs/queues/${encodeURIComponent(queueName)}/messages`, endpoint, params)
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
}

export async function purgeSQSQueue(queueName: string, endpoint?: string | null): Promise<{ success: boolean; message: string }> {
  const url = buildUrl(`/sqs/queues/${encodeURIComponent(queueName)}/purge`, endpoint)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

// --- IAM ---

export async function fetchIAMUsers(endpoint?: string | null): Promise<{ users: IAMUser[] }> {
  return fetchJSON<{ users: IAMUser[] }>(buildUrl('/iam/users', endpoint))
}

export async function fetchIAMUserDetail(userName: string, endpoint?: string | null): Promise<IAMUserDetail> {
  return fetchJSON<IAMUserDetail>(buildUrl(`/iam/users/${encodeURIComponent(userName)}`, endpoint))
}

export async function fetchIAMRoles(endpoint?: string | null): Promise<{ roles: IAMRole[] }> {
  return fetchJSON<{ roles: IAMRole[] }>(buildUrl('/iam/roles', endpoint))
}

export async function fetchIAMRoleDetail(roleName: string, endpoint?: string | null): Promise<IAMRoleDetail> {
  return fetchJSON<IAMRoleDetail>(buildUrl(`/iam/roles/${encodeURIComponent(roleName)}`, endpoint))
}

export async function fetchIAMGroups(endpoint?: string | null): Promise<{ groups: IAMGroup[] }> {
  return fetchJSON<{ groups: IAMGroup[] }>(buildUrl('/iam/groups', endpoint))
}

export async function fetchIAMGroupDetail(groupName: string, endpoint?: string | null): Promise<IAMGroupDetail> {
  return fetchJSON<IAMGroupDetail>(buildUrl(`/iam/groups/${encodeURIComponent(groupName)}`, endpoint))
}

export async function fetchIAMPolicies(scope = 'Local', endpoint?: string | null): Promise<{ policies: IAMPolicy[] }> {
  const params = new URLSearchParams({ scope })
  return fetchJSON<{ policies: IAMPolicy[] }>(buildUrl('/iam/policies', endpoint, params))
}

export async function fetchIAMPolicyDetail(policyArn: string, endpoint?: string | null): Promise<IAMPolicyDetail> {
  return fetchJSON<IAMPolicyDetail>(buildUrl(`/iam/policies/${encodeURIComponent(policyArn)}`, endpoint))
}

// --- EC2 ---

export async function fetchEC2Instances(endpoint?: string | null): Promise<{ instances: EC2Instance[] }> {
  return fetchJSON<{ instances: EC2Instance[] }>(buildUrl('/ec2/instances', endpoint))
}

export async function fetchEC2InstanceDetail(instanceId: string, endpoint?: string | null): Promise<EC2InstanceDetail> {
  return fetchJSON<EC2InstanceDetail>(buildUrl(`/ec2/instances/${encodeURIComponent(instanceId)}`, endpoint))
}

export async function startEC2Instance(instanceId: string, endpoint?: string | null): Promise<EC2ActionResponse> {
  const url = buildUrl(`/ec2/instances/${encodeURIComponent(instanceId)}/start`, endpoint)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function stopEC2Instance(instanceId: string, endpoint?: string | null): Promise<EC2ActionResponse> {
  const url = buildUrl(`/ec2/instances/${encodeURIComponent(instanceId)}/stop`, endpoint)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function rebootEC2Instance(instanceId: string, endpoint?: string | null): Promise<EC2ActionResponse> {
  const url = buildUrl(`/ec2/instances/${encodeURIComponent(instanceId)}/reboot`, endpoint)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function terminateEC2Instance(instanceId: string, endpoint?: string | null): Promise<EC2ActionResponse> {
  const url = buildUrl(`/ec2/instances/${encodeURIComponent(instanceId)}/terminate`, endpoint)
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchEC2SecurityGroups(endpoint?: string | null): Promise<{ securityGroups: EC2SecurityGroup[] }> {
  return fetchJSON<{ securityGroups: EC2SecurityGroup[] }>(buildUrl('/ec2/security-groups', endpoint))
}

export async function fetchEC2VPCs(endpoint?: string | null): Promise<{ vpcs: EC2VPC[] }> {
  return fetchJSON<{ vpcs: EC2VPC[] }>(buildUrl('/ec2/vpcs', endpoint))
}

export async function fetchEC2KeyPairs(endpoint?: string | null): Promise<{ keyPairs: EC2KeyPair[] }> {
  return fetchJSON<{ keyPairs: EC2KeyPair[] }>(buildUrl('/ec2/key-pairs', endpoint))
}

// --- Secrets Manager ---

export async function fetchSecrets(endpoint?: string | null): Promise<{ secrets: Secret[] }> {
  return fetchJSON<{ secrets: Secret[] }>(buildUrl('/secretsmanager/secrets', endpoint))
}

export async function fetchSecretDetail(secretId: string, endpoint?: string | null): Promise<SecretDetail> {
  return fetchJSON<SecretDetail>(buildUrl(`/secretsmanager/secrets/${encodeURIComponent(secretId)}`, endpoint))
}

// --- CloudWatch Logs ---

export async function fetchLogGroups(prefix = '', nextToken = '', endpoint?: string | null): Promise<LogGroupsResponse> {
  const params = new URLSearchParams()
  if (prefix) params.set('prefix', prefix)
  if (nextToken) params.set('next_token', nextToken)
  return fetchJSON<LogGroupsResponse>(buildUrl('/logs/groups', endpoint, params))
}

export async function fetchLogStreams(
  logGroupName: string,
  prefix = '',
  orderBy = 'LastEventTime',
  descending = true,
  limit = 50,
  nextToken = '',
  endpoint?: string | null,
): Promise<LogStreamsResponse> {
  const params = new URLSearchParams({
    order_by: orderBy,
    descending: String(descending),
    limit: String(limit),
  })
  if (prefix) params.set('prefix', prefix)
  if (nextToken) params.set('next_token', nextToken)
  return fetchJSON<LogStreamsResponse>(
    buildUrl(`/logs/groups/${encodeURIComponent(logGroupName)}/streams`, endpoint, params),
  )
}

export async function fetchLogEvents(
  logGroupName: string,
  logStreamName: string,
  startTime = 0,
  endTime = 0,
  filterPattern = '',
  limit = 100,
  nextToken = '',
  endpoint?: string | null,
): Promise<LogEventsResponse> {
  const params = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTime),
    limit: String(limit),
  })
  if (filterPattern) params.set('filter_pattern', filterPattern)
  if (nextToken) params.set('next_token', nextToken)
  return fetchJSON<LogEventsResponse>(
    buildUrl(`/logs/groups/${encodeURIComponent(logGroupName)}/streams/${encodeURIComponent(logStreamName)}/events`, endpoint, params),
  )
}

// --- Tag and Bulk Operations ---

export async function fetchTagsSupported(endpoint?: string | null): Promise<TagsSupportedResponse> {
  return fetchJSON<TagsSupportedResponse>(buildUrl('/tags/supported', endpoint))
}

export async function fetchResourceTags(
  service: string,
  resourceType: string,
  resourceId: string,
  endpoint?: string | null,
): Promise<ResourceTagsResponse> {
  return fetchJSON<ResourceTagsResponse>(
    buildUrl(`/tags/${service}/${resourceType}/${encodeURIComponent(resourceId)}`, endpoint),
  )
}

export async function updateResourceTags(
  service: string,
  resourceType: string,
  resourceId: string,
  tags: Record<string, string>,
  endpoint?: string | null,
): Promise<{ success: boolean }> {
  const url = buildUrl(`/tags/${service}/${resourceType}/${encodeURIComponent(resourceId)}`, endpoint)
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function bulkTag(request: BulkTagRequest, endpoint?: string | null): Promise<BulkOperationResponse> {
  const url = buildUrl('/bulk/tag', endpoint)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function bulkDelete(request: BulkDeleteRequest, endpoint?: string | null): Promise<BulkOperationResponse> {
  const url = buildUrl('/bulk/delete', endpoint)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}
