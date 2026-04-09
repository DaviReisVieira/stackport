import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchLambdaFunctions,
  fetchLambdaFunction,
  getLambdaCodeDownloadUrl,
  invokeLambdaFunction,
  fetchLambdaEventSources,
  fetchLambdaAliases,
  fetchLambdaVersions,
} from '@/lib/api'
import type {
  LambdaFunction,
  LambdaFunctionDetail,
  LambdaEventSourceMapping,
  LambdaAlias,
  LambdaVersion,
  LambdaInvokeResponse,
} from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { JsonViewer } from '@/components/JsonViewer'
import { useFetch } from '@/hooks/useFetch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  Zap,
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  Play,
  Clock,
  AlertCircle,
  CheckCircle,
  Tag as TagIcon,
  Link as LinkIcon,
  GitBranch,
} from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function RuntimeBadge({ runtime }: { runtime: string }) {
  let color = 'bg-gray-500'
  if (runtime.startsWith('python')) color = 'bg-blue-500'
  else if (runtime.startsWith('nodejs')) color = 'bg-green-500'
  else if (runtime.startsWith('java')) color = 'bg-red-500'
  else if (runtime.startsWith('go')) color = 'bg-cyan-500'
  else if (runtime.startsWith('dotnet')) color = 'bg-purple-500'
  else if (runtime.startsWith('ruby')) color = 'bg-pink-500'
  else if (runtime.startsWith('provided')) color = 'bg-gray-500'

  return (
    <Badge variant="secondary" className={`${color} text-white`}>
      {runtime}
    </Badge>
  )
}

function StateBadge({ state }: { state?: string }) {
  if (!state) return null

  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'secondary'
  let icon = null

  switch (state) {
    case 'Active':
      variant = 'default'
      icon = <CheckCircle className="h-3 w-3" />
      break
    case 'Pending':
      variant = 'secondary'
      icon = <Clock className="h-3 w-3" />
      break
    case 'Failed':
      variant = 'destructive'
      icon = <AlertCircle className="h-3 w-3" />
      break
    case 'Inactive':
      variant = 'outline'
      break
  }

  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {icon}
      {state}
    </Badge>
  )
}

function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, totalItems)

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {start}–{end} of {totalItems}
        </span>
        <Separator orientation="vertical" className="h-4" />
        <span>Rows:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground px-2">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

const EVENT_TEMPLATES = {
  'API Gateway': {
    httpMethod: 'GET',
    path: '/test',
    headers: { 'Content-Type': 'application/json' },
    queryStringParameters: {},
    body: null,
  },
  'S3': {
    Records: [
      {
        eventName: 's3:ObjectCreated:Put',
        s3: {
          bucket: { name: 'test-bucket' },
          object: { key: 'test-key' },
        },
      },
    ],
  },
  'SQS': {
    Records: [
      {
        messageId: 'test-message-id',
        body: JSON.stringify({ test: 'data' }),
        attributes: {},
      },
    ],
  },
  'CloudWatch Events': {
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    time: new Date().toISOString(),
    detail: {},
  },
  'Custom': {},
}

