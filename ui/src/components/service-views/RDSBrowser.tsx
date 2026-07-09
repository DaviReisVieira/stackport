import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchRDSInstances,
  fetchRDSInstanceDetail,
  fetchRDSClusters,
  fetchRDSClusterDetail,
  fetchRDSSnapshots,
  fetchRDSParameterGroups,
  fetchRDSParameterGroupDetail,
} from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import type {
  RDSInstance,
  RDSInstanceDetail,
  RDSCluster,
  RDSClusterDetail,
  RDSSnapshot,
  RDSParameterGroupInfo,
  RDSParameterGroupDetail,
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
  Database,
  Copy,
  Check,
  Server,
  Clock,
  HardDrive,
  Shield,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const lowerStatus = status.toLowerCase()
  if (lowerStatus.includes('available') || lowerStatus.includes('active')) {
    return 'default'
  }
  if (lowerStatus.includes('stopped') || lowerStatus.includes('failed')) {
    return 'destructive'
  }
  if (lowerStatus.includes('creating') || lowerStatus.includes('modifying') || lowerStatus.includes('backing-up')) {
    return 'secondary'
  }
  return 'outline'
}

function getEngineBadgeVariant(engine: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  const lowerEngine = engine.toLowerCase()
  if (lowerEngine.includes('mysql') || lowerEngine.includes('mariadb')) {
    return 'default'
  }
  if (lowerEngine.includes('postgres')) {
    return 'secondary'
  }
  if (lowerEngine.includes('oracle')) {
    return 'destructive'
  }
  return 'outline'
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => {
    toast.success(`${label} copied to clipboard`)
  }).catch(() => {
    toast.error(`Failed to copy ${label}`)
  })
}

