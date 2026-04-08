export interface ServiceStats {
  status: 'available' | 'unavailable'
  resources: Record<string, number>
}

export interface StatsResponse {
  services: Record<string, ServiceStats>
  total_resources: number
  uptime_seconds: number
}

export interface ResourceItem {
  id: string
  [key: string]: unknown
}

export interface ResourceListResponse {
  service: string
  resources: Record<string, ResourceItem[]>
}

export interface ResourceDetailResponse {
  service: string
  type: string
  id: string
  detail: unknown
}

export interface S3Bucket {
  name: string
  created: string
  region: string
  object_count: number
  total_size: number
  versioning: string
  encryption: string
  tags: Record<string, string>
}

export interface S3File {
  key: string
  name: string
  size: number
  content_type: string
  etag: string
  last_modified: string
}

export interface S3ObjectsResponse {
  bucket: string
  prefix: string
  delimiter: string
  folders: string[]
  files: S3File[]
}

export interface S3ObjectDetail {
  bucket: string
  key: string
  size: number
  content_type: string
  content_encoding: string | null
  etag: string
  last_modified: string
  version_id: string | null
  metadata: Record<string, string>
  preserved_headers: Record<string, string>
  tags: Record<string, string>
}

export interface DynamoDBTable {
  name: string
  status: string
  item_count: number
  size_bytes: number
  partition_key: string | null
  sort_key: string | null
  billing_mode: string
  created: string | null
}

export interface DynamoDBTableDetail {
  name: string
  status: string
  item_count: number
  size_bytes: number
  partition_key: string | null
  partition_key_type: string | null
  sort_key: string | null
  sort_key_type: string | null
  billing_mode: string
  created: string | null
  attribute_definitions: Record<string, string>
  key_schema: Array<{ AttributeName: string; KeyType: string }>
  global_secondary_indexes: unknown[]
  local_secondary_indexes: unknown[]
}

export interface DynamoDBItem {
  [key: string]: unknown
}

export interface DynamoDBScanResponse {
  table: string
  items: DynamoDBItem[]
  count: number
  scanned_count: number
  next_token: string | null
}

export interface DynamoDBQueryRequest {
  partition_key_value: string
  sort_key_value?: string | null
  sort_key_operator?: string
  limit?: number
}

export interface DynamoDBQueryResponse {
  table: string
  items: DynamoDBItem[]
  count: number
  scanned_count: number
}

export interface LambdaFunction {
  FunctionName: string
  FunctionArn: string
  Runtime: string
  Role: string
  Handler: string
  CodeSize: number
  Description?: string
  Timeout: number
  MemorySize: number
  LastModified: string
  CodeSha256: string
  Version: string
  State?: string
  StateReason?: string
  StateReasonCode?: string
  LastUpdateStatus?: string
  PackageType?: string
  Architectures?: string[]
  Environment?: {
    Variables?: Record<string, string>
  }
  Layers?: Array<{
    Arn: string
    CodeSize: number
  }>
}

export interface LambdaFunctionDetail {
  configuration: {
    FunctionName: string
    FunctionArn: string
    Runtime: string
    Role: string
    Handler: string
    CodeSize: number
    Description?: string
    Timeout: number
    MemorySize: number
    LastModified: string
    CodeSha256: string
    Version: string
    State?: string
    StateReason?: string
    StateReasonCode?: string
    PackageType?: string
    Architectures?: string[]
    Environment?: {
      Variables?: Record<string, string>
    }
    Layers?: Array<{
      Arn: string
      CodeSize: number
    }>
    VpcConfig?: {
      SubnetIds?: string[]
      SecurityGroupIds?: string[]
      VpcId?: string
    }
    LoggingConfig?: {
      LogFormat?: string
      ApplicationLogLevel?: string
      SystemLogLevel?: string
      LogGroup?: string
    }
    TracingConfig?: {
      Mode?: string
    }
  }
  code: {
    Location?: string
    RepositoryType?: string
  }
  tags: Record<string, string>
  concurrency?: {
    ReservedConcurrentExecutions?: number
  }
}

