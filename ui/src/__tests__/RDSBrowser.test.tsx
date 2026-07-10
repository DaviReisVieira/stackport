import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RDSBrowser } from '@/components/service-views/RDSBrowser'
import { TooltipProvider } from '@/components/ui/tooltip'

const sampleInstance = {
  dbInstanceIdentifier: 'test-db-instance-1',
  dbInstanceClass: 'db.t3.micro',
  engine: 'mysql',
  engineVersion: '8.0.32',
  status: 'available',
  masterUsername: 'admin',
  endpoint: 'test-db-instance-1.cxyz123.us-east-1.rds.amazonaws.com',
  port: 3306,
  multiAz: true,
  availabilityZone: 'us-east-1a',
  storageType: 'gp3',
  allocatedStorage: 100,
  storageEncrypted: true,
  publiclyAccessible: false,
  vpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-12345678', Status: 'active' }],
  dbSubnetGroup: { DBSubnetGroupName: 'default-vpc-123', VpcId: 'vpc-12345678' },
  parameterGroup: { DBParameterGroupName: 'default.mysql8.0' },
  tags: [{ Key: 'Environment', Value: 'test' }],
  createdTime: '2024-01-15T10:00:00Z',
}

const sampleCluster = {
  dbClusterIdentifier: 'test-cluster-1',
  engine: 'aurora-mysql',
  engineVersion: '8.0.mysql_aurora.3.04.0',
  status: 'available',
  masterUsername: 'clusteradmin',
  endpoint: 'test-cluster-1.cluster-cxyz.us-east-1.rds.amazonaws.com',
  readerEndpoint: 'test-cluster-1.reader-cxyz.us-east-1.rds.amazonaws.com',
  port: 3306,
  multiAz: true,
  storageType: 'aurora',
  allocatedStorage: 100,
  storageEncrypted: true,
  vpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-cluster-123', Status: 'active' }],
  dbSubnetGroup: 'default-vpc-123',
  dbClusterParameterGroup: 'default.aurora-mysql8.0',
  tags: [{ Key: 'Environment', Value: 'prod' }],
  createdTime: '2024-01-10T12:00:00Z',
  dbClusterMembers: [
    { DBInstanceIdentifier: 'test-cluster-1-instance-1', IsClusterWriter: true, PromotionTier: 1 },
    { DBInstanceIdentifier: 'test-cluster-1-instance-2', IsClusterWriter: false, PromotionTier: 2 },
  ],
}

const sampleSnapshot = {
  snapshotIdentifier: 'test-snapshot-1',
  snapshotType: 'automated',
  status: 'available',
  sourceType: 'instance',
  sourceIdentifier: 'test-db-instance-1',
  engine: 'mysql',
  allocatedStorage: 100,
  snapshotCreateTime: '2024-01-19T03:00:00Z',
}

const sampleParameterGroup = {
  name: 'default.mysql8.0',
  family: 'mysql8.0',
  description: 'Default MySQL 8.0 parameter group',
  source: 'instance' as const,
  tags: [],
}

const defaultInstancesResponse = { instances: [] as typeof sampleInstance[] }
const defaultClustersResponse = { clusters: [] as typeof sampleCluster[] }
const defaultSnapshotsResponse = { snapshots: [] as typeof sampleSnapshot[] }
const defaultParameterGroupsResponse = { parameterGroups: [] as typeof sampleParameterGroup[] }

