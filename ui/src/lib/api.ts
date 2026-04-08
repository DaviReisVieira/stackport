import type {
  StatsResponse,
  ResourceListResponse,
  ResourceDetailResponse,
  S3Bucket,
  S3ObjectsResponse,
  S3ObjectDetail,
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
  LogGroupsResponse,
  LogStreamsResponse,
  LogEventsResponse,
} from './types'

const API_BASE = '/api'

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchStats(): Promise<StatsResponse> {
  return fetchJSON<StatsResponse>(`${API_BASE}/stats`)
}

export async function fetchResources(service: string, type?: string): Promise<ResourceListResponse> {
  const params = type ? `?type=${type}` : ''
  return fetchJSON<ResourceListResponse>(`${API_BASE}/resources/${service}${params}`)
}

export async function fetchResourceDetail(service: string, type: string, id: string): Promise<ResourceDetailResponse> {
  return fetchJSON<ResourceDetailResponse>(`${API_BASE}/resources/${service}/${type}/${encodeURIComponent(id)}`)
}

export async function fetchS3Buckets(): Promise<{ buckets: S3Bucket[] }> {
  return fetchJSON<{ buckets: S3Bucket[] }>(`${API_BASE}/s3/buckets`)
}

export async function fetchS3Bucket(bucket: string) {
  return fetchJSON(`${API_BASE}/s3/buckets/${encodeURIComponent(bucket)}`)
}

export async function fetchS3Objects(bucket: string, prefix = '', delimiter = '/'): Promise<S3ObjectsResponse> {
  const params = new URLSearchParams({ prefix, delimiter })
  return fetchJSON<S3ObjectsResponse>(`${API_BASE}/s3/buckets/${encodeURIComponent(bucket)}/objects?${params}`)
}

export async function fetchS3Object(bucket: string, key: string): Promise<S3ObjectDetail> {
  return fetchJSON<S3ObjectDetail>(`${API_BASE}/s3/buckets/${encodeURIComponent(bucket)}/objects/${key}`)
}

export function getS3DownloadUrl(bucket: string, key: string): string {
  return `${API_BASE}/s3/buckets/${encodeURIComponent(bucket)}/objects/${key}?download=1`
}

export async function fetchDynamoDBTables(): Promise<{ tables: DynamoDBTable[] }> {
  return fetchJSON<{ tables: DynamoDBTable[] }>(`${API_BASE}/dynamodb/tables`)
}

export async function fetchDynamoDBTable(name: string): Promise<DynamoDBTableDetail> {
  return fetchJSON<DynamoDBTableDetail>(`${API_BASE}/dynamodb/tables/${encodeURIComponent(name)}`)
}

export async function fetchDynamoDBItems(
  name: string,
  limit = 25,
  nextToken?: string | null
): Promise<DynamoDBScanResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (nextToken) params.set('exclusive_start_key', nextToken)
  return fetchJSON<DynamoDBScanResponse>(`${API_BASE}/dynamodb/tables/${encodeURIComponent(name)}/items?${params}`)
}