function ConnectionInfoCard({ endpoint, port }: { endpoint: string; port: number }) {
  const [copied, setCopied] = useState(false)
  const connectionString = `${endpoint}:${port}`

  const handleCopy = () => {
    copyToClipboard(connectionString, 'Connection string')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!endpoint) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" />
          Connection Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
          <code className="flex-1 text-sm font-mono">{connectionString}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            className="shrink-0"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
          <div>
            <span className="text-muted-foreground">Endpoint</span>
            <p className="font-mono text-xs mt-1">{endpoint}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Port</span>
            <p className="font-mono text-xs mt-1">{port}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function InstanceDetailSheet({
  instanceId,
  open,
  onOpenChange,
}: {
  instanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchRDSInstanceDetail(instanceId, activeEndpoint), [instanceId, activeEndpoint])
  const { data, loading } = useFetch<RDSInstanceDetail>(fetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {data?.instance.dbInstanceIdentifier || instanceId}
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
            <ConnectionInfoCard endpoint={data.instance.endpoint} port={data.instance.port} />

            <Tabs defaultValue="details" className="w-full">
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="storage">Storage</TabsTrigger>
                <TabsTrigger value="networking">Networking</TabsTrigger>
                <TabsTrigger value="backup">Backup</TabsTrigger>
                <TabsTrigger value="tags">Tags</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Instance Identifier</span>
                        <span className="font-mono text-xs">{data.instance.dbInstanceIdentifier}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Engine</span>
                        <Badge variant={getEngineBadgeVariant(data.instance.engine)}>
                          {data.instance.engine} {data.instance.engineVersion}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant={getStatusVariant(data.instance.status)}>
                          {data.instance.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Instance Class</span>
                        <span className="text-xs">{data.instance.dbInstanceClass}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Master Username</span>
                        <span className="text-xs">{data.instance.masterUsername || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Multi-AZ</span>
                        <Badge variant={data.instance.multiAz ? 'default' : 'outline'}>
                          {data.instance.multiAz ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Availability Zone</span>
                        <span className="text-xs">{data.instance.availabilityZone || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Created</span>
                        <span className="text-xs">{formatDate(data.instance.createdTime)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="storage" className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Storage Type</span>
                        <span className="text-xs">{data.instance.storageType}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Allocated Storage</span>
                        <span className="text-xs">{data.instance.allocatedStorage} GB</span>
                      </div>
                      {data.instance.iops && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">IOPS</span>
                          <span className="text-xs">{data.instance.iops}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Storage Encrypted</span>
                        <Badge variant={data.instance.storageEncrypted ? 'default' : 'outline'}>
                          {data.instance.storageEncrypted ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                      {data.instance.kmsKeyId && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">KMS Key</span>
                          <span className="font-mono text-xs">{data.instance.kmsKeyId}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="networking" className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-semibold mb-2">VPC Security Groups</h4>
                        {data.instance.vpcSecurityGroups.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No security groups</p>
                        ) : (
                          <div className="space-y-1">
                            {data.instance.vpcSecurityGroups.map((sg) => (
                              <div key={sg.VpcSecurityGroupId} className="flex items-center gap-2 text-xs">
                                <Shield className="h-3 w-3 text-muted-foreground" />
                                <span>{sg.VpcSecurityGroupId}</span>
                                <Badge variant="outline" className="text-xs">{sg.Status}</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <Separator />
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Subnet Group</h4>
                        {data.instance.dbSubnetGroup ? (
                          <div className="text-xs space-y-1">
                            <p className="font-mono">{data.instance.dbSubnetGroup.DBSubnetGroupName}</p>
                            <p className="text-muted-foreground">{data.instance.dbSubnetGroup.VpcId}</p>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No subnet group</p>
                        )}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Publicly Accessible</span>
                        <Badge variant={data.instance.publiclyAccessible ? 'destructive' : 'outline'}>
                          {data.instance.publiclyAccessible ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="backup" className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Backup Retention</span>
                        <span className="text-xs">{data.instance.backupRetentionPeriod} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Backup Window</span>
                        <span className="text-xs">{data.instance.preferredBackupWindow || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Maintenance Window</span>
                        <span className="text-xs">{data.instance.preferredMaintenanceWindow || '—'}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Earliest Restorable</span>
                        <span className="text-xs">{formatDate(data.instance.earliestRestorableTime)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Latest Restorable</span>
                        <span className="text-xs">{formatDate(data.instance.latestRestorableTime)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="tags" className="space-y-4">
                <TagsSection
                  tags={Object.fromEntries(data.instance.tags.map(t => [t.Key, t.Value]))}
                  onSave={async () => {
                    toast.success('Tags updated')
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
  )
}

function ClusterDetailSheet({
  clusterId,
  open,
  onOpenChange,
}: {
  clusterId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchRDSClusterDetail(clusterId, activeEndpoint), [clusterId, activeEndpoint])
  const { data, loading } = useFetch<RDSClusterDetail>(fetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {data?.cluster.dbClusterIdentifier || clusterId}
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
            <ConnectionInfoCard endpoint={data.cluster.endpoint} port={data.cluster.port} />

            <Tabs defaultValue="details" className="w-full">
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="members">Members</TabsTrigger>
                <TabsTrigger value="config">Configuration</TabsTrigger>
                <TabsTrigger value="tags">Tags</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cluster Identifier</span>
                        <span className="font-mono text-xs">{data.cluster.dbClusterIdentifier}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Engine</span>
                        <Badge variant={getEngineBadgeVariant(data.cluster.engine)}>
                          {data.cluster.engine} {data.cluster.engineVersion}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant={getStatusVariant(data.cluster.status)}>
                          {data.cluster.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Master Username</span>
                        <span className="text-xs">{data.cluster.masterUsername || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Multi-AZ</span>
                        <Badge variant={data.cluster.multiAz ? 'default' : 'outline'}>
                          {data.cluster.multiAz ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Reader Endpoint</span>
                        <span className="font-mono text-xs">{data.cluster.readerEndpoint || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Created</span>
                        <span className="text-xs">{formatDate(data.cluster.createdTime)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="members" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Cluster Members ({data.cluster.dbClusterMembers.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.cluster.dbClusterMembers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No cluster members</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Instance</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Promotion Tier</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.cluster.dbClusterMembers.map((member) => (
                            <TableRow key={member.DBInstanceIdentifier}>
                              <TableCell className="font-mono text-xs">{member.DBInstanceIdentifier}</TableCell>
                              <TableCell>
                                <Badge variant={member.IsClusterWriter ? 'default' : 'secondary'}>
                                  {member.IsClusterWriter ? 'Writer' : 'Reader'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{member.PromotionTier}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="config" className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Storage Type</span>
                        <span className="text-xs">{data.cluster.storageType}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Allocated Storage</span>
                        <span className="text-xs">{data.cluster.allocatedStorage} GB</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Backup Retention</span>
                        <span className="text-xs">{data.cluster.backupRetentionPeriod} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Parameter Group</span>
                        <span className="font-mono text-xs">{data.cluster.dbClusterParameterGroup}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="tags" className="space-y-4">
                <TagsSection
                  tags={Object.fromEntries(data.cluster.tags.map(t => [t.Key, t.Value]))}
                  onSave={async () => {
                    toast.success('Tags updated')
                  }}
                />
              </TabsContent>

              <TabsContent value="raw" className="space-y-4">
                <JsonViewer data={data.cluster} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ParameterGroupDetailSheet({
  groupName,
  source,
  open,
  onOpenChange,
}: {
  groupName: string
  source: 'instance' | 'cluster'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchRDSParameterGroupDetail(groupName, source, activeEndpoint), [groupName, source, activeEndpoint])
  const { data, loading } = useFetch<RDSParameterGroupDetail>(fetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {data?.parameterGroup.name || groupName}
          </SheetTitle>
        </SheetHeader>

        {loading && <Skeleton className="h-64 w-full mt-4" />}

        {!loading && data && (
          <div className="mt-4 space-y-4">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-mono text-xs">{data.parameterGroup.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Family</span>
                    <span className="text-xs">{data.parameterGroup.family}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Description</span>
                    <span className="text-xs">{data.parameterGroup.description}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <Badge variant="outline">{data.parameterGroup.source}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Parameters ({data.parameterGroup.parameters.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Modifiable</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.parameterGroup.parameters.map((param) => (
                        <TableRow key={param.name}>
                          <TableCell className="font-mono text-xs">{param.name}</TableCell>
                          <TableCell className="text-xs">{param.value || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={param.isModifiable ? 'default' : 'outline'}>
                              {param.isModifiable ? 'Yes' : 'No'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function RDSBrowser() {
  const { activeEndpoint } = useEndpoint()
  const instancesFetcher = useCallback(() => fetchRDSInstances(activeEndpoint), [activeEndpoint])
  const clustersFetcher = useCallback(() => fetchRDSClusters(activeEndpoint), [activeEndpoint])
  const snapshotsFetcher = useCallback(() => fetchRDSSnapshots(null, null, null, activeEndpoint), [activeEndpoint])
  const parameterGroupsFetcher = useCallback(() => fetchRDSParameterGroups('all', activeEndpoint), [activeEndpoint])

  const [searchParams, setSearchParams] = useSearchParams()

  const { data: instancesData, loading: instancesLoading, refresh: refreshInstances } = useFetch<{ instances: RDSInstance[] }>(instancesFetcher, 10000)
  const { data: clustersData, loading: clustersLoading, refresh: refreshClusters } = useFetch<{ clusters: RDSCluster[] }>(clustersFetcher, 10000)
  const { data: snapshotsData, loading: snapshotsLoading, refresh: refreshSnapshots } = useFetch<{ snapshots: RDSSnapshot[] }>(snapshotsFetcher, 10000)
  const { data: parameterGroupsData, loading: parameterGroupsLoading, refresh: refreshParameterGroups } = useFetch<{ parameterGroups: RDSParameterGroupInfo[] }>(parameterGroupsFetcher, 10000)

  const [refreshing, setRefreshing] = useState(false)

  const selectedInstance = searchParams.get('instance')
  const selectedCluster = searchParams.get('cluster')
  const selectedParameterGroup = searchParams.get('parameterGroup')
  const selectedParameterGroupSource = (searchParams.get('parameterGroupSource') as 'instance' | 'cluster') || 'instance'

  const setSelectedInstance = (instance: string | null) => {
    if (instance === null) {
      setSearchParams({})
    } else {
      setSearchParams({ instance })
    }
  }

  const setSelectedCluster = (cluster: string | null) => {
    const params: Record<string, string> = {}
    if (selectedInstance) params.instance = selectedInstance
    if (cluster) params.cluster = cluster
    setSearchParams(params)
  }

  const setSelectedParameterGroup = (name: string | null, source: 'instance' | 'cluster' = 'instance') => {
    const params: Record<string, string> = {}
    if (selectedInstance) params.instance = selectedInstance
    if (selectedCluster) params.cluster = selectedCluster
    if (name) {
      params.parameterGroup = name
      params.parameterGroupSource = source
    }
    setSearchParams(params)
  }

  const [instanceSearch, setInstanceSearch] = useState('')
  const [clusterSearch, setClusterSearch] = useState('')

  const filteredInstances = (instancesData?.instances || []).filter((i) =>
    i.dbInstanceIdentifier.toLowerCase().includes(instanceSearch.toLowerCase()) ||
    i.engine.toLowerCase().includes(instanceSearch.toLowerCase()) ||
    i.status.toLowerCase().includes(instanceSearch.toLowerCase())
  )

  const filteredClusters = (clustersData?.clusters || []).filter((c) =>
    c.dbClusterIdentifier.toLowerCase().includes(clusterSearch.toLowerCase()) ||
    c.engine.toLowerCase().includes(clusterSearch.toLowerCase()) ||
    c.status.toLowerCase().includes(clusterSearch.toLowerCase())
  )

  return (
    <div className="space-y-6 p-6">
      <Breadcrumb segments={[createHomeSegment(), { label: 'RDS', icon: getServiceIcon('rds') }]} />
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" />
            RDS Browser
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={async () => {
              setRefreshing(true)
              await Promise.all([refreshInstances(), refreshClusters(), refreshSnapshots(), refreshParameterGroups()])
              setRefreshing(false)
            }}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Browse RDS DB instances, clusters, snapshots, and parameter groups
        </p>
      </div>

      <Tabs defaultValue="instances" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="instances">
            Instances
            {instancesData && <Badge variant="secondary" className="ml-2">{instancesData.instances.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="clusters">
            Clusters
            {clustersData && <Badge variant="secondary" className="ml-2">{clustersData.clusters.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="snapshots">
            Snapshots
            {snapshotsData && <Badge variant="secondary" className="ml-2">{snapshotsData.snapshots.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="parameter-groups">
            Parameter Groups
            {parameterGroupsData && <Badge variant="secondary" className="ml-2">{parameterGroupsData.parameterGroups.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instances" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>DB Instances</span>
                <div className="flex items-center gap-2">
                  {filteredInstances.length > 0 && (
                    <ExportDropdown service="rds" resourceType="instances" data={filteredInstances as unknown as Record<string, unknown>[]} />
                  )}
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
                  icon={Database}
                  title="No instances found"
                  description={instanceSearch ? 'Try adjusting your search' : 'No RDS DB instances exist yet'}
                />
              )}
              {!instancesLoading && filteredInstances.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Identifier</TableHead>
                      <TableHead>Engine</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Multi-AZ</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInstances.map((instance) => (
                      <TableRow
                        key={instance.dbInstanceIdentifier}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedInstance(instance.dbInstanceIdentifier)}
                      >
                        <TableCell className="font-mono text-xs">{instance.dbInstanceIdentifier}</TableCell>
                        <TableCell>
                          <Badge variant={getEngineBadgeVariant(instance.engine)}>
                            {instance.engine}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(instance.status)}>
                            {instance.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{instance.dbInstanceClass}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {instance.endpoint}:{instance.port}
                        </TableCell>
                        <TableCell>
                          <Badge variant={instance.multiAz ? 'default' : 'outline'}>
                            {instance.multiAz ? 'Yes' : 'No'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(instance.createdTime)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clusters" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>DB Clusters</span>
                <div className="flex items-center gap-2">
                  {filteredClusters.length > 0 && (
                    <ExportDropdown service="rds" resourceType="clusters" data={filteredClusters as unknown as Record<string, unknown>[]} />
                  )}
                  <Input
                    type="text"
                    placeholder="Search clusters..."
                    value={clusterSearch}
                    onChange={(e) => setClusterSearch(e.target.value)}
                    className="w-64"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {clustersLoading && <Skeleton className="h-64 w-full" />}
              {!clustersLoading && filteredClusters.length === 0 && (
                <EmptyState
                  icon={Database}
                  title="No clusters found"
                  description={clusterSearch ? 'Try adjusting your search' : 'No RDS DB clusters exist yet'}
                />
              )}
              {!clustersLoading && filteredClusters.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Identifier</TableHead>
                      <TableHead>Engine</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Reader Endpoint</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClusters.map((cluster) => (
                      <TableRow
                        key={cluster.dbClusterIdentifier}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedCluster(cluster.dbClusterIdentifier)}
                      >
                        <TableCell className="font-mono text-xs">{cluster.dbClusterIdentifier}</TableCell>
                        <TableCell>
                          <Badge variant={getEngineBadgeVariant(cluster.engine)}>
                            {cluster.engine}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(cluster.status)}>
                            {cluster.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{cluster.endpoint}</TableCell>
                        <TableCell className="font-mono text-xs">{cluster.readerEndpoint || '—'}</TableCell>
                        <TableCell className="text-xs">{cluster.dbClusterMembers.length}</TableCell>
                        <TableCell className="text-xs">{formatDate(cluster.createdTime)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="snapshots" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>DB Snapshots</span>
                {snapshotsData && snapshotsData.snapshots.length > 0 && (
                  <ExportDropdown service="rds" resourceType="snapshots" data={snapshotsData.snapshots as unknown as Record<string, unknown>[]} />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {snapshotsLoading && <Skeleton className="h-64 w-full" />}
              {!snapshotsLoading && (!snapshotsData || snapshotsData.snapshots.length === 0) && (
                <EmptyState
                  icon={Clock}
                  title="No snapshots found"
                  description="No RDS DB snapshots exist yet"
                />
              )}
              {!snapshotsLoading && snapshotsData && snapshotsData.snapshots.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Snapshot Identifier</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshotsData.snapshots.map((snapshot) => (
                      <TableRow key={snapshot.snapshotIdentifier}>
                        <TableCell className="font-mono text-xs">{snapshot.snapshotIdentifier}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{snapshot.snapshotType}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {snapshot.sourceType === 'cluster' ? (
                            <Badge variant="secondary">Cluster</Badge>
                          ) : (
                            <Badge variant="outline">Instance</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(snapshot.status)}>
                            {snapshot.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{snapshot.allocatedStorage} GB</TableCell>
                        <TableCell className="text-xs">{formatDate(snapshot.snapshotCreateTime)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parameter-groups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Parameter Groups</span>
                {parameterGroupsData && parameterGroupsData.parameterGroups.length > 0 && (
                  <ExportDropdown service="rds" resourceType="parameter-groups" data={parameterGroupsData.parameterGroups as unknown as Record<string, unknown>[]} />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {parameterGroupsLoading && <Skeleton className="h-64 w-full" />}
              {!parameterGroupsLoading && (!parameterGroupsData || parameterGroupsData.parameterGroups.length === 0) && (
                <EmptyState
                  icon={Database}
                  title="No parameter groups found"
                  description="No RDS parameter groups exist yet"
                />
              )}
              {!parameterGroupsLoading && parameterGroupsData && parameterGroupsData.parameterGroups.length > 0 && (
                <div className="space-y-2">
                  {parameterGroupsData.parameterGroups.map((group) => (
                    <div
                      key={`${group.source}-${group.name}`}
                      className="flex items-center justify-between p-3 border rounded-md cursor-pointer hover:bg-accent"
                      onClick={() => setSelectedParameterGroup(group.name, group.source)}
                    >
                      <div className="flex items-center gap-3">
                        <Database className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-mono text-sm">{group.name}</p>
                          <p className="text-xs text-muted-foreground">{group.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{group.family}</Badge>
                        <Badge variant={group.source === 'cluster' ? 'secondary' : 'outline'}>
                          {group.source}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
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
        />
      )}

      {selectedCluster && (
        <ClusterDetailSheet
          clusterId={selectedCluster}
          open={!!selectedCluster}
          onOpenChange={(open) => !open && setSelectedCluster(null)}
        />
      )}

      {selectedParameterGroup && (
        <ParameterGroupDetailSheet
          groupName={selectedParameterGroup}
          source={selectedParameterGroupSource}
          open={!!selectedParameterGroup}
          onOpenChange={(open) => !open && setSelectedParameterGroup(null)}
        />
      )}
    </div>
  )
}
