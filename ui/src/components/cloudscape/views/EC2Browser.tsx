import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  fetchEC2AutoscalingGroups,
  fetchEC2InstanceDetail,
  fetchEC2Instances,
  fetchEC2SecurityGroupInboundRules,
  fetchEC2SecurityGroupOutboundRules,
  fetchEC2SecurityGroups,
  fetchEC2VPCs,
  rebootEC2Instance,
  startEC2Instance,
  stopEC2Instance,
  terminateEC2Instance,
  updateResourceTags,
} from '@/lib/api'
import type { EC2AutoScalingGroup, EC2Instance, EC2InstanceDetail, EC2SecurityGroup, EC2VPC } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { exportData } from '@/lib/export'

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function instanceStateIndicator(state: string) {
  const type: StatusIndicatorProps.Type =
    state === 'running'
      ? 'success'
      : state === 'stopped'
        ? 'stopped'
        : state === 'terminated'
          ? 'error'
          : state === 'pending' || state === 'stopping' || state === 'shutting-down'
            ? 'in-progress'
            : 'pending'
  return <StatusIndicator type={type}>{state}</StatusIndicator>
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
        exportData({ service: 'ec2', resourceType, data, format: detail.id as 'json' | 'csv' })
      }
    >
      Export
    </ButtonDropdown>
  )
}

function keyValueGrid(entries: Array<[string, React.ReactNode]>) {
  return (
    <ColumnLayout columns={2} variant="text-grid">
      {entries.map(([label, value]) => (
        <div key={label as string}>
          <Box variant="awsui-key-label">{label}</Box>
          <Box fontSize="body-s">{value}</Box>
        </div>
      ))}
    </ColumnLayout>
  )
}

// --- Instance detail --------------------------------------------------------

