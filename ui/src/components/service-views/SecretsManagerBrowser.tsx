import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import { fetchSecrets, fetchSecretDetail } from '@/lib/api'
import type { Secret, SecretDetail } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { ExportDropdown } from '@/components/ExportDropdown'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  KeyRound,
  Search,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Tag as TagIcon,
} from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSecretValue(value: string): { formatted: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(value)
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true }
  } catch {
    return { formatted: value, isJson: false }
  }
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

function SecretValueDisplay({ detail }: { detail: SecretDetail }) {
  const [visible, setVisible] = useState(false)

  const hasValue = detail.secretValue !== null
  const hasBinary = detail.secretBinary !== null

  if (!hasValue && !hasBinary) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Secret value is not available (secret may be pending deletion).
      </div>
    )
  }

  const copyToClipboard = () => {
    const text = detail.secretValue ?? detail.secretBinary ?? ''
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Failed to copy')
    )
  }

  if (hasBinary) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Binary</Badge>
          <Button variant="ghost" size="sm" className="h-7" onClick={copyToClipboard}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copy Base64
          </Button>
        </div>
        {visible ? (
          <>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setVisible(false)}>
              <EyeOff className="h-3.5 w-3.5 mr-1" />
              Hide
            </Button>
            <pre className="rounded-md border p-3 bg-muted/50 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">
              {detail.secretBinary}
            </pre>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setVisible(true)}>
            <Eye className="h-3.5 w-3.5 mr-1" />
            Show value
          </Button>
        )}
      </div>
    )
  }

  const { formatted, isJson } = formatSecretValue(detail.secretValue!)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {isJson && <Badge variant="secondary">JSON</Badge>}
        <Button variant="ghost" size="sm" className="h-7" onClick={copyToClipboard}>
          <Copy className="h-3.5 w-3.5 mr-1" />
          Copy
        </Button>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => setVisible(!visible)}>
          {visible ? (
            <>
              <EyeOff className="h-3.5 w-3.5 mr-1" />
              Hide
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5 mr-1" />
              Show
            </>
          )}
        </Button>
      </div>
      {visible ? (
        <pre className="rounded-md border p-3 bg-muted/50 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">
          {formatted}
        </pre>
      ) : (
        <div className="rounded-md border p-3 bg-muted/50 text-sm text-muted-foreground">
          ••••••••••••••••
        </div>
      )}
    </div>
  )
}

