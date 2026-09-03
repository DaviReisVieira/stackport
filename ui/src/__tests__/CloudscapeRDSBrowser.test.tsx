import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [],
    loading: false,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    data: {
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      endpoint_url: 'http://localhost:4566',
      region: 'us-east-1',
      services_count: 1,
      connection_type: 'local',
      writes_enabled: true,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const statsPayload = {
  services: { rds: { status: 'available', resources: { db_instances: 1, db_clusters: 1 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const instance = {
  dbInstanceIdentifier: 'orders-db',
  dbInstanceClass: 'db.t3.micro',
  engine: 'postgres',
  engineVersion: '15.4',
  status: 'available',
  masterUsername: 'admin',
  endpoint: 'orders-db.local',
  port: 5432,
  multiAz: true,
  availabilityZone: 'us-east-1a',
  storageType: 'gp3',
  allocatedStorage: 50,
  storageEncrypted: true,
  publiclyAccessible: false,
  vpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-1', Status: 'active' }],
  dbSubnetGroup: { DBSubnetGroupName: 'default' },
  parameterGroup: {},
  tags: [{ Key: 'env', Value: 'dev' }],
  createdTime: '2026-01-01T00:00:00Z',
  readReplicaSourceIdentifier: null,
  readReplicaIdentifiers: [],
}

const instanceDetail = {
  instance: {
    ...instance,
    iops: null,
    kmsKeyId: 'kms-1',
    dbParameterGroups: [],
    optionGroupMemberships: [],
    backupRetentionPeriod: 7,
    preferredBackupWindow: '03:00-04:00',
    preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
    certificateDetails: {},
    pendingModifiedValues: {},
    latestRestorableTime: null,
    earliestRestorableTime: null,
  },
}

const cluster = {
  dbClusterIdentifier: 'aurora-main',
  engine: 'aurora-mysql',
  engineVersion: '8.0',
  status: 'available',
  masterUsername: 'clusteradmin',
  endpoint: 'aurora-main.local',
  readerEndpoint: 'aurora-main-ro.local',
  port: 3306,
  multiAz: false,
  storageType: '',
  allocatedStorage: 1,
  storageEncrypted: false,
  vpcSecurityGroups: [],
  dbSubnetGroup: 'default',
  parameterGroup: 'default.aurora',
  tags: [],
  createdTime: '2026-01-01T00:00:00Z',
  earliestRestorableTime: null,
  latestRestorableTime: null,
  backupRetentionPeriod: 14,
  preferredBackupWindow: '',
  preferredMaintenanceWindow: '',
  readReplicaIdentifiers: [],
  dbClusterMembers: [
    { DBInstanceIdentifier: 'aurora-main-1', IsClusterWriter: true, DBClusterParameterGroupStatus: 'in-sync', PromotionTier: 1 },
    { DBInstanceIdentifier: 'aurora-main-2', IsClusterWriter: false, DBClusterParameterGroupStatus: 'in-sync', PromotionTier: 2 },
  ],
  serverlessV2ScalingConfiguration: {},
}

const clusterDetail = {
  cluster: { ...cluster, kmsKeyId: null, dbClusterParameterGroup: 'default.aurora', optionGroupMemberships: [], scalingConfigurationInfo: {}, pendingModifiedValues: {} },
}

const snapshot = {
  snapshotIdentifier: 'orders-snap-1',
  snapshotType: 'manual',
  status: 'available',
  sourceType: 'instance',
  sourceIdentifier: 'orders-db',
  engine: 'postgres',
  engineVersion: '15.4',
  allocatedStorage: 50,
  snapshotCreateTime: '2026-02-01T00:00:00Z',
  snapshotSize: 0,
  encrypted: true,
  kmsKeyId: null,
  tags: [],
}

const paramGroup = { name: 'pg-custom', family: 'postgres15', description: 'Custom params', source: 'instance', tags: [] }

const paramGroupDetail = {
  parameterGroup: {
    name: 'pg-custom',
    family: 'postgres15',
    description: 'Custom params',
    source: 'instance',
    parameters: [
      { name: 'max_connections', value: '100', description: 'Max connections', dataType: 'integer', allowedValues: '1-8388607', isModifiable: true, applyMethod: 'pending-reboot' },
    ],
  },
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let payload: unknown = statsPayload
    if (url.includes('/api/rds/instances/orders-db')) payload = instanceDetail
    else if (url.includes('/api/rds/clusters/aurora-main')) payload = clusterDetail
    else if (url.includes('/api/rds/parameter-groups/pg-custom')) payload = paramGroupDetail
    else if (url.includes('/api/rds/instances')) payload = { instances: [instance] }
    else if (url.includes('/api/rds/clusters')) payload = { clusters: [cluster] }
    else if (url.includes('/api/rds/snapshots')) payload = { snapshots: [snapshot] }
    else if (url.includes('/api/rds/parameter-groups')) payload = { parameterGroups: [paramGroup] }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderRDS(path = '/resources/rds') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('CloudscapeRDSBrowser (via registry dispatch)', () => {
  it('shows the four tabs with counts and lists instances', async () => {
    renderRDS()
    expect(await screen.findByText('Instances (1)')).toBeInTheDocument()
    expect(await screen.findByText('Clusters (1)')).toBeInTheDocument()
    expect(await screen.findByText('Snapshots (1)')).toBeInTheDocument()
    expect(await screen.findByText('Parameter groups (1)')).toBeInTheDocument()
    expect(await screen.findByText('orders-db')).toBeInTheDocument()
    expect(await screen.findByText('orders-db.local:5432')).toBeInTheDocument()
  })

  it('opens the instance detail with connection info and storage/backup tabs', async () => {
    renderRDS()
    fireEvent.click(await screen.findByRole('link', { name: 'orders-db' }))
    expect(await screen.findByText('postgres 15.4')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Storage'))
    expect(await screen.findByText('50 GiB')).toBeInTheDocument()
    expect(await screen.findByText('kms-1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Backup'))
    expect(await screen.findByText('7 days')).toBeInTheDocument()
    expect(await screen.findByText('03:00-04:00')).toBeInTheDocument()
  })

  it('shows cluster members with writer/reader roles and both endpoints', async () => {
    renderRDS()
    fireEvent.click(await screen.findByText('Clusters (1)'))
    fireEvent.click(await screen.findByRole('link', { name: 'aurora-main' }))
    expect(await screen.findByText('aurora-main.local:3306')).toBeInTheDocument()
    expect(await screen.findByText('aurora-main-ro.local:3306')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Members (2)'))
    expect(await screen.findByText('aurora-main-1')).toBeInTheDocument()
    expect(await screen.findByText('Writer')).toBeInTheDocument()
    expect(await screen.findByText('Reader')).toBeInTheDocument()
  })

  it('opens a parameter group with its parameters table', async () => {
    renderRDS()
    fireEvent.click(await screen.findByText('Parameter groups (1)'))
    fireEvent.click(await screen.findByRole('link', { name: 'pg-custom' }))
    expect(await screen.findByText('max_connections')).toBeInTheDocument()
    expect(await screen.findByText('pending-reboot')).toBeInTheDocument()

    const detailCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/rds/parameter-groups/pg-custom'))
    expect(String(detailCall![0])).toContain('source=instance')
  })

  it('lists snapshots with type, encryption and source', async () => {
    renderRDS()
    fireEvent.click(await screen.findByText('Snapshots (1)'))
    expect(await screen.findByText('orders-snap-1')).toBeInTheDocument()
    expect(await screen.findByText('orders-db (instance)')).toBeInTheDocument()
    expect(await screen.findByText('manual')).toBeInTheDocument()
  })
})