export interface LambdaInvokeRequest {
  payload: Record<string, unknown>
}

export interface LambdaInvokeResponse {
  statusCode: number
  functionError?: string
  executedVersion: string
  payload: unknown
  logs?: string
}

export interface LambdaEventSourceMapping {
  UUID: string
  EventSourceArn: string
  FunctionArn: string
  State: string
  StateTransitionReason?: string
  LastModified: string
  LastProcessingResult?: string
  BatchSize?: number
  MaximumBatchingWindowInSeconds?: number
  ParallelizationFactor?: number
}

export interface LambdaAlias {
  AliasArn: string
  Name: string
  FunctionVersion: string
  Description?: string
  RoutingConfig?: {
    AdditionalVersionWeights?: Record<string, number>
  }
  RevisionId: string
}

export interface LambdaVersion {
  FunctionName: string
  FunctionArn: string
  Version: string
  Description?: string
  CodeSize: number
  CodeSha256: string
  LastModified: string
  State?: string
  StateReason?: string
}

export interface SQSQueue {
  name: string
  url: string
  type: 'Standard' | 'FIFO'
  approximateNumberOfMessages: number
  approximateNumberOfMessagesNotVisible: number
  approximateNumberOfMessagesDelayed: number
  visibilityTimeout: number
  messageRetentionPeriod: number
  delaySeconds: number
  redrivePolicy?: {
    deadLetterTargetArn: string
    maxReceiveCount: number
  } | null
  tags: Record<string, string>
}

export interface SQSQueueDetail extends SQSQueue {
  arn: string
  maximumMessageSize: number
  contentBasedDeduplication: boolean
}

export interface SQSMessage {
  messageId: string
  receiptHandle: string
  body: string
  md5OfBody: string
  attributes: Record<string, string>
  messageAttributes: Record<string, {
    StringValue?: string
    BinaryValue?: string
    DataType: string
  }>
}

export interface SQSSendMessageRequest {
  messageBody: string
  delaySeconds?: number
  messageAttributes?: Record<string, {
    stringValue: string
    dataType: string
  }>
  messageDeduplicationId?: string
  messageGroupId?: string
}

export interface SQSSendMessageResponse {
  messageId: string
  md5OfMessageBody: string
  sequenceNumber?: string
}

export interface IAMUser {
  UserName: string
  UserId: string
  Arn: string
  Path: string
  CreateDate: string
}

export interface IAMRole {
  RoleName: string
  RoleId: string
  Arn: string
  Path: string
  CreateDate: string
  MaxSessionDuration?: number
}

export interface IAMGroup {
  GroupName: string
  GroupId: string
  Arn: string
  Path: string
  CreateDate: string
}

export interface IAMPolicy {
  PolicyName: string
  PolicyId: string
  Arn: string
  Path: string
  DefaultVersionId?: string
  AttachmentCount: number
  CreateDate: string
  UpdateDate: string
}

export interface IAMAttachedPolicy {
  PolicyName: string
  PolicyArn: string
}

export interface IAMInlinePolicy {
  name: string
  document: Record<string, unknown>
}

export interface IAMAccessKey {
  UserName: string
  AccessKeyId: string
  Status: string
  CreateDate: string
}

export interface IAMUserDetail {
  user: {
    UserName: string
    UserId: string
    Arn: string
    Path: string
    CreateDate: string
    PasswordLastUsed?: string | null
  }
  attached_policies: IAMAttachedPolicy[]
  inline_policies: IAMInlinePolicy[]
  groups: IAMGroup[]
  access_keys: IAMAccessKey[]
  tags: Record<string, string>
}

