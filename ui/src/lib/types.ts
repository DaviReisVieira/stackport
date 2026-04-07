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
