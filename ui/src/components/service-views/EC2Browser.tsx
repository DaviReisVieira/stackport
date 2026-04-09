import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchEC2Instances,
  fetchEC2InstanceDetail,
  fetchEC2SecurityGroups,
  fetchEC2VPCs,
  startEC2Instance,
  stopEC2Instance,
  terminateEC2Instance,
} from '@/lib/api'
import type {
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
import { JsonViewer } from '@/components/JsonViewer'
import { useFetch } from '@/hooks/useFetch'
import { Input } from '@/components/ui/input'
import {
  Server,
  Play,
  Square,
  Trash2,
  Shield,
  Network,
  Tag,
  ChevronRight,
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
  const fetcher = useCallback(() => fetchEC2InstanceDetail(instanceId), [instanceId])
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
        await startEC2Instance(instanceId)
        toast.success('Instance start initiated')
      } else if (action === 'stop') {
        await stopEC2Instance(instanceId)
        toast.success('Instance stop initiated')
      } else if (action === 'terminate') {
        await terminateEC2Instance(instanceId)
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
            <div className="space-y-6 mt-6">
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

              <Separator />

              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Instance Details
                </h3>
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
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  Networking
                </h3>
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
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Security Groups ({data.instance.securityGroups.length})
                </h3>
                {data.instance.securityGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No security groups</p>
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
              </div>

              {data.instance.userData && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold mb-3">User Data</h3>
                    <pre className="text-xs p-3 rounded border bg-muted overflow-x-auto">
                      {data.instance.userData}
                    </pre>
                  </div>
                </>
              )}

              {data.instance.tags.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      Tags ({data.instance.tags.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {data.instance.tags.map((tag) => (
                        <Badge key={tag.Key} variant="outline">
                          {tag.Key}: {tag.Value}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <div>
                <h3 className="text-sm font-semibold mb-3">Raw Data</h3>
                <JsonViewer data={data.instance} />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

export function EC2Browser() {
  const instancesFetcher = useCallback(() => fetchEC2Instances(), [])
  const sgFetcher = useCallback(() => fetchEC2SecurityGroups(), [])
  const vpcsFetcher = useCallback(() => fetchEC2VPCs(), [])

  const [searchParams, setSearchParams] = useSearchParams()

  const { data: instancesData, loading: instancesLoading, refresh: refreshInstances } = useFetch<{ instances: EC2Instance[] }>(instancesFetcher, 10000)
  const { data: sgData, loading: sgLoading } = useFetch<{ securityGroups: EC2SecurityGroup[] }>(sgFetcher, 10000)
  const { data: vpcsData, loading: vpcsLoading } = useFetch<{ vpcs: EC2VPC[] }>(vpcsFetcher, 10000)

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
      <Breadcrumb segments={[createHomeSegment(), { label: 'EC2', icon: Server }]} />
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Server className="h-6 w-6" />
          EC2 Instance Explorer
        </h2>
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
        <TabsList className="grid w-full grid-cols-3">
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
        </TabsList>

        <TabsContent value="instances" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>EC2 Instances</span>
                <Input
                  type="text"
                  placeholder="Search instances..."
                  value={instanceSearch}
                  onChange={(e) => setInstanceSearch(e.target.value)}
                  className="w-64"
                />
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
              <CardTitle className="text-base">Security Groups</CardTitle>
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
                      <TableRow key={sg.groupId}>
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
              <CardTitle className="text-base">VPCs</CardTitle>
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
      </Tabs>

      {selectedInstance && (
        <InstanceDetailSheet
          instanceId={selectedInstance}
          open={!!selectedInstance}
          onOpenChange={(open) => !open && setSelectedInstance(null)}
          onRefresh={refreshInstances}
        />
      )}
    </div>
  )
}