export interface IAMRoleDetail {
  role: {
    RoleName: string
    RoleId: string
    Arn: string
    Path: string
    CreateDate: string
    MaxSessionDuration?: number
  }
  trust_policy: Record<string, unknown>
  attached_policies: IAMAttachedPolicy[]
  inline_policies: IAMInlinePolicy[]
  tags: Record<string, string>
}

export interface IAMGroupDetail {
  group: {
    GroupName: string
    GroupId: string
    Arn: string
    Path: string
    CreateDate: string
  }
  users: IAMUser[]
  attached_policies: IAMAttachedPolicy[]
  inline_policies: IAMInlinePolicy[]
}

export interface IAMPolicyDetail {
  policy: {
    PolicyName: string
    PolicyId: string
    Arn: string
    Path: string
    DefaultVersionId?: string
    AttachmentCount: number
    CreateDate: string
    UpdateDate: string
  }
  document: Record<string, unknown>
  attached_to: {
    users: Array<{ UserName: string }>
    roles: Array<{ RoleName: string }>
    groups: Array<{ GroupName: string }>
  }
  tags: Record<string, string>
}

export interface EC2Instance {
  instanceId: string
  name: string
  state: string
  instanceType: string
  imageId?: string
  launchTime?: string | null
  publicIpAddress?: string
  privateIpAddress?: string
  vpcId?: string
  subnetId?: string
  keyName?: string
  platform?: string
  securityGroups: Array<{ GroupId: string; GroupName: string }>
  tags: Array<{ Key: string; Value: string }>
}

export interface EC2InstanceDetail {
  instance: {
    instanceId: string
    name: string
    state: string
    stateCode: number
    instanceType: string
    imageId?: string
    launchTime?: string | null
    publicIpAddress?: string
    privateIpAddress?: string
    vpcId?: string
    subnetId?: string
    keyName?: string
    platform?: string
    securityGroups: Array<{ GroupId: string; GroupName: string }>
    networkInterfaces: Array<Record<string, unknown>>
    blockDeviceMappings: Array<Record<string, unknown>>
    tags: Array<{ Key: string; Value: string }>
    userData?: string | null
  }
}

export interface EC2SecurityGroup {
  groupId: string
  groupName: string
  description: string
  vpcId?: string
  ipPermissions: Array<Record<string, unknown>>
  ipPermissionsEgress: Array<Record<string, unknown>>
  tags: Array<{ Key: string; Value: string }>
}

export interface EC2VPC {
  vpcId: string
  cidrBlock: string
  state: string
  isDefault: boolean
  tags: Array<{ Key: string; Value: string }>
  subnets: EC2Subnet[]
}

export interface EC2Subnet {
  subnetId: string
  cidrBlock: string
  availabilityZone: string
  availableIpAddressCount: number
  state: string
  tags: Array<{ Key: string; Value: string }>
}

export interface EC2KeyPair {
  keyPairId?: string
  keyName: string
  keyFingerprint?: string
  keyType: string
  tags: Array<{ Key: string; Value: string }>
}

export interface EC2ActionResponse {
  success: boolean
  state?: {
    previous: string
    current: string
  }
  message?: string
}

export interface LogGroup {
  name: string
  arn: string
  creation_time: string | null
  retention_days: number | null
  stored_bytes: number
  metric_filter_count: number
}

export interface LogGroupsResponse {
  log_groups: LogGroup[]
  next_token: string | null
}

export interface LogStream {
  name: string
  creation_time: string | null
  first_event_time: string | null
  last_event_time: string | null
  last_ingestion_time: string | null
  stored_bytes: number
}

export interface LogStreamsResponse {
  log_group: string
  log_streams: LogStream[]
  next_token: string | null
}

export interface LogEvent {
  timestamp: string
  timestamp_millis: number
  message: string
  ingestion_time: string | null
  event_id: string
}

export interface LogEventsResponse {
  log_group: string
  log_stream: string
  events: LogEvent[]
  next_token: string | null
}