function InstanceTagsPanel({ detail, onSaved }: { detail: EC2InstanceDetail['instance']; onSaved: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>(
    detail.tags.map((t) => ({ key: t.Key, value: t.Value })),
  )
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const record = Object.fromEntries(tags.filter((t) => t.key.trim()).map((t) => [t.key.trim(), t.value]))
      await updateResourceTags('ec2', 'instances', detail.instanceId, record, activeEndpoint)
      toast.success('Instance tags updated')
      onSaved()
    } catch (error) {
      toast.error(`Failed to update tags: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SpaceBetween size="m">
      <AttributeEditor
        items={tags}
        onAddButtonClick={() => setTags([...tags, { key: '', value: '' }])}
        onRemoveButtonClick={({ detail: d }) => setTags(tags.filter((_, i) => i !== d.itemIndex))}
        addButtonText="Add tag"
        removeButtonText="Remove"
        empty="No tags"
        definition={[
          {
            label: 'Key',
            control: (item, index) => (
              <Input
                value={item.key}
                onChange={({ detail: d }) => setTags(tags.map((t, i) => (i === index ? { ...t, key: d.value } : t)))}
              />
            ),
          },
          {
            label: 'Value',
            control: (item, index) => (
              <Input
                value={item.value}
                onChange={({ detail: d }) => setTags(tags.map((t, i) => (i === index ? { ...t, value: d.value } : t)))}
              />
            ),
          },
        ]}
      />
      <Button variant="primary" onClick={save} loading={saving} data-testid="save-instance-tags">
        Save tags
      </Button>
    </SpaceBetween>
  )
}

function InstanceDetailModal({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchEC2InstanceDetail(instanceId, activeEndpoint), [instanceId, activeEndpoint])
  const { data, loading, error, refresh } = useFetch<EC2InstanceDetail>(fetcher, 10000)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmTerminate, setConfirmTerminate] = useState(false)

  const runAction = async (action: 'start' | 'stop' | 'reboot' | 'terminate') => {
    setActionLoading(true)
    try {
      if (action === 'start') {
        await startEC2Instance(instanceId, activeEndpoint)
        toast.success('Instance start initiated')
      } else if (action === 'stop') {
        await stopEC2Instance(instanceId, activeEndpoint)
        toast.success('Instance stop initiated')
      } else if (action === 'reboot') {
        await rebootEC2Instance(instanceId, activeEndpoint)
        toast.success('Instance reboot initiated')
      } else {
        await terminateEC2Instance(instanceId, activeEndpoint)
        toast.success('Instance termination initiated')
      }
      setTimeout(() => refresh(), 1000)
    } catch (err) {
      toast.error(`Action failed: ${err}`)
    } finally {
      setActionLoading(false)
      setConfirmTerminate(false)
    }
  }

  const instance = data?.instance
  const canStart = instance?.state === 'stopped'
  const canStop = instance?.state === 'running'

  return (
    <Modal visible onDismiss={onClose} header={instance?.name || instanceId} size="large">
      {loading && !data && <StatusIndicator type="loading">Loading instance</StatusIndicator>}
      {error && !data && (
        <Alert type="error" header="Could not load instance" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}
      {instance && (
        <SpaceBetween size="m">
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => void runAction('start')} disabled={!canStart || actionLoading} data-testid="instance-start">
              Start
            </Button>
            <Button onClick={() => void runAction('stop')} disabled={!canStop || actionLoading} data-testid="instance-stop">
              Stop
            </Button>
            <Button onClick={() => void runAction('reboot')} disabled={!canStop || actionLoading}>
              Reboot
            </Button>
            <Button onClick={() => setConfirmTerminate(true)} disabled={actionLoading} data-testid="instance-terminate">
              Terminate
            </Button>
          </SpaceBetween>

          <Tabs
            tabs={[
              {
                id: 'details',
                label: 'Details',
                content: (
                  <SpaceBetween size="m">
                    {keyValueGrid([
                      ['Instance ID', instance.instanceId],
                      ['State', instanceStateIndicator(instance.state)],
                      ['Type', instance.instanceType],
                      ['AMI', instance.imageId || '—'],
                      ['Key pair', instance.keyName || '—'],
                      ['Launch time', formatDate(instance.launchTime || '')],
                    ])}
                    {instance.userData && (
                      <>
                        <Header variant="h3">User data</Header>
                        <Box variant="code">
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{instance.userData}</pre>
                        </Box>
                      </>
                    )}
                  </SpaceBetween>
                ),
              },
              {
                id: 'networking',
                label: 'Networking',
                content: keyValueGrid([
                  ['VPC', instance.vpcId || '—'],
                  ['Subnet', instance.subnetId || '—'],
                  ['Public IP', instance.publicIpAddress || '—'],
                  ['Private IP', instance.privateIpAddress || '—'],
                ]),
              },
              {
                id: 'security',
                label: 'Security',
                content:
                  instance.securityGroups.length === 0 ? (
                    <Box color="text-status-inactive">No security groups attached</Box>
                  ) : (
                    <SpaceBetween size="xs">
                      {instance.securityGroups.map((sg) => (
                        <SpaceBetween key={sg.GroupId} direction="horizontal" size="xs">
                          <Box>{sg.GroupName}</Box>
                          <Box color="text-body-secondary" fontSize="body-s">
                            {sg.GroupId}
                          </Box>
                        </SpaceBetween>
                      ))}
                    </SpaceBetween>
                  ),
              },
              {
                id: 'tags',
                label: 'Tags',
                content: <InstanceTagsPanel detail={instance} onSaved={() => refresh()} />,
              },
              {
                id: 'raw',
                label: 'Raw',
                content: (
                  <Box variant="code">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(instance, null, 2)}
                    </pre>
                  </Box>
                ),
              },
            ]}
          />

          {confirmTerminate && (
            <Modal
              visible
              onDismiss={() => setConfirmTerminate(false)}
              header="Terminate instance"
              size="small"
              footer={
                <Box float="right">
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button variant="link" onClick={() => setConfirmTerminate(false)} disabled={actionLoading}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void runAction('terminate')}
                      loading={actionLoading}
                      data-testid="confirm-terminate"
                    >
                      Terminate
                    </Button>
                  </SpaceBetween>
                </Box>
              }
            >
              <Alert type="warning">
                Terminate instance {instanceId}? This action cannot be undone and all data on instance store volumes
                will be lost.
              </Alert>
            </Modal>
          )}
        </SpaceBetween>
      )}
    </Modal>
  )
}

// --- Security group detail --------------------------------------------------

interface SGRule {
  ruleId: string
  ipVersion: 'IPv4' | 'IPv6'
  type: 'Inbound' | 'Outbound'
  protocol: string
  portRange: string
  source: string
  description: string
}

function rulesTable(rules: SGRule[], direction: 'Inbound' | 'Outbound') {
  return (
    <Table
      items={rules}
      trackBy="ruleId"
      variant="embedded"
      empty={
        <Box textAlign="center" padding="l" color="text-status-inactive">
          No {direction.toLowerCase()} rules defined for this security group
        </Box>
      }
      columnDefinitions={[
        { id: 'ruleId', header: 'Rule ID', cell: (r) => r.ruleId },
        { id: 'ipVersion', header: 'IP version', cell: (r) => r.ipVersion },
        { id: 'protocol', header: 'Protocol', cell: (r) => r.protocol },
        { id: 'portRange', header: 'Port range', cell: (r) => r.portRange },
        { id: 'source', header: direction === 'Inbound' ? 'Source' : 'Destination', cell: (r) => r.source },
        { id: 'description', header: 'Description', cell: (r) => r.description || '—' },
      ]}
    />
  )
}

function SecurityGroupDetailModal({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const inboundFetcher = useCallback(
    () => fetchEC2SecurityGroupInboundRules(groupId, activeEndpoint),
    [groupId, activeEndpoint],
  )
  const outboundFetcher = useCallback(
    () => fetchEC2SecurityGroupOutboundRules(groupId, activeEndpoint),
    [groupId, activeEndpoint],
  )
  const { data: inbound, loading: inboundLoading } = useFetch(inboundFetcher, 10000)
  const { data: outbound, loading: outboundLoading } = useFetch(outboundFetcher, 10000)

  return (
    <Modal visible onDismiss={onClose} header={inbound?.groupName || groupId} size="max">
      {(inboundLoading || outboundLoading) && !inbound && !outbound ? (
        <StatusIndicator type="loading">Loading security group rules</StatusIndicator>
      ) : (
        <Tabs
          tabs={[
            {
              id: 'inbound',
              label: `Inbound rules (${inbound?.inboundRules.length ?? 0})`,
              content: rulesTable((inbound?.inboundRules ?? []) as SGRule[], 'Inbound'),
            },
            {
              id: 'outbound',
              label: `Outbound rules (${outbound?.outboundRules.length ?? 0})`,
              content: rulesTable((outbound?.outboundRules ?? []) as SGRule[], 'Outbound'),
            },
          ]}
        />
      )}
    </Modal>
  )
}

// --- ASG detail ---------------------------------------------------------------

function ASGDetailModal({ asg, onClose }: { asg: EC2AutoScalingGroup; onClose: () => void }) {
  return (
    <Modal visible onDismiss={onClose} header={asg.autoScalingGroupName} size="large">
      <Tabs
        tabs={[
          {
            id: 'details',
            label: 'Details',
            content: keyValueGrid([
              ['Name', asg.autoScalingGroupName],
              ['ARN', asg.autoScalingGroupARN],
              ['Created', formatDate(asg.createdTime)],
              ['Desired / Min / Max', `${asg.desiredCapacity} / ${asg.minSize} / ${asg.maxSize}`],
              ['Instances', String(asg.instanceCount)],
              ['Health check grace', `${asg.healthCheckGracePeriod}s`],
              ['Availability zones', asg.availabilityZones.join(', ') || '—'],
              ['Load balancers', asg.loadBalancerNames.join(', ') || '—'],
            ]),
          },
          {
            id: 'raw',
            label: 'Raw',
            content: (
              <Box variant="code">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(asg, null, 2)}</pre>
              </Box>
            ),
          },
        ]}
      />
    </Modal>
  )
}

// --- Tab contents -------------------------------------------------------------

function InstancesTab({ instances, loading, onOpen }: { instances: EC2Instance[]; loading: boolean; onOpen: (id: string) => void }) {
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(instances, {
    filtering: {
      filteringFunction: (i, text) => {
        const lower = text.toLowerCase()
        return (
          i.instanceId.toLowerCase().includes(lower) ||
          i.name.toLowerCase().includes(lower) ||
          i.state.toLowerCase().includes(lower) ||
          i.instanceType.toLowerCase().includes(lower)
        )
      },
    },
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="instanceId"
      loading={loading && instances.length === 0}
      loadingText="Loading instances"
      variant="borderless"
      stickyHeader
      header={<Box float="right">{exportDropdown('instances', instances as unknown as Record<string, unknown>[])}</Box>}
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Find instances by id, name, state or type"
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" padding="l" color="text-status-inactive">
          No EC2 instances exist yet
        </Box>
      }
      columnDefinitions={[
        {
          id: 'instanceId',
          header: 'Instance ID',
          sortingField: 'instanceId',
          cell: (i) => (
            <Link
              href={`?instance=${encodeURIComponent(i.instanceId)}`}
              onFollow={(event) => {
                event.preventDefault()
                onOpen(i.instanceId)
              }}
            >
              {i.instanceId}
            </Link>
          ),
        },
        { id: 'name', header: 'Name', sortingField: 'name', cell: (i) => i.name || '—' },
        { id: 'state', header: 'State', sortingField: 'state', cell: (i) => instanceStateIndicator(i.state) },
        { id: 'type', header: 'Type', sortingField: 'instanceType', cell: (i) => i.instanceType },
        { id: 'publicIp', header: 'Public IP', cell: (i) => i.publicIpAddress || '—' },
        { id: 'launchTime', header: 'Launch time', sortingField: 'launchTime', cell: (i) => formatDate(i.launchTime || '') },
      ]}
    />
  )
}

function SecurityGroupsTab({
  securityGroups,
  loading,
  onOpen,
}: {
  securityGroups: EC2SecurityGroup[]
  loading: boolean
  onOpen: (groupId: string) => void
}) {
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(securityGroups, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="groupId"
      loading={loading && securityGroups.length === 0}
      loadingText="Loading security groups"
      variant="borderless"
      stickyHeader
      header={<Box float="right">{exportDropdown('security-groups', securityGroups as unknown as Record<string, unknown>[])}</Box>}
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Find security groups"
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" padding="l" color="text-status-inactive">
          No security groups exist yet
        </Box>
      }
      columnDefinitions={[
        {
          id: 'groupId',
          header: 'Group ID',
          sortingField: 'groupId',
          cell: (sg) => (
            <Link
              href={`?securityGroup=${encodeURIComponent(sg.groupId)}`}
              onFollow={(event) => {
                event.preventDefault()
                onOpen(sg.groupId)
              }}
            >
              {sg.groupId}
            </Link>
          ),
        },
        { id: 'groupName', header: 'Name', sortingField: 'groupName', cell: (sg) => sg.groupName },
        { id: 'vpcId', header: 'VPC', cell: (sg) => sg.vpcId || '—' },
        { id: 'inbound', header: 'Inbound rules', cell: (sg) => sg.ipPermissions.length },
        { id: 'outbound', header: 'Outbound rules', cell: (sg) => sg.ipPermissionsEgress.length },
      ]}
    />
  )
}

function VPCsTab({ vpcs }: { vpcs: EC2VPC[] }) {
  if (vpcs.length === 0) {
    return (
      <Box textAlign="center" padding="l" color="text-status-inactive">
        No VPCs exist yet
      </Box>
    )
  }
  return (
    <SpaceBetween size="s">
      <Box float="right">{exportDropdown('vpcs', vpcs as unknown as Record<string, unknown>[])}</Box>
      {vpcs.map((vpc) => (
        <ExpandableSection
          key={vpc.vpcId}
          variant="container"
          headerText={vpc.vpcId}
          headerDescription={vpc.cidrBlock}
          headerActions={vpc.isDefault ? <Badge color="blue">Default</Badge> : undefined}
        >
          <Header variant="h3">Subnets ({vpc.subnets.length})</Header>
          {vpc.subnets.length === 0 ? (
            <Box color="text-status-inactive">No subnets</Box>
          ) : (
            <Table
              items={vpc.subnets}
              trackBy="subnetId"
              variant="embedded"
              columnDefinitions={[
                { id: 'subnetId', header: 'Subnet ID', cell: (s) => s.subnetId },
                { id: 'cidr', header: 'CIDR', cell: (s) => s.cidrBlock },
                { id: 'az', header: 'AZ', cell: (s) => s.availabilityZone },
                { id: 'ips', header: 'Available IPs', cell: (s) => s.availableIpAddressCount },
              ]}
            />
          )}
        </ExpandableSection>
      ))}
    </SpaceBetween>
  )
}

function ASGsTab({ asgs, onOpen }: { asgs: EC2AutoScalingGroup[]; onOpen: (asg: EC2AutoScalingGroup) => void }) {
  if (asgs.length === 0) {
    return (
      <Box textAlign="center" padding="l" color="text-status-inactive">
        No EC2 Auto Scaling groups exist yet
      </Box>
    )
  }
  return (
    <SpaceBetween size="s">
      <Box float="right">{exportDropdown('autoscaling-groups', asgs as unknown as Record<string, unknown>[])}</Box>
      {asgs.map((asg) => (
        <ExpandableSection
          key={asg.autoScalingGroupARN}
          variant="container"
          headerText={asg.autoScalingGroupName}
          headerDescription={`Desired ${asg.desiredCapacity} · Min ${asg.minSize} · Max ${asg.maxSize}`}
          headerActions={<Button onClick={() => onOpen(asg)}>Details</Button>}
        >
          <Header variant="h3">Instances ({asg.instanceCount})</Header>
          {asg.instances.length === 0 ? (
            <Box color="text-status-inactive">No active instances scaling.</Box>
          ) : (
            <Table
              items={asg.instances}
              trackBy="instanceId"
              variant="embedded"
              columnDefinitions={[
                { id: 'instanceId', header: 'Instance ID', cell: (i) => i.instanceId },
                {
                  id: 'lifecycle',
                  header: 'Lifecycle state',
                  cell: (i) =>
                    i.lifecycleState === 'InService' ? (
                      <StatusIndicator type="success">InService</StatusIndicator>
                    ) : (
                      <Box>{i.lifecycleState}</Box>
                    ),
                },
                { id: 'health', header: 'Health status', cell: (i) => i.healthStatus },
                { id: 'az', header: 'Availability zone', cell: (i) => i.availabilityZone },
              ]}
            />
          )}
        </ExpandableSection>
      ))}
    </SpaceBetween>
  )
}

// --- Root ---------------------------------------------------------------------

export function CloudscapeEC2Browser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedInstance = searchParams.get('instance')
  const selectedSecurityGroup = searchParams.get('securityGroup')

  const instancesFetcher = useCallback(() => fetchEC2Instances(activeEndpoint), [activeEndpoint])
  const sgFetcher = useCallback(() => fetchEC2SecurityGroups(activeEndpoint), [activeEndpoint])
  const vpcsFetcher = useCallback(() => fetchEC2VPCs(activeEndpoint), [activeEndpoint])
  const asgsFetcher = useCallback(() => fetchEC2AutoscalingGroups(activeEndpoint), [activeEndpoint])

  const { data: instancesData, loading: instancesLoading, error: instancesError, refresh: refreshInstances } = useFetch(instancesFetcher, 10000)
  const { data: sgData, loading: sgLoading, refresh: refreshSg } = useFetch(sgFetcher, 10000)
  const { data: vpcsData, loading: vpcsLoading, refresh: refreshVpcs } = useFetch(vpcsFetcher, 10000)
  const { data: asgsData, loading: asgsLoading, refresh: refreshAsgs } = useFetch(asgsFetcher, 10000)

  const [selectedAsg, setSelectedAsg] = useState<EC2AutoScalingGroup | null>(null)

  const instances = instancesData?.instances ?? []
  const securityGroups = sgData?.securityGroups ?? []
  const vpcs = vpcsData?.vpcs ?? []
  const asgs = asgsData ?? []

  const runningCount = instances.filter((i) => i.state === 'running').length
  const stoppedCount = instances.filter((i) => i.state === 'stopped').length
  const anyLoading = instancesLoading || sgLoading || vpcsLoading || asgsLoading

  const refreshAll = () => {
    refreshInstances()
    refreshSg()
    refreshVpcs()
    refreshAsgs()
  }

  const closeParam = (param: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete(param)
    setSearchParams(next)
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description="Manage EC2 instances, security groups, VPCs and Auto Scaling groups"
        actions={<Button iconName="refresh" onClick={refreshAll} loading={anyLoading} ariaLabel="Refresh EC2 data" />}
      >
        EC2
      </Header>

      {!instancesLoading && instancesError && (
        <Alert type="error" header="Could not load instances" action={<Button onClick={refreshAll}>Retry</Button>}>
          {instancesError}
        </Alert>
      )}

      <Container>
        <ColumnLayout columns={4} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Total instances</Box>
            <Box fontSize="display-l" fontWeight="bold">
              {instances.length}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Running</Box>
            <Box fontSize="display-l" fontWeight="bold" color="text-status-success">
              {runningCount}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Stopped</Box>
            <Box fontSize="display-l" fontWeight="bold" color="text-status-error">
              {stoppedCount}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Security groups</Box>
            <Box fontSize="display-l" fontWeight="bold">
              {securityGroups.length}
            </Box>
          </div>
        </ColumnLayout>
      </Container>

      <Tabs
        tabs={[
          {
            id: 'instances',
            label: `Instances (${instances.length})`,
            content: (
              <InstancesTab
                instances={instances}
                loading={instancesLoading}
                onOpen={(id) => setSearchParams({ instance: id })}
              />
            ),
          },
          {
            id: 'security-groups',
            label: `Security groups (${securityGroups.length})`,
            content: (
              <SecurityGroupsTab
                securityGroups={securityGroups}
                loading={sgLoading}
                onOpen={(groupId) => setSearchParams({ securityGroup: groupId })}
              />
            ),
          },
          {
            id: 'vpcs',
            label: `VPCs (${vpcs.length})`,
            content: <VPCsTab vpcs={vpcs} />,
          },
          {
            id: 'asgs',
            label: `Auto Scaling groups (${asgs.length})`,
            content: <ASGsTab asgs={asgs} onOpen={setSelectedAsg} />,
          },
        ]}
      />

      {selectedInstance && <InstanceDetailModal instanceId={selectedInstance} onClose={() => closeParam('instance')} />}
      {selectedSecurityGroup && (
        <SecurityGroupDetailModal groupId={selectedSecurityGroup} onClose={() => closeParam('securityGroup')} />
      )}
      {selectedAsg && <ASGDetailModal asg={selectedAsg} onClose={() => setSelectedAsg(null)} />}
    </SpaceBetween>
  )
}
