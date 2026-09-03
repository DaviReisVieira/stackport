import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  fetchRDSClusterDetail,
  fetchRDSClusters,
  fetchRDSInstanceDetail,
  fetchRDSInstances,
  fetchRDSParameterGroupDetail,
  fetchRDSParameterGroups,
  fetchRDSSnapshots,
} from '@/lib/api'
import type {
  RDSCluster,
  RDSClusterDetail,
  RDSInstance,
  RDSInstanceDetail,
  RDSParameterGroupDetail,
  RDSParameterGroupInfo,
  RDSSnapshot,
} from '@/lib/types'
import { exportData } from '@/lib/export'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function engineBadgeColor(engine: string): 'blue' | 'green' | 'red' | 'grey' {
  const lower = engine.toLowerCase()
  if (lower.includes('postgres')) return 'blue'
  if (lower.includes('mysql') || lower.includes('mariadb')) return 'green'
  if (lower.includes('oracle') || lower.includes('sqlserver')) return 'red'
  return 'grey'
}

function statusIndicator(status: string) {
  const lower = status.toLowerCase()
  return (
    <StatusIndicator
      type={lower === 'available' ? 'success' : lower.includes('delet') || lower.includes('fail') ? 'error' : 'in-progress'}
    >
      {status}
    </StatusIndicator>
  )
}