export async function queryDynamoDBTable(name: string, request: DynamoDBQueryRequest): Promise<DynamoDBQueryResponse> {
  const res = await fetch(`${API_BASE}/dynamodb/tables/${encodeURIComponent(name)}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchLambdaFunctions(): Promise<{ functions: LambdaFunction[] }> {
  return fetchJSON<{ functions: LambdaFunction[] }>(`${API_BASE}/lambda/functions`)
}

export async function fetchLambdaFunction(functionName: string): Promise<LambdaFunctionDetail> {
  return fetchJSON<LambdaFunctionDetail>(`${API_BASE}/lambda/functions/${encodeURIComponent(functionName)}`)
}

export function getLambdaCodeDownloadUrl(functionName: string): string {
  return `${API_BASE}/lambda/functions/${encodeURIComponent(functionName)}/code`
}

export async function invokeLambdaFunction(functionName: string, payload: LambdaInvokeRequest): Promise<LambdaInvokeResponse> {
  const res = await fetch(`${API_BASE}/lambda/functions/${encodeURIComponent(functionName)}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchLambdaEventSources(functionName: string): Promise<{ eventSourceMappings: LambdaEventSourceMapping[] }> {
  return fetchJSON<{ eventSourceMappings: LambdaEventSourceMapping[] }>(`${API_BASE}/lambda/functions/${encodeURIComponent(functionName)}/event-sources`)
}

export async function fetchLambdaAliases(functionName: string): Promise<{ aliases: LambdaAlias[] }> {
  return fetchJSON<{ aliases: LambdaAlias[] }>(`${API_BASE}/lambda/functions/${encodeURIComponent(functionName)}/aliases`)
}

export async function fetchLambdaVersions(functionName: string): Promise<{ versions: LambdaVersion[] }> {
  return fetchJSON<{ versions: LambdaVersion[] }>(`${API_BASE}/lambda/functions/${encodeURIComponent(functionName)}/versions`)
}

export async function fetchSQSQueues(): Promise<{ queues: SQSQueue[] }> {
  return fetchJSON<{ queues: SQSQueue[] }>(`${API_BASE}/sqs/queues`)
}

export async function fetchSQSQueueDetail(queueName: string): Promise<SQSQueueDetail> {
  return fetchJSON<SQSQueueDetail>(`${API_BASE}/sqs/queues/${encodeURIComponent(queueName)}`)
}

export async function sendSQSMessage(queueName: string, request: SQSSendMessageRequest): Promise<SQSSendMessageResponse> {
  const res = await fetch(`${API_BASE}/sqs/queues/${encodeURIComponent(queueName)}/messages`, {
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
  visibilityTimeout = 0
): Promise<{ messages: SQSMessage[] }> {
  const params = new URLSearchParams({
    max_messages: String(maxMessages),
    visibility_timeout: String(visibilityTimeout),
  })
  return fetchJSON<{ messages: SQSMessage[] }>(
    `${API_BASE}/sqs/queues/${encodeURIComponent(queueName)}/messages?${params}`
  )
}

export async function deleteSQSMessage(queueName: string, receiptHandle: string): Promise<void> {
  const params = new URLSearchParams({ receipt_handle: receiptHandle })
  const res = await fetch(
    `${API_BASE}/sqs/queues/${encodeURIComponent(queueName)}/messages?${params}`,
    { method: 'DELETE' }
  )
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
}

export async function purgeSQSQueue(queueName: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/sqs/queues/${encodeURIComponent(queueName)}/purge`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchIAMUsers(): Promise<{ users: IAMUser[] }> {
  return fetchJSON<{ users: IAMUser[] }>(`${API_BASE}/iam/users`)
}

export async function fetchIAMUserDetail(userName: string): Promise<IAMUserDetail> {
  return fetchJSON<IAMUserDetail>(`${API_BASE}/iam/users/${encodeURIComponent(userName)}`)
}

export async function fetchIAMRoles(): Promise<{ roles: IAMRole[] }> {
  return fetchJSON<{ roles: IAMRole[] }>(`${API_BASE}/iam/roles`)
}

export async function fetchIAMRoleDetail(roleName: string): Promise<IAMRoleDetail> {
  return fetchJSON<IAMRoleDetail>(`${API_BASE}/iam/roles/${encodeURIComponent(roleName)}`)
}

export async function fetchIAMGroups(): Promise<{ groups: IAMGroup[] }> {
  return fetchJSON<{ groups: IAMGroup[] }>(`${API_BASE}/iam/groups`)
}

export async function fetchIAMGroupDetail(groupName: string): Promise<IAMGroupDetail> {
  return fetchJSON<IAMGroupDetail>(`${API_BASE}/iam/groups/${encodeURIComponent(groupName)}`)
}

export async function fetchIAMPolicies(scope = 'Local'): Promise<{ policies: IAMPolicy[] }> {
  const params = new URLSearchParams({ scope })
  return fetchJSON<{ policies: IAMPolicy[] }>(`${API_BASE}/iam/policies?${params}`)
}

export async function fetchIAMPolicyDetail(policyArn: string): Promise<IAMPolicyDetail> {
  return fetchJSON<IAMPolicyDetail>(`${API_BASE}/iam/policies/${encodeURIComponent(policyArn)}`)
}

export async function fetchEC2Instances(): Promise<{ instances: EC2Instance[] }> {
  return fetchJSON<{ instances: EC2Instance[] }>(`${API_BASE}/ec2/instances`)
}

export async function fetchEC2InstanceDetail(instanceId: string): Promise<EC2InstanceDetail> {
  return fetchJSON<EC2InstanceDetail>(`${API_BASE}/ec2/instances/${encodeURIComponent(instanceId)}`)
}

export async function startEC2Instance(instanceId: string): Promise<EC2ActionResponse> {
  const res = await fetch(`${API_BASE}/ec2/instances/${encodeURIComponent(instanceId)}/start`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function stopEC2Instance(instanceId: string): Promise<EC2ActionResponse> {
  const res = await fetch(`${API_BASE}/ec2/instances/${encodeURIComponent(instanceId)}/stop`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function rebootEC2Instance(instanceId: string): Promise<EC2ActionResponse> {
  const res = await fetch(`${API_BASE}/ec2/instances/${encodeURIComponent(instanceId)}/reboot`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function terminateEC2Instance(instanceId: string): Promise<EC2ActionResponse> {
  const res = await fetch(`${API_BASE}/ec2/instances/${encodeURIComponent(instanceId)}/terminate`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`)
  return res.json()
}

export async function fetchEC2SecurityGroups(): Promise<{ securityGroups: EC2SecurityGroup[] }> {
  return fetchJSON<{ securityGroups: EC2SecurityGroup[] }>(`${API_BASE}/ec2/security-groups`)
}

export async function fetchEC2VPCs(): Promise<{ vpcs: EC2VPC[] }> {
  return fetchJSON<{ vpcs: EC2VPC[] }>(`${API_BASE}/ec2/vpcs`)
}

export async function fetchEC2KeyPairs(): Promise<{ keyPairs: EC2KeyPair[] }> {
  return fetchJSON<{ keyPairs: EC2KeyPair[] }>(`${API_BASE}/ec2/key-pairs`)
}

export async function fetchLogGroups(prefix = '', nextToken = ''): Promise<LogGroupsResponse> {
  const params = new URLSearchParams()
  if (prefix) params.set('prefix', prefix)
  if (nextToken) params.set('next_token', nextToken)
  const query = params.toString() ? `?${params}` : ''
  return fetchJSON<LogGroupsResponse>(`${API_BASE}/logs/groups${query}`)
}

export async function fetchLogStreams(
  logGroupName: string,
  prefix = '',
  orderBy = 'LastEventTime',
  descending = true,
  limit = 50,
  nextToken = ''
): Promise<LogStreamsResponse> {
  const params = new URLSearchParams({
    order_by: orderBy,
    descending: String(descending),
    limit: String(limit),
  })
  if (prefix) params.set('prefix', prefix)
  if (nextToken) params.set('next_token', nextToken)
  return fetchJSON<LogStreamsResponse>(
    `${API_BASE}/logs/groups/${encodeURIComponent(logGroupName)}/streams?${params}`
  )
}

export async function fetchLogEvents(
  logGroupName: string,
  logStreamName: string,
  startTime = 0,
  endTime = 0,
  filterPattern = '',
  limit = 100,
  nextToken = ''
): Promise<LogEventsResponse> {
  const params = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTime),
    limit: String(limit),
  })
  if (filterPattern) params.set('filter_pattern', filterPattern)
  if (nextToken) params.set('next_token', nextToken)
  return fetchJSON<LogEventsResponse>(
    `${API_BASE}/logs/groups/${encodeURIComponent(logGroupName)}/streams/${encodeURIComponent(logStreamName)}/events?${params}`
  )
}
