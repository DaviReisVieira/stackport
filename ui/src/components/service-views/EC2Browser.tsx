import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchEC2Instances,
  fetchEC2InstanceDetail,
  fetchEC2SecurityGroups,
  fetchEC2SecurityGroupInboundRules,
  fetchEC2SecurityGroupOutboundRules,
  fetchEC2VPCs,
  startEC2Instance,
  stopEC2Instance,
  terminateEC2Instance,
  updateResourceTags,
  fetchEC2AutoscalingGroups,
} from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import type {
  EC2AutoScalingGroup,
  EC2Instance,
  EC2InstanceDetail,
  EC2SecurityGroup,
  EC2VPC,
} from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import { ExportDropdown } from '@/components/ExportDropdown'
import { JsonViewer } from '@/components/JsonViewer'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { TagsSection } from '@/components/TagsSection'
import { Input } from '@/components/ui/input'
import {
  Server,
  Play,
  Square,
  Trash2,
  Shield,
  Network,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getStateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'running':
      return 'default'
    case 'stopped':
      return 'destructive'
    case 'pending':
    case 'stopping':
      return 'secondary'
    default:
      return 'outline'
  }
}

function EntityCard({
  icon: Icon,
  title,
  value,
}: {
  icon: typeof Server
  title: string
  value: string | number
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function InstanceDetailSheet({
  instanceId,
  open,
  onOpenChange,
  onRefresh,
}: {
  instanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchEC2InstanceDetail(instanceId, activeEndpoint), [instanceId, activeEndpoint])
  const { data, loading, refresh } = useFetch<EC2InstanceDetail>(fetcher, 10000)

  const [actionLoading, setActionLoading] = useState(false)

  const handleAction = async (action: 'start' | 'stop' | 'terminate') => {
    if (action === 'terminate') {
      const confirmed = window.confirm(
        `Are you sure you want to terminate instance ${instanceId}? This action cannot be undone and all data on instance store volumes will be lost.`
      )
      if (!confirmed) return
    }

    setActionLoading(true)
    try {
      if (action === 'start') {
        await startEC2Instance(instanceId, activeEndpoint)
        toast.success('Instance start initiated')
      } else if (action === 'stop') {
        await stopEC2Instance(instanceId, activeEndpoint)
        toast.success('Instance stop initiated')
      } else if (action === 'terminate') {
        await terminateEC2Instance(instanceId, activeEndpoint)
        toast.success('Instance termination initiated')
      }
      setTimeout(() => {
        refresh()
        onRefresh()
      }, 1000)
    } catch (error) {
      toast.error(`Action failed: ${error}`)
    } finally {
      setActionLoading(false)
    }
  }

  const canStart = data?.instance.state === 'stopped'
  const canStop = data?.instance.state === 'running'

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              {data?.instance.name || instanceId}
            </SheetTitle>
          </SheetHeader>

          {loading && (
            <div className="space-y-4 mt-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}

          {!loading && data && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleAction('start')}
                  disabled={!canStart || actionLoading}
                >
                  <Play className="h-4 w-4 mr-1" />
                  Start
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleAction('stop')}
                  disabled={!canStop || actionLoading}
                >
                  <Square className="h-4 w-4 mr-1" />
                  Stop
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleAction('terminate')}
                  disabled={actionLoading}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Terminate
                </Button>
              </div>

              <Tabs defaultValue="details" className="w-full">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="networking">Networking</TabsTrigger>
                  <TabsTrigger value="security">Security</TabsTrigger>
                  <TabsTrigger value="tags">Tags</TabsTrigger>
                  <TabsTrigger value="raw">Raw</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Instance ID</span>
                          <span className="font-mono text-xs">{data.instance.instanceId}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">State</span>
                          <Badge variant={getStateVariant(data.instance.state)}>
                            {data.instance.state}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Type</span>
                          <span className="text-xs">{data.instance.instanceType}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">AMI</span>
                          <span className="font-mono text-xs">{data.instance.imageId || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Key Pair</span>
                          <span className="text-xs">{data.instance.keyName || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Launch Time</span>
                          <span className="text-xs">{formatDate(data.instance.launchTime || '')}</span>
                        </div>
                      </div>
                      {data.instance.userData && (
                        <>
                          <Separator className="my-4" />
                          <div>
                            <h3 className="text-sm font-semibold mb-3">User Data</h3>
                            <pre className="text-xs p-3 rounded border bg-muted overflow-x-auto">
                              {data.instance.userData}
                            </pre>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="networking" className="space-y-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">VPC</span>
                          <span className="font-mono text-xs">{data.instance.vpcId || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Subnet</span>
                          <span className="font-mono text-xs">{data.instance.subnetId || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Public IP</span>
                          <span className="font-mono text-xs">{data.instance.publicIpAddress || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Private IP</span>
                          <span className="font-mono text-xs">{data.instance.privateIpAddress || '—'}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="security" className="space-y-4">
                  {data.instance.securityGroups.length === 0 ? (
                    <EmptyState icon={Shield} title="No Security Groups" description="No security groups attached." />
                  ) : (
                    <div className="space-y-2">
                      {data.instance.securityGroups.map((sg) => (
                        <div key={sg.GroupId} className="flex items-center gap-2 p-2 rounded border bg-card">
                          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{sg.GroupName}</span>
                          <code className="text-xs text-muted-foreground ml-auto">{sg.GroupId}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="tags" className="space-y-4">
                  <TagsSection
                    tags={Object.fromEntries(data.instance.tags.map(t => [t.Key, t.Value]))}
                    onSave={async (newTags) => {
                      await updateResourceTags('ec2', 'instances', data.instance.instanceId, newTags, activeEndpoint)
                    }}
                  />
                </TabsContent>

                <TabsContent value="raw" className="space-y-4">
                  <JsonViewer data={data.instance} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

interface EC2SecurityGroupRule {
  ruleId: string
  ipVersion: "IPv4" | "IPv6"
  type: "Inbound" | "Outbound"
  protocol: string
  portRange: string
  source: string
  description: string
}

function SecurityGroupDetailSheet({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeEndpoint } = useEndpoint()
  const inboundFetcher = useCallback(() => fetchEC2SecurityGroupInboundRules(groupId, activeEndpoint), [groupId, activeEndpoint])
  const outboundFetcher = useCallback(() => fetchEC2SecurityGroupOutboundRules(groupId, activeEndpoint), [groupId, activeEndpoint])
  const { data: inboundData, loading: inboundLoading } = useFetch<{ groupId: string; groupName: string; inboundRules: EC2SecurityGroupRule[] }>(inboundFetcher, 10000)
  const { data: outboundData, loading: outboundLoading } = useFetch<{ groupId: string; groupName: string; outboundRules: EC2SecurityGroupRule[] }>(outboundFetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {inboundData?.groupName || groupId}
          </SheetTitle>
        </SheetHeader>

        {(inboundLoading || outboundLoading) && (
          <div className="space-y-4 mt-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {!inboundLoading && !outboundLoading && (
          <div className="mt-4">
            <Tabs defaultValue="inbound" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="inbound">
                  Inbound Rules
                  {inboundData && <Badge variant="secondary" className="ml-2">{inboundData.inboundRules.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="outbound">
                  Outbound Rules
                  {outboundData && <Badge variant="secondary" className="ml-2">{outboundData.outboundRules.length}</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="inbound" className="space-y-4">
                {inboundData && inboundData.inboundRules.length === 0 ? (
                  <EmptyState icon={Shield} title="No Inbound Rules" description="No inbound rules defined for this security group." />
                ) : (
                  inboundData && (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[180px]">Security group rule ID</TableHead>
                            <TableHead className="w-[100px]">IP version</TableHead>
                            <TableHead className="w-[100px]">Type</TableHead>
                            <TableHead className="w-[100px]">Protocol</TableHead>
                            <TableHead className="w-[120px]">Port range</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inboundData.inboundRules.map((rule) => (
                            <TableRow key={rule.ruleId}>
                              <TableCell className="font-mono text-xs">{rule.ruleId}</TableCell>
                              <TableCell className="text-xs">{rule.ipVersion}</TableCell>
                              <TableCell className="text-xs">{rule.type}</TableCell>
                              <TableCell className="font-mono text-xs">{rule.protocol}</TableCell>
                              <TableCell className="font-mono text-xs">{rule.portRange}</TableCell>
                              <TableCell className="text-xs">{rule.source}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{rule.description || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )
                )}
              </TabsContent>

              <TabsContent value="outbound" className="space-y-4">
                {outboundData && outboundData.outboundRules.length === 0 ? (
                  <EmptyState icon={Shield} title="No Outbound Rules" description="No outbound rules defined for this security group." />
                ) : (
                  outboundData && (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[180px]">Security group rule ID</TableHead>
                            <TableHead className="w-[100px]">IP version</TableHead>
                            <TableHead className="w-[100px]">Type</TableHead>
                            <TableHead className="w-[100px]">Protocol</TableHead>
                            <TableHead className="w-[120px]">Port range</TableHead>
                            <TableHead>Destination</TableHead>
                            <TableHead>Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {outboundData.outboundRules.map((rule) => (
                            <TableRow key={rule.ruleId}>
                              <TableCell className="font-mono text-xs">{rule.ruleId}</TableCell>
                              <TableCell className="text-xs">{rule.ipVersion}</TableCell>
                              <TableCell className="text-xs">{rule.type}</TableCell>
                              <TableCell className="font-mono text-xs">{rule.protocol}</TableCell>
                              <TableCell className="font-mono text-xs">{rule.portRange}</TableCell>
                              <TableCell className="text-xs">{rule.source}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{rule.description || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ASGDetailSheet({
  asg,
  open,
  onOpenChange,
}: {
  asg: EC2AutoScalingGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {asg && (
          <>
            <SheetHeader>
              <SheetTitle>{asg.autoScalingGroupName}</SheetTitle>
            </SheetHeader>

            <div className="mt-4">
              <Tabs defaultValue="details" className="w-full">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="raw">Raw</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Name</span>
                          <span className="text-xs text-right">{asg.autoScalingGroupName}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">ARN</span>
                          <span className="font-mono text-xs text-right break-all">{asg.autoScalingGroupARN}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Created</span>
                          <span className="text-xs">{formatDate(asg.createdTime)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Desired / Min / Max</span>
                          <span className="text-xs">{asg.desiredCapacity} / {asg.minSize} / {asg.maxSize}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Instances</span>
                          <span className="text-xs">{asg.instanceCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Health Check Grace</span>
                          <span className="text-xs">{asg.healthCheckGracePeriod}s</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Availability Zones</span>
                          <span className="text-xs text-right">{asg.availabilityZones.join(', ') || '—'}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Load Balancers</span>
                          <span className="text-xs text-right">{asg.loadBalancerNames.join(', ') || '—'}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="raw" className="space-y-4">
                  <JsonViewer data={asg} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function EC2Browser() {
  const { activeEndpoint } = useEndpoint()
  const instancesFetcher = useCallback(() => fetchEC2Instances(activeEndpoint), [activeEndpoint])
  const sgFetcher = useCallback(() => fetchEC2SecurityGroups(activeEndpoint), [activeEndpoint])
  const vpcsFetcher = useCallback(() => fetchEC2VPCs(activeEndpoint), [activeEndpoint])
  const asgsFetcher = useCallback(() => fetchEC2AutoscalingGroups(activeEndpoint), [activeEndpoint])

  const [searchParams, setSearchParams] = useSearchParams()

  const { data: instancesData, loading: instancesLoading, refresh: refreshInstances } = useFetch<{ instances: EC2Instance[] }>(instancesFetcher, 10000)
  const { data: sgData, loading: sgLoading, refresh: refreshSg } = useFetch<{ securityGroups: EC2SecurityGroup[] }>(sgFetcher, 10000)
  const { data: vpcsData, loading: vpcsLoading, refresh: refreshVpcs } = useFetch<{ vpcs: EC2VPC[] }>(vpcsFetcher, 10000)
  const { data: asgsData, loading: asgsLoading, refresh: refreshAsgs } = useFetch<EC2AutoScalingGroup[]>(asgsFetcher, 10000)

  const [refreshing, setRefreshing] = useState(false)
  const [selectedAsg, setSelectedAsg] = useState<EC2AutoScalingGroup | null>(null)
  const [selectedSecurityGroup, setSelectedSecurityGroup] = useState<string | null>(null)

  // Read selected instance from URL params
  const selectedInstance = searchParams.get('instance')

  // Helper to update URL params
  const setSelectedInstance = (instance: string | null) => {
    if (instance === null) {
      setSearchParams({})
    } else {
      setSearchParams({ instance })
    }
  }

  const [instanceSearch, setInstanceSearch] = useState('')

  const filteredInstances = useMemo(() => {
    if (!instancesData?.instances) return []
    if (!instanceSearch) return instancesData.instances
    const lower = instanceSearch.toLowerCase()
    return instancesData.instances.filter((i) =>
      i.instanceId.toLowerCase().includes(lower) ||
      i.name.toLowerCase().includes(lower) ||
      i.state.toLowerCase().includes(lower) ||
      i.instanceType.toLowerCase().includes(lower)
    )
  }, [instancesData, instanceSearch])

  const runningCount = instancesData?.instances.filter((i) => i.state === 'running').length ?? 0
  const stoppedCount = instancesData?.instances.filter((i) => i.state === 'stopped').length ?? 0

  return (
    <div className="space-y-6 p-6">
      <Breadcrumb segments={[createHomeSegment(), { label: 'EC2', icon: getServiceIcon('ec2') }]} />
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6" />
            EC2 Instance Explorer
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={async () => { setRefreshing(true); await Promise.all([refreshInstances(), refreshSg(), refreshVpcs(), refreshAsgs()]); setRefreshing(false) }}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Manage EC2 instances, security groups, and VPCs
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <EntityCard icon={Server} title="Total Instances" value={instancesData?.instances.length ?? 0} />
        <EntityCard icon={Play} title="Running" value={runningCount} />
        <EntityCard icon={Square} title="Stopped" value={stoppedCount} />
        <EntityCard icon={Shield} title="Security Groups" value={sgData?.securityGroups.length ?? 0} />
      </div>

      <Tabs defaultValue="instances" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="instances">
            Instances
            {instancesData && <Badge variant="secondary" className="ml-2">{instancesData.instances.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="security-groups">
            Security Groups
            {sgData && <Badge variant="secondary" className="ml-2">{sgData.securityGroups.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="vpcs">
            VPCs
            {vpcsData && <Badge variant="secondary" className="ml-2">{vpcsData.vpcs.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="autoscaling-groups">
            Autoscaling Groups
            {asgsData && <Badge variant="secondary" className="ml-2">{asgsData.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instances" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>EC2 Instances</span>
                <div className="flex items-center gap-2">
                  {filteredInstances.length > 0 && <ExportDropdown service="ec2" resourceType="instances" data={filteredInstances as unknown as Record<string, unknown>[]} />}
                  <Input
                    type="text"
                    placeholder="Search instances..."
                    value={instanceSearch}
                    onChange={(e) => setInstanceSearch(e.target.value)}
                    className="w-64"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {instancesLoading && <Skeleton className="h-64 w-full" />}
              {!instancesLoading && filteredInstances.length === 0 && (
                <EmptyState
                  icon={Server}
                  title="No instances found"
                  description={instanceSearch ? 'Try adjusting your search' : 'No EC2 instances exist yet'}
                />
              )}
              {!instancesLoading && filteredInstances.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instance ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Public IP</TableHead>
                      <TableHead>Launch Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInstances.map((instance) => (
                      <TableRow
                        key={instance.instanceId}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedInstance(instance.instanceId)}
                      >
                        <TableCell className="font-mono text-xs">{instance.instanceId}</TableCell>
                        <TableCell className="font-medium">{instance.name || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={getStateVariant(instance.state)}>
                            {instance.state}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{instance.instanceType}</TableCell>
                        <TableCell className="font-mono text-xs">{instance.publicIpAddress || '—'}</TableCell>
                        <TableCell className="text-xs">{formatDate(instance.launchTime || '')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security-groups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Security Groups</span>
                {sgData && sgData.securityGroups.length > 0 && <ExportDropdown service="ec2" resourceType="security-groups" data={sgData.securityGroups as unknown as Record<string, unknown>[]} />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sgLoading && <Skeleton className="h-64 w-full" />}
              {!sgLoading && sgData && sgData.securityGroups.length === 0 && (
                <EmptyState
                  icon={Shield}
                  title="No security groups found"
                  description="No security groups exist yet"
                />
              )}
              {!sgLoading && sgData && sgData.securityGroups.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>VPC</TableHead>
                      <TableHead>Inbound Rules</TableHead>
                      <TableHead>Outbound Rules</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sgData.securityGroups.map((sg) => (
                      <TableRow
                        key={sg.groupId}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedSecurityGroup(sg.groupId)}
                      >
                        <TableCell className="font-mono text-xs">{sg.groupId}</TableCell>
                        <TableCell className="font-medium">{sg.groupName}</TableCell>
                        <TableCell className="font-mono text-xs">{sg.vpcId || '—'}</TableCell>
                        <TableCell>{sg.ipPermissions.length}</TableCell>
                        <TableCell>{sg.ipPermissionsEgress.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vpcs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>VPCs</span>
                {vpcsData && vpcsData.vpcs.length > 0 && <ExportDropdown service="ec2" resourceType="vpcs" data={vpcsData.vpcs as unknown as Record<string, unknown>[]} />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vpcsLoading && <Skeleton className="h-64 w-full" />}
              {!vpcsLoading && vpcsData && vpcsData.vpcs.length === 0 && (
                <EmptyState
                  icon={Network}
                  title="No VPCs found"
                  description="No VPCs exist yet"
                />
              )}
              {!vpcsLoading && vpcsData && vpcsData.vpcs.length > 0 && (
                <div className="space-y-4">
                  {vpcsData.vpcs.map((vpc) => (
                    <details key={vpc.vpcId} className="group border rounded p-3">
                      <summary className="cursor-pointer flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Network className="h-4 w-4" />
                          <span className="font-mono text-sm">{vpc.vpcId}</span>
                          <Badge variant="outline" className="text-xs">{vpc.cidrBlock}</Badge>
                          {vpc.isDefault && <Badge className="text-xs">Default</Badge>}
                        </div>
                        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-3 pl-6">
                        <h4 className="text-sm font-semibold mb-2">Subnets ({vpc.subnets.length})</h4>
                        {vpc.subnets.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No subnets</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Subnet ID</TableHead>
                                <TableHead>CIDR</TableHead>
                                <TableHead>AZ</TableHead>
                                <TableHead>Available IPs</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {vpc.subnets.map((subnet) => (
                                <TableRow key={subnet.subnetId}>
                                  <TableCell className="font-mono text-xs">{subnet.subnetId}</TableCell>
                                  <TableCell className="text-xs">{subnet.cidrBlock}</TableCell>
                                  <TableCell className="text-xs">{subnet.availabilityZone}</TableCell>
                                  <TableCell className="text-xs">{subnet.availableIpAddressCount}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="autoscaling-groups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Autoscaling Groups</span>
                {asgsData && asgsData.length > 0 && <ExportDropdown service="ec2" resourceType="autoscaling-groups" data={asgsData as unknown as Record<string, unknown>[]} />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {asgsLoading && <Skeleton className="h-64 w-full" />}
              {!asgsLoading && asgsData && asgsData.length === 0 && (
                <EmptyState
                  icon={Network}
                  title="No ASGs found"
                  description="No EC2 autoscaling groups exist yet"
                />
              )}
              {!asgsLoading && asgsData && asgsData.length > 0 && (
                <div className="space-y-4">
                  {asgsData.map((asg) => (
                    <details key={asg.autoScalingGroupARN} className="group border rounded p-3">
                      <summary className="cursor-pointer flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Network className="h-4 w-4" />
                          <span className="font-mono text-sm">{asg.autoScalingGroupName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedAsg(asg)
                            }}
                          >
                            Details
                          </Button>
                          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                        </div>
                      </summary>

                      <div className="mt-3 pl-6">
                      <h4 className="text-sm font-semibold mb-2">Instances ({asg.instanceCount})</h4>
                      {asg.instances.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No active instances scaling.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Instance ID</TableHead>
                              <TableHead>Lifecycle State</TableHead>
                              <TableHead>Health Status</TableHead>
                              <TableHead>Availability Zone</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {asg.instances.map((instance) => (
                              <TableRow key={instance.instanceId}>
                                <TableCell className="font-mono text-xs">{instance.instanceId}</TableCell>
                                <TableCell className="text-xs">
                                  <Badge variant={instance.lifecycleState === 'InService' ? 'default' : 'outline'}>
                                    {instance.lifecycleState}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs">{instance.healthStatus}</TableCell>
                                <TableCell className="text-xs">{instance.availabilityZone}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                    </details>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {selectedInstance && (
        <InstanceDetailSheet
          instanceId={selectedInstance}
          open={!!selectedInstance}
          onOpenChange={(open) => !open && setSelectedInstance(null)}
          onRefresh={refreshInstances}
        />
      )}

      {selectedSecurityGroup && (
        <SecurityGroupDetailSheet
          groupId={selectedSecurityGroup}
          open={!!selectedSecurityGroup}
          onOpenChange={(open) => !open && setSelectedSecurityGroup(null)}
        />
      )}

      <ASGDetailSheet
        asg={selectedAsg}
        open={!!selectedAsg}
        onOpenChange={(open) => !open && setSelectedAsg(null)}
      />
    </div>
  )
}