function copyText(text: string, label: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied to clipboard`))
    .catch(() => toast.error(`Failed to copy ${label}`))
}

function kvGrid(rows: Array<[string, React.ReactNode]>, columns: 2 | 3 = 2) {
  return (
    <ColumnLayout columns={columns} variant="text-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <Box variant="awsui-key-label">{label}</Box>
          <Box fontSize="body-s">{value}</Box>
        </div>
      ))}
    </ColumnLayout>
  )
}

function tagsBadges(tags: Array<{ Key: string; Value: string }>) {
  if (!tags || tags.length === 0) return <Box color="text-status-inactive">No tags</Box>
  return (
    <SpaceBetween direction="horizontal" size="xs">
      {tags.map((tag) => (
        <Badge key={tag.Key} color="grey">
          {tag.Key}: {tag.Value}
        </Badge>
      ))}
    </SpaceBetween>
  )
}

function jsonBlock(value: unknown) {
  return (
    <Box variant="code">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre>
    </Box>
  )
}

function connectionPanel(entries: Array<{ label: string; endpoint: string; port: number }>) {
  return (
    <SpaceBetween size="s">
      {entries
        .filter((entry) => entry.endpoint)
        .map((entry) => (
          <SpaceBetween key={entry.label} direction="horizontal" size="xs">
            <Box variant="awsui-key-label">{entry.label}</Box>
            <Box fontSize="body-s">
              {entry.endpoint}:{entry.port}
            </Box>
            <Button
              variant="inline-icon"
              iconName="copy"
              ariaLabel={`Copy ${entry.label}`}
              onClick={() => copyText(`${entry.endpoint}:${entry.port}`, entry.label)}
            />
          </SpaceBetween>
        ))}
    </SpaceBetween>
  )
}

function DetailModalShell({
  title,
  loading,
  error,
  onClose,
  children,
}: {
  title: string
  loading: boolean
  error: string | null
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Modal visible onDismiss={onClose} header={title} size="large">
      {loading && <StatusIndicator type="loading">Loading</StatusIndicator>}
      {!loading && error && <Alert type="error">{error}</Alert>}
      {!loading && !error && children}
    </Modal>
  )
}

function InstanceDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchRDSInstanceDetail(id, activeEndpoint), [id, activeEndpoint])
  const { data, loading, error } = useFetch<RDSInstanceDetail>(fetcher)
  const inst = data?.instance

  return (
    <DetailModalShell title={id} loading={loading} error={error} onClose={onClose}>
      {inst && (
        <SpaceBetween size="m">
          {connectionPanel([{ label: 'Connection', endpoint: inst.endpoint, port: inst.port }])}
          <Tabs
            tabs={[
              {
                id: 'details',
                label: 'Details',
                content: kvGrid([
                  ['Engine', `${inst.engine} ${inst.engineVersion}`],
                  ['Status', statusIndicator(inst.status)],
                  ['Class', inst.dbInstanceClass],
                  ['Master username', inst.masterUsername],
                  ['Availability zone', inst.availabilityZone || '—'],
                  ['Multi-AZ', inst.multiAz ? 'Yes' : 'No'],
                  ['Created', formatDate(inst.createdTime)],
                  ['Read replica source', inst.readReplicaSourceIdentifier ?? '—'],
                  ['Read replicas', inst.readReplicaIdentifiers.length ? inst.readReplicaIdentifiers.join(', ') : '—'],
                ]),
              },
              {
                id: 'storage',
                label: 'Storage',
                content: kvGrid([
                  ['Storage type', inst.storageType || '—'],
                  ['Allocated storage', `${inst.allocatedStorage} GiB`],
                  ['IOPS', inst.iops ? String(inst.iops) : '—'],
                  ['Encrypted', inst.storageEncrypted ? 'Yes' : 'No'],
                  ['KMS key', inst.kmsKeyId ?? '—'],
                ]),
              },
              {
                id: 'networking',
                label: 'Networking',
                content: kvGrid([
                  ['Publicly accessible', inst.publiclyAccessible ? 'Yes' : 'No'],
                  ['Subnet group', (inst.dbSubnetGroup as { DBSubnetGroupName?: string })?.DBSubnetGroupName ?? '—'],
                  [
                    'VPC security groups',
                    inst.vpcSecurityGroups.length
                      ? inst.vpcSecurityGroups
                          .map((sg) => (sg as { VpcSecurityGroupId?: string }).VpcSecurityGroupId ?? '')
                          .filter(Boolean)
                          .join(', ')
                      : '—',
                  ],
                ]),
              },
              {
                id: 'backup',
                label: 'Backup',
                content: kvGrid([
                  ['Retention period', `${inst.backupRetentionPeriod} days`],
                  ['Backup window', inst.preferredBackupWindow || '—'],
                  ['Maintenance window', inst.preferredMaintenanceWindow || '—'],
                  ['Earliest restorable', formatDate(inst.earliestRestorableTime)],
                  ['Latest restorable', formatDate(inst.latestRestorableTime)],
                ]),
              },
              { id: 'tags', label: 'Tags', content: tagsBadges(inst.tags) },
              { id: 'raw', label: 'Raw', content: jsonBlock(inst) },
            ]}
          />
        </SpaceBetween>
      )}
    </DetailModalShell>
  )
}

function ClusterDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchRDSClusterDetail(id, activeEndpoint), [id, activeEndpoint])
  const { data, loading, error } = useFetch<RDSClusterDetail>(fetcher)
  const cluster = data?.cluster

  return (
    <DetailModalShell title={id} loading={loading} error={error} onClose={onClose}>
      {cluster && (
        <SpaceBetween size="m">
          {connectionPanel([
            { label: 'Primary endpoint', endpoint: cluster.endpoint, port: cluster.port },
            { label: 'Reader endpoint', endpoint: cluster.readerEndpoint, port: cluster.port },
          ])}
          <Tabs
            tabs={[
              {
                id: 'details',
                label: 'Details',
                content: kvGrid([
                  ['Engine', `${cluster.engine} ${cluster.engineVersion}`],
                  ['Status', statusIndicator(cluster.status)],
                  ['Master username', cluster.masterUsername],
                  ['Multi-AZ', cluster.multiAz ? 'Yes' : 'No'],
                  ['Created', formatDate(cluster.createdTime)],
                  ['Encrypted', cluster.storageEncrypted ? 'Yes' : 'No'],
                ]),
              },
              {
                id: 'members',
                label: `Members (${cluster.dbClusterMembers.length})`,
                content:
                  cluster.dbClusterMembers.length === 0 ? (
                    <Box color="text-status-inactive">No members</Box>
                  ) : (
                    <Table
                      variant="embedded"
                      items={cluster.dbClusterMembers}
                      trackBy="DBInstanceIdentifier"
                      columnDefinitions={[
                        { id: 'id', header: 'Instance', cell: (m) => m.DBInstanceIdentifier },
                        {
                          id: 'role',
                          header: 'Role',
                          cell: (m) =>
                            m.IsClusterWriter ? <Badge color="blue">Writer</Badge> : <Badge color="grey">Reader</Badge>,
                        },
                        { id: 'tier', header: 'Promotion tier', cell: (m) => m.PromotionTier },
                      ]}
                    />
                  ),
              },
              {
                id: 'config',
                label: 'Configuration',
                content: kvGrid([
                  ['Parameter group', String(cluster.dbClusterParameterGroup ?? '—')],
                  ['Subnet group', String(cluster.dbSubnetGroup ?? '—')],
                  ['Backup retention', `${cluster.backupRetentionPeriod} days`],
                  ['Backup window', cluster.preferredBackupWindow || '—'],
                  ['Maintenance window', cluster.preferredMaintenanceWindow || '—'],
                ]),
              },
              { id: 'tags', label: 'Tags', content: tagsBadges(cluster.tags) },
              { id: 'raw', label: 'Raw', content: jsonBlock(cluster) },
            ]}
          />
        </SpaceBetween>
      )}
    </DetailModalShell>
  )
}

function ParameterGroupDetailModal({
  name,
  source,
  onClose,
}: {
  name: string
  source: 'instance' | 'cluster'
  onClose: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(
    () => fetchRDSParameterGroupDetail(name, source, activeEndpoint),
    [name, source, activeEndpoint],
  )
  const { data, loading, error } = useFetch<RDSParameterGroupDetail>(fetcher)
  const group = data?.parameterGroup

  const parameters = useMemo(() => group?.parameters ?? [], [group])
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(parameters, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <DetailModalShell title={name} loading={loading} error={error} onClose={onClose}>
      {group && (
        <SpaceBetween size="m">
          {kvGrid([
            ['Family', group.family],
            ['Source', group.source],
            ['Description', group.description || '—'],
          ])}
          <Table
            {...collectionProps}
            variant="embedded"
            items={items}
            trackBy="name"
            header={<Header variant="h3" counter={`(${parameters.length})`}>Parameters</Header>}
            filter={
              <TextFilter
                {...filterProps}
                filteringPlaceholder="Find a parameter"
                countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
              />
            }
            pagination={<Pagination {...paginationProps} />}
            empty={<Box textAlign="center">No parameters</Box>}
            columnDefinitions={[
              { id: 'name', header: 'Name', sortingField: 'name', cell: (p) => p.name },
              { id: 'value', header: 'Value', cell: (p) => p.value || '—' },
              {
                id: 'modifiable',
                header: 'Modifiable',
                cell: (p) => (p.isModifiable ? 'Yes' : 'No'),
              },
              { id: 'apply', header: 'Apply method', cell: (p) => p.applyMethod },
              { id: 'allowed', header: 'Allowed values', cell: (p) => p.allowedValues || '—' },
            ]}
          />
        </SpaceBetween>
      )}
    </DetailModalShell>
  )
}

function exportDropdown(resourceType: string, data: Record<string, unknown>[]) {
  if (data.length === 0) return undefined
  return (
    <ButtonDropdown
      items={[
        { id: 'json', text: 'Export as JSON' },
        { id: 'csv', text: 'Export as CSV' },
      ]}
      onItemClick={({ detail }) =>
        exportData({ service: 'rds', resourceType, data, format: detail.id as 'json' | 'csv' })
      }
    >
      Export
    </ButtonDropdown>
  )
}

export function CloudscapeRDSBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedInstance = searchParams.get('instance')
  const selectedCluster = searchParams.get('cluster')
  const selectedParameterGroup = searchParams.get('parameterGroup')
  const parameterGroupSource = (searchParams.get('parameterGroupSource') as 'instance' | 'cluster') || 'instance'

  const instancesFetcher = useCallback(() => fetchRDSInstances(activeEndpoint), [activeEndpoint])
  const clustersFetcher = useCallback(() => fetchRDSClusters(activeEndpoint), [activeEndpoint])
  const snapshotsFetcher = useCallback(() => fetchRDSSnapshots(null, null, null, activeEndpoint), [activeEndpoint])
  const groupsFetcher = useCallback(() => fetchRDSParameterGroups(undefined, activeEndpoint), [activeEndpoint])

  const { data: instancesData, loading: instancesLoading, refresh: refreshInstances } = useFetch<{ instances: RDSInstance[] }>(instancesFetcher, 15000)
  const { data: clustersData, loading: clustersLoading, refresh: refreshClusters } = useFetch<{ clusters: RDSCluster[] }>(clustersFetcher, 15000)
  const { data: snapshotsData, loading: snapshotsLoading, refresh: refreshSnapshots } = useFetch<{ snapshots: RDSSnapshot[] }>(snapshotsFetcher, 15000)
  const { data: groupsData, loading: groupsLoading, refresh: refreshGroups } = useFetch<{ parameterGroups: RDSParameterGroupInfo[] }>(groupsFetcher, 15000)

  const openParam = useCallback(
    (params: Record<string, string>) => setSearchParams(params),
    [setSearchParams],
  )
  const closeDetail = useCallback(() => setSearchParams({}), [setSearchParams])

  const refreshAll = useCallback(() => {
    refreshInstances()
    refreshClusters()
    refreshSnapshots()
    refreshGroups()
  }, [refreshInstances, refreshClusters, refreshSnapshots, refreshGroups])

  const instances = instancesData?.instances ?? []
  const clusters = clustersData?.clusters ?? []
  const snapshots = snapshotsData?.snapshots ?? []
  const groups = groupsData?.parameterGroups ?? []

  const instancesCollection = useCollection(instances, { filtering: {}, pagination: { pageSize: 25 }, sorting: {} })
  const clustersCollection = useCollection(clusters, { filtering: {}, pagination: { pageSize: 25 }, sorting: {} })
  const snapshotsCollection = useCollection(snapshots, { filtering: {}, pagination: { pageSize: 25 }, sorting: {} })
  const groupsCollection = useCollection(groups, { filtering: {}, pagination: { pageSize: 25 }, sorting: {} })

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        actions={<Button iconName="refresh" onClick={refreshAll} loading={instancesLoading || clustersLoading} ariaLabel="Refresh RDS" />}
      >
        Relational Database Service
      </Header>

      <Tabs
        tabs={[
          {
            id: 'instances',
            label: `Instances (${instances.length})`,
            content: (
              <Table
                {...instancesCollection.collectionProps}
                items={instancesCollection.items}
                trackBy="dbInstanceIdentifier"
                loading={instancesLoading && !instancesData}
                loadingText="Loading instances"
                variant="embedded"
                header={<Box float="right">{exportDropdown('instances', instances as unknown as Record<string, unknown>[])}</Box>}
                filter={
                  <TextFilter
                    {...instancesCollection.filterProps}
                    filteringPlaceholder="Find an instance"
                    countText={instancesCollection.filteredItemsCount !== undefined ? `${instancesCollection.filteredItemsCount} matches` : ''}
                  />
                }
                pagination={<Pagination {...instancesCollection.paginationProps} />}
                empty={<Box textAlign="center">No DB instances found</Box>}
                columnDefinitions={[
                  {
                    id: 'id',
                    header: 'Identifier',
                    sortingField: 'dbInstanceIdentifier',
                    cell: (i) => (
                      <Link
                        href={`?instance=${encodeURIComponent(i.dbInstanceIdentifier)}`}
                        onFollow={(event) => {
                          event.preventDefault()
                          openParam({ instance: i.dbInstanceIdentifier })
                        }}
                      >
                        {i.dbInstanceIdentifier}
                      </Link>
                    ),
                  },
                  {
                    id: 'engine',
                    header: 'Engine',
                    sortingField: 'engine',
                    cell: (i) => <Badge color={engineBadgeColor(i.engine)}>{i.engine}</Badge>,
                  },
                  { id: 'status', header: 'Status', sortingField: 'status', cell: (i) => statusIndicator(i.status) },
                  { id: 'class', header: 'Class', sortingField: 'dbInstanceClass', cell: (i) => i.dbInstanceClass },
                  {
                    id: 'endpoint',
                    header: 'Endpoint',
                    cell: (i) => (i.endpoint ? `${i.endpoint}:${i.port}` : '—'),
                  },
                  { id: 'multiaz', header: 'Multi-AZ', cell: (i) => (i.multiAz ? 'Yes' : 'No') },
                ]}
              />
            ),
          },
          {
            id: 'clusters',
            label: `Clusters (${clusters.length})`,
            content: (
              <Table
                {...clustersCollection.collectionProps}
                items={clustersCollection.items}
                trackBy="dbClusterIdentifier"
                loading={clustersLoading && !clustersData}
                loadingText="Loading clusters"
                variant="embedded"
                header={<Box float="right">{exportDropdown('clusters', clusters as unknown as Record<string, unknown>[])}</Box>}
                filter={
                  <TextFilter
                    {...clustersCollection.filterProps}
                    filteringPlaceholder="Find a cluster"
                    countText={clustersCollection.filteredItemsCount !== undefined ? `${clustersCollection.filteredItemsCount} matches` : ''}
                  />
                }
                pagination={<Pagination {...clustersCollection.paginationProps} />}
                empty={<Box textAlign="center">No DB clusters found</Box>}
                columnDefinitions={[
                  {
                    id: 'id',
                    header: 'Identifier',
                    sortingField: 'dbClusterIdentifier',
                    cell: (c) => (
                      <Link
                        href={`?cluster=${encodeURIComponent(c.dbClusterIdentifier)}`}
                        onFollow={(event) => {
                          event.preventDefault()
                          openParam({ cluster: c.dbClusterIdentifier })
                        }}
                      >
                        {c.dbClusterIdentifier}
                      </Link>
                    ),
                  },
                  {
                    id: 'engine',
                    header: 'Engine',
                    sortingField: 'engine',
                    cell: (c) => <Badge color={engineBadgeColor(c.engine)}>{c.engine}</Badge>,
                  },
                  { id: 'status', header: 'Status', sortingField: 'status', cell: (c) => statusIndicator(c.status) },
                  { id: 'endpoint', header: 'Primary endpoint', cell: (c) => c.endpoint || '—' },
                  { id: 'members', header: 'Members', cell: (c) => c.dbClusterMembers.length },
                ]}
              />
            ),
          },
          {
            id: 'snapshots',
            label: `Snapshots (${snapshots.length})`,
            content: (
              <Table
                {...snapshotsCollection.collectionProps}
                items={snapshotsCollection.items}
                trackBy="snapshotIdentifier"
                loading={snapshotsLoading && !snapshotsData}
                loadingText="Loading snapshots"
                variant="embedded"
                header={<Box float="right">{exportDropdown('snapshots', snapshots as unknown as Record<string, unknown>[])}</Box>}
                filter={
                  <TextFilter
                    {...snapshotsCollection.filterProps}
                    filteringPlaceholder="Find a snapshot"
                    countText={snapshotsCollection.filteredItemsCount !== undefined ? `${snapshotsCollection.filteredItemsCount} matches` : ''}
                  />
                }
                pagination={<Pagination {...snapshotsCollection.paginationProps} />}
                empty={<Box textAlign="center">No snapshots found</Box>}
                columnDefinitions={[
                  { id: 'id', header: 'Identifier', sortingField: 'snapshotIdentifier', cell: (s) => s.snapshotIdentifier },
                  { id: 'source', header: 'Source', cell: (s) => `${s.sourceIdentifier} (${s.sourceType})` },
                  { id: 'type', header: 'Type', sortingField: 'snapshotType', cell: (s) => s.snapshotType || '—' },
                  { id: 'status', header: 'Status', cell: (s) => statusIndicator(s.status) },
                  { id: 'engine', header: 'Engine', cell: (s) => s.engine || '—' },
                  { id: 'size', header: 'Size', cell: (s) => `${s.allocatedStorage} GiB` },
                  { id: 'encrypted', header: 'Encrypted', cell: (s) => (s.encrypted ? 'Yes' : 'No') },
                  { id: 'created', header: 'Created', cell: (s) => formatDate(s.snapshotCreateTime) },
                ]}
              />
            ),
          },
          {
            id: 'parameter-groups',
            label: `Parameter groups (${groups.length})`,
            content: (
              <Table
                {...groupsCollection.collectionProps}
                items={groupsCollection.items}
                trackBy={(g) => `${g.source}:${g.name}`}
                loading={groupsLoading && !groupsData}
                loadingText="Loading parameter groups"
                variant="embedded"
                filter={
                  <TextFilter
                    {...groupsCollection.filterProps}
                    filteringPlaceholder="Find a parameter group"
                    countText={groupsCollection.filteredItemsCount !== undefined ? `${groupsCollection.filteredItemsCount} matches` : ''}
                  />
                }
                pagination={<Pagination {...groupsCollection.paginationProps} />}
                empty={<Box textAlign="center">No parameter groups found</Box>}
                columnDefinitions={[
                  {
                    id: 'name',
                    header: 'Name',
                    sortingField: 'name',
                    cell: (g) => (
                      <Link
                        href={`?parameterGroup=${encodeURIComponent(g.name)}&parameterGroupSource=${g.source}`}
                        onFollow={(event) => {
                          event.preventDefault()
                          openParam({ parameterGroup: g.name, parameterGroupSource: g.source })
                        }}
                      >
                        {g.name}
                      </Link>
                    ),
                  },
                  {
                    id: 'source',
                    header: 'Source',
                    sortingField: 'source',
                    cell: (g) => <Badge color={g.source === 'cluster' ? 'blue' : 'grey'}>{g.source}</Badge>,
                  },
                  { id: 'family', header: 'Family', sortingField: 'family', cell: (g) => g.family },
                  { id: 'description', header: 'Description', cell: (g) => g.description || '—' },
                ]}
              />
            ),
          },
        ]}
      />

      {selectedInstance && <InstanceDetailModal id={selectedInstance} onClose={closeDetail} />}
      {selectedCluster && <ClusterDetailModal id={selectedCluster} onClose={closeDetail} />}
      {selectedParameterGroup && (
        <ParameterGroupDetailModal name={selectedParameterGroup} source={parameterGroupSource} onClose={closeDetail} />
      )}
    </SpaceBetween>
  )
}