export function SecretsManagerBrowser() {
  const [searchParams, setSearchParams] = useSearchParams()
  const secretsFetcher = useCallback(() => fetchSecrets(), [])
  const { data: secretsData, loading: secretsLoading, refresh: refreshSecrets } = useFetch<{ secrets: Secret[] }>(
    secretsFetcher,
    10000
  )

  const selectedSecret = searchParams.get('secret')

  const setSelectedSecret = (name: string | null) => {
    if (name === null) {
      setSearchParams({})
    } else {
      setSearchParams({ secret: name })
    }
  }

  const [secretDetail, setSecretDetail] = useState<SecretDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [refreshing, setRefreshing] = useState(false)

  const loadSecretDetail = useCallback((secretName: string | null) => {
    if (!secretName) {
      setSecretDetail(null)
      return
    }
    setDetailLoading(true)
    fetchSecretDetail(secretName)
      .then(setSecretDetail)
      .catch(() => {
        setSecretDetail(null)
        toast.error('Failed to load secret detail')
      })
      .finally(() => setDetailLoading(false))
  }, [])

  useEffect(() => {
    loadSecretDetail(selectedSecret)
  }, [selectedSecret, loadSecretDetail])

  const refreshDetail = () => {
    loadSecretDetail(selectedSecret)
  }

  const secrets = secretsData?.secrets ?? []
  const filteredSecrets = secrets.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  )
  const totalPages = Math.ceil(filteredSecrets.length / pageSize)
  const paginatedSecrets = filteredSecrets.slice(page * pageSize, (page + 1) * pageSize)

  if (secretsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!secretsData || secrets.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No Secrets"
        description="No secrets found in Secrets Manager."
      />
    )
  }

  if (selectedSecret && (secretDetail || detailLoading)) {
    if (detailLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      )
    }

    if (!secretDetail) return null

    const tags = secretDetail.tags || {}
    const hasTags = Object.keys(tags).length > 0

    return (
      <div className="space-y-4">
        <Breadcrumb
          segments={[
            createHomeSegment(),
            {
              label: 'Secrets Manager',
              href: '/resources/secretsmanager',
              icon: getServiceIcon('secretsmanager'),
            },
            { label: secretDetail.name },
          ]}
        />

        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <KeyRound className="h-6 w-6" />
              {secretDetail.name}
            </h2>
            {secretDetail.description && (
              <p className="text-sm text-muted-foreground mt-1">{secretDetail.description}</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={refreshDetail}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {secretDetail.rotationEnabled && <Badge variant="default">Rotation Enabled</Badge>}
          {secretDetail.deletedDate && <Badge variant="destructive">Pending Deletion</Badge>}
          {secretDetail.versionStages?.map((stage) => (
            <Badge key={stage} variant="outline">
              {stage}
            </Badge>
          ))}
        </div>

        <Tabs defaultValue="value" className="w-full">
          <TabsList>
            <TabsTrigger value="value">Secret Value</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
          </TabsList>

          <TabsContent value="value" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Secret Value</CardTitle>
              </CardHeader>
              <CardContent>
                <SecretValueDisplay detail={secretDetail} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="text-muted-foreground">ARN</div>
                  <div className="font-mono text-xs break-all">{secretDetail.arn}</div>
                  <div className="text-muted-foreground">Created</div>
                  <div>{formatDate(secretDetail.createdDate)}</div>
                  <div className="text-muted-foreground">Last Changed</div>
                  <div>{formatDate(secretDetail.lastChangedDate)}</div>
                  <div className="text-muted-foreground">Last Accessed</div>
                  <div>{formatDate(secretDetail.lastAccessedDate)}</div>
                  {secretDetail.versionId && (
                    <>
                      <div className="text-muted-foreground">Version ID</div>
                      <div className="font-mono text-xs break-all">{secretDetail.versionId}</div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {secretDetail.rotationEnabled && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Rotation Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-muted-foreground">Rotation Enabled</div>
                    <div>Yes</div>
                    {secretDetail.rotationLambdaARN && (
                      <>
                        <div className="text-muted-foreground">Lambda ARN</div>
                        <div className="font-mono text-xs break-all">
                          {secretDetail.rotationLambdaARN}
                        </div>
                      </>
                    )}
                    {secretDetail.rotationRules?.AutomaticallyAfterDays && (
                      <>
                        <div className="text-muted-foreground">Rotation Interval</div>
                        <div>Every {secretDetail.rotationRules.AutomaticallyAfterDays} days</div>
                      </>
                    )}
                    {secretDetail.rotationRules?.ScheduleExpression && (
                      <>
                        <div className="text-muted-foreground">Schedule</div>
                        <div className="font-mono text-xs">
                          {secretDetail.rotationRules.ScheduleExpression}
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
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
              <EmptyState icon={TagIcon} title="No Tags" description="This secret has no tags." />
            )}
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Breadcrumb
        segments={[
          createHomeSegment(),
          { label: 'Secrets Manager', icon: getServiceIcon('secretsmanager') },
        ]}
      />
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search secrets..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>
        {filteredSecrets.length > 0 && (
          <ExportDropdown
            service="secretsmanager"
            resourceType="secrets"
            data={filteredSecrets as unknown as Record<string, unknown>[]}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={async () => { setRefreshing(true); await refreshSecrets(); setRefreshing(false) }}
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Last Changed</TableHead>
              <TableHead>Rotation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedSecrets.map((secret) => (
              <TableRow
                key={secret.name}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => setSelectedSecret(secret.name)}
              >
                <TableCell className="font-mono text-xs">{secret.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                  {secret.description || '—'}
                </TableCell>
                <TableCell className="text-xs">{formatDate(secret.lastChangedDate)}</TableCell>
                <TableCell>
                  {secret.rotationEnabled ? (
                    <Badge variant="default" className="text-xs">
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Enabled
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Disabled</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={filteredSecrets.length}
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