function InvokeSheet({
  functionName,
  open,
  onOpenChange,
}: {
  functionName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [payload, setPayload] = useState(JSON.stringify(EVENT_TEMPLATES['Custom'], null, 2))
  const [template, setTemplate] = useState<keyof typeof EVENT_TEMPLATES>('Custom')
  const [invoking, setInvoking] = useState(false)
  const [result, setResult] = useState<LambdaInvokeResponse | null>(null)

  const handleTemplateChange = (templateName: string) => {
    const key = templateName as keyof typeof EVENT_TEMPLATES
    setTemplate(key)
    setPayload(JSON.stringify(EVENT_TEMPLATES[key], null, 2))
  }

  const handleInvoke = async () => {
    try {
      setInvoking(true)
      setResult(null)
      const parsedPayload = JSON.parse(payload)
      const response = await invokeLambdaFunction(functionName, { payload: parsedPayload })
      setResult(response)
      if (response.functionError) {
        toast.error(`Function error: ${response.functionError}`)
      } else {
        toast.success('Function invoked successfully')
      }
    } catch (error) {
      toast.error(`Invocation failed: ${error}`)
    } finally {
      setInvoking(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Invoke Function
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Event Template</label>
            <Select value={template} onValueChange={handleTemplateChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(EVENT_TEMPLATES).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Payload (JSON)</label>
            <Textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              className="font-mono text-xs h-64"
              placeholder='{"key": "value"}'
            />
          </div>
          <Button onClick={handleInvoke} disabled={invoking} className="w-full">
            <Play className="h-4 w-4 mr-2" />
            {invoking ? 'Invoking...' : 'Invoke'}
          </Button>

          {result && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Badge variant={result.functionError ? 'destructive' : 'default'}>
                  Status: {result.statusCode}
                </Badge>
                {result.functionError && (
                  <Badge variant="destructive">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {result.functionError}
                  </Badge>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Response</label>
                <div className="rounded-md border p-3 bg-muted/50">
                  <JsonViewer data={result.payload} />
                </div>
              </div>
              {result.logs && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Logs (last 4KB)</label>
                  <pre className="rounded-md border p-3 bg-muted/50 text-xs overflow-auto max-h-40 font-mono whitespace-pre-wrap">
                    {result.logs}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function LambdaBrowser() {
  const [searchParams, setSearchParams] = useSearchParams()
  const functionsFetcher = useCallback(() => fetchLambdaFunctions(), [])
  const { data: functionsData, loading: functionsLoading } = useFetch<{ functions: LambdaFunction[] }>(
    functionsFetcher,
    10000
  )

  // Read selected function from URL params
  const selectedFunction = searchParams.get('function')

  // Helper to update URL params
  const setSelectedFunction = (func: string | null) => {
    if (func === null) {
      setSearchParams({})
    } else {
      setSearchParams({ function: func })
    }
  }

  const [functionDetail, setFunctionDetail] = useState<LambdaFunctionDetail | null>(null)
  const [eventSources, setEventSources] = useState<LambdaEventSourceMapping[]>([])
  const [aliases, setAliases] = useState<LambdaAlias[]>([])
  const [versions, setVersions] = useState<LambdaVersion[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [invokeSheetOpen, setInvokeSheetOpen] = useState(false)

  useEffect(() => {
    if (!selectedFunction) {
      setFunctionDetail(null)
      setEventSources([])
      setAliases([])
      setVersions([])
      return
    }
    Promise.all([
      fetchLambdaFunction(selectedFunction),
      fetchLambdaEventSources(selectedFunction).catch(() => ({ eventSourceMappings: [] })),
      fetchLambdaAliases(selectedFunction).catch(() => ({ aliases: [] })),
      fetchLambdaVersions(selectedFunction).catch(() => ({ versions: [] })),
    ])
      .then(([detail, sources, aliasData, versionData]) => {
        setFunctionDetail(detail)
        setEventSources(sources.eventSourceMappings)
        setAliases(aliasData.aliases)
        setVersions(versionData.versions)
      })
      .catch(() => {
        setFunctionDetail(null)
        setEventSources([])
        setAliases([])
        setVersions([])
      })
  }, [selectedFunction])

  const functions = functionsData?.functions ?? []
  const filteredFunctions = functions.filter((f) =>
    f.FunctionName.toLowerCase().includes(search.toLowerCase())
  )
  const totalPages = Math.ceil(filteredFunctions.length / pageSize)
  const paginatedFunctions = filteredFunctions.slice(page * pageSize, (page + 1) * pageSize)

  if (functionsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    )
  }

  if (!functionsData || functions.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="No Lambda Functions"
        description="No Lambda functions found in this environment."
      />
    )
  }

  if (selectedFunction && functionDetail) {
    const config = functionDetail.configuration
    const hasVpc = config.VpcConfig && config.VpcConfig.VpcId
    const hasEnvVars = config.Environment?.Variables && Object.keys(config.Environment.Variables).length > 0
    const hasLayers = config.Layers && config.Layers.length > 0
    const tags = functionDetail.tags || {}
    const hasTags = Object.keys(tags).length > 0

    return (
      <div className="space-y-4">
        <Breadcrumb segments={[
          createHomeSegment(),
          { label: 'Lambda', href: '/resources/lambda', icon: Zap },
          { label: config.FunctionName },
        ]} />

        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <Zap className="h-6 w-6" />
              {config.FunctionName}
            </h2>
            {config.Description && <p className="text-sm text-muted-foreground mt-1">{config.Description}</p>}
          </div>
          <Button onClick={() => setInvokeSheetOpen(true)}>
            <Play className="h-4 w-4 mr-2" />
            Invoke
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <RuntimeBadge runtime={config.Runtime} />
          <StateBadge state={config.State} />
          {config.PackageType && (
            <Badge variant="outline">{config.PackageType === 'Image' ? 'Container Image' : 'ZIP'}</Badge>
          )}
        </div>

        <Tabs defaultValue="config" className="w-full">
          <TabsList>
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="versions">Aliases & Versions</TabsTrigger>
            <TabsTrigger value="events">Event Sources</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Basic Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="text-muted-foreground">Runtime</div>
                  <div className="font-mono">{config.Runtime}</div>
                  <div className="text-muted-foreground">Handler</div>
                  <div className="font-mono">{config.Handler}</div>
                  <div className="text-muted-foreground">Memory</div>
                  <div>{config.MemorySize} MB</div>
                  <div className="text-muted-foreground">Timeout</div>
                  <div>{config.Timeout} seconds</div>
                  <div className="text-muted-foreground">Code Size</div>
                  <div>{formatBytes(config.CodeSize)}</div>
                  <div className="text-muted-foreground">Last Modified</div>
                  <div>{formatDate(config.LastModified)}</div>
                  <div className="text-muted-foreground">Architectures</div>
                  <div>{config.Architectures?.join(', ') || 'x86_64'}</div>
                  <div className="text-muted-foreground">IAM Role</div>
                  <div className="font-mono text-xs break-all">{config.Role}</div>
                </div>
              </CardContent>
            </Card>

            {hasEnvVars && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Environment Variables</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    {Object.entries(config.Environment?.Variables || {}).map(([key, value]) => (
                      <div key={key} className="grid grid-cols-2 gap-4 py-1 border-b last:border-0">
                        <div className="font-mono text-xs text-muted-foreground">{key}</div>
                        <div className="font-mono text-xs break-all">{value}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {hasLayers && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Layers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {config.Layers?.map((layer, idx) => (
                      <div key={idx} className="text-sm space-y-1">
                        <div className="font-mono text-xs">{layer.Arn}</div>
                        <div className="text-xs text-muted-foreground">Size: {formatBytes(layer.CodeSize)}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {hasVpc && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">VPC Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-muted-foreground">VPC ID</div>
                    <div className="font-mono text-xs">{config.VpcConfig?.VpcId}</div>
                    <div className="text-muted-foreground">Subnets</div>
                    <div className="font-mono text-xs">{config.VpcConfig?.SubnetIds?.join(', ')}</div>
                    <div className="text-muted-foreground">Security Groups</div>
                    <div className="font-mono text-xs">{config.VpcConfig?.SecurityGroupIds?.join(', ')}</div>
                  </div>
                </CardContent>
              </Card>
            )}

            {config.LoggingConfig?.LogGroup && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Logging</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Log Group:</span>
                    <code className="text-xs font-mono">{config.LoggingConfig.LogGroup}</code>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="code" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Deployment Package</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="text-muted-foreground">Package Type</div>
                  <div>{config.PackageType || 'Zip'}</div>
                  <div className="text-muted-foreground">Code SHA256</div>
                  <div className="font-mono text-xs break-all">{config.CodeSha256}</div>
                  <div className="text-muted-foreground">Code Size</div>
                  <div>{formatBytes(config.CodeSize)}</div>
                </div>
                {config.PackageType !== 'Image' && functionDetail.code.Location && (
                  <div className="pt-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={getLambdaCodeDownloadUrl(config.FunctionName)} download>
                        <Download className="h-4 w-4 mr-2" />
                        Download Deployment Package
                      </a>
                    </Button>
                  </div>
                )}
                {config.PackageType === 'Image' && (
                  <div className="pt-2 text-sm text-muted-foreground">
                    Code download is not available for container image functions.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="versions" className="space-y-4">
            {aliases.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Aliases</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aliases.map((alias) => (
                        <TableRow key={alias.AliasArn}>
                          <TableCell className="font-mono text-xs">{alias.Name}</TableCell>
                          <TableCell>{alias.FunctionVersion}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{alias.Description || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {versions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Versions</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Code SHA256</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Last Modified</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.map((version) => (
                        <TableRow key={version.FunctionArn}>
                          <TableCell className="font-mono">{version.Version}</TableCell>
                          <TableCell className="font-mono text-xs">{version.CodeSha256.slice(0, 16)}...</TableCell>
                          <TableCell>{formatBytes(version.CodeSize)}</TableCell>
                          <TableCell className="text-xs">{formatDate(version.LastModified)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {aliases.length === 0 && versions.length === 0 && (
              <EmptyState
                icon={GitBranch}
                title="No Aliases or Versions"
                description="This function has no aliases or published versions."
              />
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-4">
            {eventSources.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Event Source Mappings</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event Source</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Batch Size</TableHead>
                        <TableHead>Last Modified</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventSources.map((mapping) => (
                        <TableRow key={mapping.UUID}>
                          <TableCell className="font-mono text-xs max-w-xs truncate">
                            {mapping.EventSourceArn}
                          </TableCell>
                          <TableCell>
                            <Badge variant={mapping.State === 'Enabled' ? 'default' : 'secondary'}>
                              {mapping.State}
                            </Badge>
                          </TableCell>
                          <TableCell>{mapping.BatchSize || '—'}</TableCell>
                          <TableCell className="text-xs">{formatDate(mapping.LastModified)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={LinkIcon}
                title="No Event Sources"
                description="This function has no event source mappings configured."
              />
            )}
          </TabsContent>

          <TabsContent value="tags" className="space-y-4">
            {hasTags ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Tags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(tags).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="text-xs">
                        <TagIcon className="h-3 w-3 mr-1" />
                        {key}: {value}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <EmptyState icon={TagIcon} title="No Tags" description="This function has no tags." />
            )}
          </TabsContent>
        </Tabs>

        <InvokeSheet functionName={config.FunctionName} open={invokeSheetOpen} onOpenChange={setInvokeSheetOpen} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Breadcrumb segments={[createHomeSegment(), { label: 'Lambda', icon: Zap }]} />
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search functions..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {paginatedFunctions.map((func) => (
          <Card
            key={func.FunctionName}
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => setSelectedFunction(func.FunctionName)}
          >
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4" />
                {func.FunctionName}
              </CardTitle>
              {func.Description && <CardDescription className="text-xs">{func.Description}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <RuntimeBadge runtime={func.Runtime} />
                <StateBadge state={func.State} />
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Handler</span>
                  <span className="font-mono">{func.Handler}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Memory</span>
                  <span>{func.MemorySize} MB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Timeout</span>
                  <span>{func.Timeout}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Code Size</span>
                  <span>{formatBytes(func.CodeSize)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last Modified</span>
                  <span>{formatDate(func.LastModified)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={filteredFunctions.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(0)
          }}
        />
      )}
    </div>
  )
}