const {
  fetchRDSInstancesMock,
  fetchRDSInstanceDetailMock,
  fetchRDSClustersMock,
  fetchRDSClusterDetailMock,
  fetchRDSSnapshotsMock,
  fetchRDSParameterGroupsMock,
  fetchRDSParameterGroupDetailMock,
} = vi.hoisted(() => ({
  fetchRDSInstancesMock: vi.fn(() => Promise.resolve({ ...defaultInstancesResponse })),
  fetchRDSInstanceDetailMock: vi.fn(() =>
    Promise.resolve({
      instance: {
        ...sampleInstance,
        backupRetentionPeriod: 7,
        preferredBackupWindow: '03:00-04:00',
        preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
        earliestRestorableTime: '2024-01-15T11:00:00Z',
        latestRestorableTime: '2024-01-20T10:00:00Z',
        iops: 3000,
        kmsKeyId: undefined,
        dbParameterGroups: [{ DBParameterGroupName: 'default.mysql8.0', ParameterApplyStatus: 'in-sync' }],
        optionGroupMemberships: [],
        certificateDetails: {},
        pendingModifiedValues: {},
      },
    }),
  ),
  fetchRDSClustersMock: vi.fn(() => Promise.resolve({ ...defaultClustersResponse })),
  fetchRDSClusterDetailMock: vi.fn(() =>
    Promise.resolve({
      cluster: {
        ...sampleCluster,
        kmsKeyId: undefined,
        dbClusterParameterGroup: 'default.aurora-mysql8.0',
        optionGroupMemberships: [],
        serverlessV2ScalingConfiguration: {},
        scalingConfigurationInfo: {},
        pendingModifiedValues: {},
      },
    }),
  ),
  fetchRDSSnapshotsMock: vi.fn(() => Promise.resolve({ ...defaultSnapshotsResponse })),
  fetchRDSParameterGroupsMock: vi.fn(() => Promise.resolve({ ...defaultParameterGroupsResponse })),
  fetchRDSParameterGroupDetailMock: vi.fn(() =>
    Promise.resolve({
      parameterGroup: {
        name: 'default.mysql8.0',
        family: 'mysql8.0',
        description: 'Default MySQL 8.0 parameter group',
        source: 'instance' as const,
        parameters: [
          {
            name: 'max_connections',
            value: '1000',
            description: 'Maximum number of connections',
            dataType: 'integer',
            allowedValues: '1-10000',
            isModifiable: true,
            applyMethod: 'pending-reboot',
          },
        ],
      },
    }),
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  fetchRDSInstances: fetchRDSInstancesMock,
  fetchRDSInstanceDetail: fetchRDSInstanceDetailMock,
  fetchRDSClusters: fetchRDSClustersMock,
  fetchRDSClusterDetail: fetchRDSClusterDetailMock,
  fetchRDSSnapshots: fetchRDSSnapshotsMock,
  fetchRDSParameterGroups: fetchRDSParameterGroupsMock,
  fetchRDSParameterGroupDetail: fetchRDSParameterGroupDetailMock,
}))

function renderRDSBrowser(search = '') {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/resources/rds${search}`]}>
        <Routes>
          <Route path="/resources/rds" element={<RDSBrowser />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  fetchRDSInstancesMock.mockResolvedValue({ ...defaultInstancesResponse })
  fetchRDSClustersMock.mockResolvedValue({ ...defaultClustersResponse })
  fetchRDSSnapshotsMock.mockResolvedValue({ ...defaultSnapshotsResponse })
  fetchRDSParameterGroupsMock.mockResolvedValue({ ...defaultParameterGroupsResponse })
  fetchRDSInstanceDetailMock.mockClear()
  fetchRDSClusterDetailMock.mockClear()
  fetchRDSParameterGroupDetailMock.mockClear()
})

describe('RDSBrowser', () => {
  describe('Loading states', () => {
    it('shows loading skeletons initially', () => {
      fetchRDSInstancesMock.mockReturnValue(new Promise(() => {})) // never resolves

      renderRDSBrowser()

      // Should show RDS Browser heading
      expect(screen.getByText('RDS Browser')).toBeInTheDocument()
    })
  })

  describe('Empty states', () => {
    it('shows empty state for instances tab when no data', async () => {
      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('No instances found')).toBeInTheDocument()
      })
      expect(screen.getByText('No RDS DB instances exist yet')).toBeInTheDocument()
    })

    it('shows empty state for clusters tab when no data', async () => {
      renderRDSBrowser()

      // Click on clusters tab first
      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('No clusters found')).toBeInTheDocument()
      })
      expect(screen.getByText('No RDS DB clusters exist yet')).toBeInTheDocument()
    })

    it('shows empty state for snapshots tab when no data', async () => {
      renderRDSBrowser()

      // Click on snapshots tab first
      const snapshotsTab = screen.getByRole('tab', { name: /snapshots/i })
      await userEvent.click(snapshotsTab)

      await waitFor(() => {
        expect(screen.getByText('No snapshots found')).toBeInTheDocument()
      })
      expect(screen.getByText('No RDS DB snapshots exist yet')).toBeInTheDocument()
    })

    it('shows empty state for parameter groups tab when no data', async () => {
      renderRDSBrowser()

      // Click on parameter groups tab first
      const parameterGroupsTab = screen.getByRole('tab', { name: /parameter groups/i })
      await userEvent.click(parameterGroupsTab)

      await waitFor(() => {
        expect(screen.getByText('No parameter groups found')).toBeInTheDocument()
      })
      expect(screen.getByText('No RDS parameter groups exist yet')).toBeInTheDocument()
    })
  })

  describe('Instances tab', () => {
    it('renders instances table with data', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [sampleInstance],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })
      expect(screen.getByText('mysql')).toBeInTheDocument()
      expect(screen.getByText('available')).toBeInTheDocument()
      expect(screen.getByText('db.t3.micro')).toBeInTheDocument()
    })

    it('displays instance count badge', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [sampleInstance],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('Instances')).toBeInTheDocument()
      })
      // Check for the count badge
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('opens instance detail sheet when clicking on instance row', async () => {
      const user = userEvent.setup()
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [sampleInstance],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-db-instance-1'))

      // Wait for the detail sheet to open and show connection info
      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('filters instances by search query', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [
          { ...sampleInstance, dbInstanceIdentifier: 'mysql-prod' },
          { ...sampleInstance, dbInstanceIdentifier: 'postgres-dev', engine: 'postgres' },
        ],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('mysql-prod')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search instances...')
      await userEvent.type(searchInput, 'postgres')

      expect(screen.getByText('postgres-dev')).toBeInTheDocument()
      expect(screen.queryByText('mysql-prod')).not.toBeInTheDocument()
    })
  })

  describe('Clusters tab', () => {
    it('renders clusters table with data', async () => {
      fetchRDSClustersMock.mockResolvedValue({
        clusters: [sampleCluster],
      })

      renderRDSBrowser()

      // Click on clusters tab first
      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('test-cluster-1')).toBeInTheDocument()
      })
      expect(screen.getByText('aurora-mysql')).toBeInTheDocument()
      expect(screen.getByText('available')).toBeInTheDocument()
    })

    it('displays cluster member count', async () => {
      fetchRDSClustersMock.mockResolvedValue({
        clusters: [sampleCluster],
      })

      renderRDSBrowser()

      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('test-cluster-1')).toBeInTheDocument()
      })
      // Check member count in table
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('opens cluster detail sheet when clicking on cluster row', async () => {
      const user = userEvent.setup()
      fetchRDSClustersMock.mockResolvedValue({
        clusters: [sampleCluster],
      })

      renderRDSBrowser()

      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('test-cluster-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-cluster-1'))

      // Wait for the detail sheet to open and show connection info
      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('filters clusters by search query', async () => {
      fetchRDSClustersMock.mockResolvedValue({
        clusters: [
          { ...sampleCluster, dbClusterIdentifier: 'aurora-prod' },
          { ...sampleCluster, dbClusterIdentifier: 'aurora-dev' },
        ],
      })

      renderRDSBrowser()

      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('aurora-prod')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search clusters...')
      await userEvent.type(searchInput, 'dev')

      expect(screen.getByText('aurora-dev')).toBeInTheDocument()
      expect(screen.queryByText('aurora-prod')).not.toBeInTheDocument()
    })
  })

  describe('Snapshots tab', () => {
    it('renders snapshots table with data', async () => {
      fetchRDSSnapshotsMock.mockResolvedValue({
        snapshots: [sampleSnapshot],
      })

      renderRDSBrowser()

      const snapshotsTab = screen.getByRole('tab', { name: /snapshots/i })
      await userEvent.click(snapshotsTab)

      await waitFor(() => {
        expect(screen.getByText('test-snapshot-1')).toBeInTheDocument()
      })
      expect(screen.getByText('automated')).toBeInTheDocument()
      expect(screen.getByText('available')).toBeInTheDocument()
    })

    it('displays snapshot source type badge', async () => {
      fetchRDSSnapshotsMock.mockResolvedValue({
        snapshots: [sampleSnapshot],
      })

      renderRDSBrowser()

      const snapshotsTab = screen.getByRole('tab', { name: /snapshots/i })
      await userEvent.click(snapshotsTab)

      await waitFor(() => {
        expect(screen.getByText('test-snapshot-1')).toBeInTheDocument()
      })
      expect(screen.getByText('Instance')).toBeInTheDocument()
    })
  })

  describe('Parameter Groups tab', () => {
    it('renders parameter groups list with data', async () => {
      fetchRDSParameterGroupsMock.mockResolvedValue({
        parameterGroups: [sampleParameterGroup],
      })

      renderRDSBrowser()

      const parameterGroupsTab = screen.getByRole('tab', { name: /parameter groups/i })
      await userEvent.click(parameterGroupsTab)

      await waitFor(() => {
        expect(screen.getByText('default.mysql8.0')).toBeInTheDocument()
      })
      expect(screen.getByText('Default MySQL 8.0 parameter group')).toBeInTheDocument()
    })

    it('displays parameter group source badge', async () => {
      fetchRDSParameterGroupsMock.mockResolvedValue({
        parameterGroups: [sampleParameterGroup],
      })

      renderRDSBrowser()

      const parameterGroupsTab = screen.getByRole('tab', { name: /parameter groups/i })
      await userEvent.click(parameterGroupsTab)

      await waitFor(() => {
        expect(screen.getByText('default.mysql8.0')).toBeInTheDocument()
      })
      expect(screen.getByText('instance')).toBeInTheDocument()
    })

    it('opens parameter group detail sheet when clicking', async () => {
      const user = userEvent.setup()
      fetchRDSParameterGroupsMock.mockResolvedValue({
        parameterGroups: [sampleParameterGroup],
      })

      renderRDSBrowser()

      const parameterGroupsTab = screen.getByRole('tab', { name: /parameter groups/i })
      await userEvent.click(parameterGroupsTab)

      await waitFor(() => {
        expect(screen.getByText('default.mysql8.0')).toBeInTheDocument()
      })

      await user.click(screen.getByText('default.mysql8.0'))

      // Wait for the detail sheet to open and show parameters
      await waitFor(() => {
        expect(screen.getByText('Parameters (1)')).toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('Tab navigation', () => {
    it('shows correct tab counts', async () => {
      fetchRDSInstancesMock.mockResolvedValue({ instances: [sampleInstance, { ...sampleInstance, dbInstanceIdentifier: 'instance-2' }] })
      fetchRDSClustersMock.mockResolvedValue({ clusters: [sampleCluster] })
      fetchRDSSnapshotsMock.mockResolvedValue({ snapshots: [sampleSnapshot, { ...sampleSnapshot, snapshotIdentifier: 'snap-2' }, { ...sampleSnapshot, snapshotIdentifier: 'snap-3' }] })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument()
      })

      // Click to different tabs and verify counts
      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)
      expect(screen.getByText('1')).toBeInTheDocument()

      const snapshotsTab = screen.getByRole('tab', { name: /snapshots/i })
      await userEvent.click(snapshotsTab)
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('switches between tabs correctly', async () => {
      fetchRDSInstancesMock.mockResolvedValue({ instances: [sampleInstance] })
      fetchRDSClustersMock.mockResolvedValue({ clusters: [sampleCluster] })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })

      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('test-cluster-1')).toBeInTheDocument()
      })
    })
  })

  describe('Instance Detail Sheet', () => {
    it('shows instance details in sheet', async () => {
      const user = userEvent.setup()
      fetchRDSInstancesMock.mockResolvedValue({ instances: [sampleInstance] })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-db-instance-1'))

      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
        expect(screen.getByText('Instance Class')).toBeInTheDocument()
      })

      // Check for engine and instance class in the details (using getAllByText since they appear in both table and sheet)
      expect(screen.getAllByText('mysql').length).toBeGreaterThan(0)
      expect(screen.getAllByText('db.t3.micro').length).toBeGreaterThan(0)
    })

    it('shows storage tab content', async () => {
      const user = userEvent.setup()
      fetchRDSInstancesMock.mockResolvedValue({ instances: [sampleInstance] })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-db-instance-1'))

      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
      })

      const storageTab = screen.getByRole('tab', { name: /storage/i })
      await userEvent.click(storageTab)

      await waitFor(() => {
        expect(screen.getByText('Storage Type')).toBeInTheDocument()
      })
      expect(screen.getByText('gp3')).toBeInTheDocument()
      expect(screen.getByText('100 GB')).toBeInTheDocument()
    })

    it('shows networking tab content', async () => {
      const user = userEvent.setup()
      fetchRDSInstancesMock.mockResolvedValue({ instances: [sampleInstance] })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-db-instance-1'))

      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
      })

      const networkingTab = screen.getByRole('tab', { name: /networking/i })
      await userEvent.click(networkingTab)

      await waitFor(() => {
        expect(screen.getByText('VPC Security Groups')).toBeInTheDocument()
      })
      expect(screen.getByText('sg-12345678')).toBeInTheDocument()
    })

    it('shows backup tab content', async () => {
      const user = userEvent.setup()
      fetchRDSInstancesMock.mockResolvedValue({ instances: [sampleInstance] })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-db-instance-1'))

      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
      })

      const backupTab = screen.getByRole('tab', { name: /backup/i })
      await userEvent.click(backupTab)

      await waitFor(() => {
        expect(screen.getByText('Backup Retention')).toBeInTheDocument()
      })
      expect(screen.getByText('7 days')).toBeInTheDocument()
    })
  })

  describe('Cluster Detail Sheet', () => {
    it('shows cluster details in sheet', async () => {
      const user = userEvent.setup()
      fetchRDSClustersMock.mockResolvedValue({ clusters: [sampleCluster] })

      renderRDSBrowser()

      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('test-cluster-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-cluster-1'))

      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
      })

      expect(screen.getByText('aurora-mysql 8.0.mysql_aurora.3.04.0')).toBeInTheDocument()
    })

    it('shows cluster members tab', async () => {
      const user = userEvent.setup()
      fetchRDSClustersMock.mockResolvedValue({ clusters: [sampleCluster] })

      renderRDSBrowser()

      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('test-cluster-1')).toBeInTheDocument()
      })

      await user.click(screen.getByText('test-cluster-1'))

      await waitFor(() => {
        expect(screen.getByText('Connection Information')).toBeInTheDocument()
      })

      const membersTab = screen.getByRole('tab', { name: /members/i })
      await userEvent.click(membersTab)

      expect(screen.getByText('Cluster Members (2)')).toBeInTheDocument()
      expect(screen.getByText('test-cluster-1-instance-1')).toBeInTheDocument()
      expect(screen.getByText('Writer')).toBeInTheDocument()
      expect(screen.getByText('Reader')).toBeInTheDocument()
    })
  })

  describe('Parameter Group Detail Sheet', () => {
    it('shows parameter group details', async () => {
      const user = userEvent.setup()
      fetchRDSParameterGroupsMock.mockResolvedValue({
        parameterGroups: [sampleParameterGroup],
      })

      renderRDSBrowser()

      const parameterGroupsTab = screen.getByRole('tab', { name: /parameter groups/i })
      await userEvent.click(parameterGroupsTab)

      await waitFor(() => {
        expect(screen.getByText('default.mysql8.0')).toBeInTheDocument()
      })

      await user.click(screen.getByText('default.mysql8.0'))

      await waitFor(() => {
        expect(screen.getByText('Parameters (1)')).toBeInTheDocument()
      })

      expect(screen.getByText('max_connections')).toBeInTheDocument()
      expect(screen.getByText('1000')).toBeInTheDocument()
    })
  })

  describe('Status badges', () => {
    it('shows correct status badge for available instances', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [{ ...sampleInstance, status: 'available' }],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('available')).toBeInTheDocument()
      })
    })

    it('shows correct status badge for creating instances', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [{ ...sampleInstance, status: 'creating' }],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('creating')).toBeInTheDocument()
      })
    })

    it('shows correct engine badge for mysql', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [{ ...sampleInstance, engine: 'mysql' }],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('mysql')).toBeInTheDocument()
      })
    })

    it('shows correct engine badge for postgres', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [{ ...sampleInstance, engine: 'postgres', engineVersion: '15.4' }],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('postgres')).toBeInTheDocument()
      })
    })
  })

  describe('Multi-AZ badge', () => {
    it('shows Yes for Multi-AZ enabled instances', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [{ ...sampleInstance, multiAz: true }],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('Yes')).toBeInTheDocument()
      })
    })

    it('shows No for Multi-AZ disabled instances', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [{ ...sampleInstance, multiAz: false }],
      })

      renderRDSBrowser()

      await waitFor(() => {
        const noBadges = screen.getAllByText('No')
        expect(noBadges.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Export functionality', () => {
    it('shows export dropdown when instances exist', async () => {
      fetchRDSInstancesMock.mockResolvedValue({
        instances: [sampleInstance],
      })

      renderRDSBrowser()

      await waitFor(() => {
        expect(screen.getByText('test-db-instance-1')).toBeInTheDocument()
      })

      // Export dropdown button should be present
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    })

    it('shows export dropdown when clusters exist', async () => {
      fetchRDSClustersMock.mockResolvedValue({
        clusters: [sampleCluster],
      })

      renderRDSBrowser()

      const clustersTab = screen.getByRole('tab', { name: /clusters/i })
      await userEvent.click(clustersTab)

      await waitFor(() => {
        expect(screen.getByText('test-cluster-1')).toBeInTheDocument()
      })

      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    })
  })
})
