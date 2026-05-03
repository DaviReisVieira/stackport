import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchSecrets,
  fetchSecretDetail,
  updateResourceTags,
  createSecret,
  updateSecretValue,
  updateSecretMetadata,
  deleteSecret,
  restoreSecret,
} from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import type { Secret, SecretDetail } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/EmptyState'
import { ExportDropdown } from '@/components/ExportDropdown'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { TagsSection, TagCountBadge } from '@/components/TagsSection'
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
  Plus,
  Edit,
  Trash2,
  FileText,
  RotateCcw,
  Files,
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

function ValueEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [mode, setMode] = useState<'text' | 'json'>('text')
  const [error, setError] = useState<string | null>(null)

  const handleChange = (newValue: string) => {
    onChange(newValue)
    if (mode === 'json') {
      try {
        JSON.parse(newValue)
        setError(null)
      } catch {
        setError('Invalid JSON')
      }
    } else {
      setError(null)
    }
  }

  const toggleMode = () => {
    if (mode === 'text') {
      try {
        const parsed = JSON.parse(value)
        onChange(JSON.stringify(parsed, null, 2))
        setMode('json')
        setError(null)
      } catch {
        setError('Cannot format as JSON - invalid syntax')
      }
    } else {
      try {
        const parsed = JSON.parse(value)
        onChange(JSON.stringify(parsed))
        setMode('text')
        setError(null)
      } catch {
        setError('Invalid JSON - fix errors before switching to text mode')
      }
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Secret Value</Label>
        <Button variant="outline" size="sm" onClick={toggleMode}>
          {mode === 'text' ? 'Format as JSON' : 'Plain Text'}
        </Button>
      </div>
      <Textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Enter secret value..."
        className="font-mono text-xs min-h-[200px]"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function TagsEditor({
  tags,
  onChange,
}: {
  tags: Record<string, string>
  onChange: (tags: Record<string, string>) => void
}) {
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const addTag = () => {
    const key = newKey.trim()
    if (!key) {
      toast.error('Tag key is required')
      return
    }
    onChange({ ...tags, [key]: newValue.trim() })
    setNewKey('')
    setNewValue('')
  }

  const removeTag = (key: string) => {
    const updated = { ...tags }
    delete updated[key]
    onChange(updated)
  }

  const updateTag = (key: string, value: string) => {
    onChange({ ...tags, [key]: value })
  }

  return (
    <div className="space-y-3">
      <Label>Tags</Label>
      {Object.keys(tags).length > 0 && (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(tags).map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell>
                    <Input
                      value={value}
                      onChange={(e) => updateTag(key, e.target.value)}
                      className="h-7 text-xs font-mono"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => removeTag(key)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Key"
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTag()
          }}
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTag()
          }}
        />
        <Button size="sm" onClick={addTag} className="h-8">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
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
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const secretsFetcher = useCallback(() => fetchSecrets(activeEndpoint), [activeEndpoint])
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

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editValueDialogOpen, setEditValueDialogOpen] = useState(false)
  const [editMetadataDialogOpen, setEditMetadataDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)

  // Form states
  const [newSecretName, setNewSecretName] = useState('')
  const [newSecretDescription, setNewSecretDescription] = useState('')
  const [newSecretValue, setNewSecretValue] = useState('')
  const [newSecretTags, setNewSecretTags] = useState<Record<string, string>>({})
  const [editSecretValue, setEditSecretValue] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTags, setEditTags] = useState<Record<string, string>>({})
  const [forceDelete, setForceDelete] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadSecretDetail = useCallback((secretName: string | null) => {
    if (!secretName) {
      setSecretDetail(null)
      return
    }
    setDetailLoading(true)
    fetchSecretDetail(secretName, activeEndpoint)
      .then(setSecretDetail)
      .catch(() => {
        setSecretDetail(null)
        toast.error('Failed to load secret detail')
      })
      .finally(() => setDetailLoading(false))
  }, [activeEndpoint])

  useEffect(() => {
    loadSecretDetail(selectedSecret)
  }, [selectedSecret, loadSecretDetail])

  const refreshDetail = () => {
    loadSecretDetail(selectedSecret)
  }

  const handleCreateSecret = async () => {
    if (!newSecretName.trim()) {
      toast.error('Secret name is required')
      return
    }
    if (!newSecretValue.trim()) {
      toast.error('Secret value is required')
      return
    }

    try {
      setSubmitting(true)
      await createSecret(
        {
          name: newSecretName.trim(),
          description: newSecretDescription.trim() || undefined,
          secretString: newSecretValue,
          tags: Object.keys(newSecretTags).length > 0 ? newSecretTags : undefined,
        },
        activeEndpoint
      )
      toast.success(`Secret created: ${newSecretName}`)
      setCreateDialogOpen(false)
      setNewSecretName('')
      setNewSecretDescription('')
      setNewSecretValue('')
      setNewSecretTags({})
      refreshSecrets()
    } catch (error) {
      toast.error(`Failed to create secret: ${error}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateValue = async () => {
    if (!secretDetail) return
    if (!editSecretValue.trim()) {
      toast.error('Secret value is required')
      return
    }

    try {
      setSubmitting(true)
      await updateSecretValue(secretDetail.name, { secretString: editSecretValue }, activeEndpoint)
      toast.success('Secret value updated')
      setEditValueDialogOpen(false)
      refreshDetail()
      refreshSecrets()
    } catch (error) {
      toast.error(`Failed to update value: ${error}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateMetadata = async () => {
    if (!secretDetail) return

    try {
      setSubmitting(true)
      await updateSecretMetadata(
        secretDetail.name,
        {
          description: editDescription,
          tags: editTags,
        },
        activeEndpoint
      )
      toast.success('Metadata updated')
      setEditMetadataDialogOpen(false)
      refreshDetail()
      refreshSecrets()
    } catch (error) {
      toast.error(`Failed to update metadata: ${error}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!secretDetail) return

    try {
      setSubmitting(true)
      await deleteSecret(secretDetail.name, forceDelete, activeEndpoint)
      toast.success(forceDelete ? 'Secret deleted immediately' : 'Secret scheduled for deletion')
      setDeleteDialogOpen(false)
      setForceDelete(false)
      setSelectedSecret(null)
      refreshSecrets()
    } catch (error) {
      toast.error(`Failed to delete secret: ${error}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestore = async () => {
    if (!secretDetail) return

    try {
      setSubmitting(true)
      await restoreSecret(secretDetail.name, activeEndpoint)
      toast.success('Secret restored')
      refreshDetail()
      refreshSecrets()
    } catch (error) {
      toast.error(`Failed to restore secret: ${error}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDuplicate = async () => {
    if (!newSecretName.trim()) {
      toast.error('Secret name is required')
      return
    }
    if (!newSecretValue.trim()) {
      toast.error('Secret value is required')
      return
    }

    try {
      setSubmitting(true)
      await createSecret(
        {
          name: newSecretName.trim(),
          description: newSecretDescription.trim() || undefined,
          secretString: newSecretValue,
          tags: Object.keys(newSecretTags).length > 0 ? newSecretTags : undefined,
        },
        activeEndpoint
      )
      toast.success(`Secret duplicated: ${newSecretName}`)
      setDuplicateDialogOpen(false)
      setNewSecretName('')
      setNewSecretDescription('')
      setNewSecretValue('')
      setNewSecretTags({})
      refreshSecrets()
    } catch (error) {
      toast.error(`Failed to duplicate secret: ${error}`)
    } finally {
      setSubmitting(false)
    }
  }

  const openEditValueDialog = () => {
    if (!secretDetail) return
    setEditSecretValue(secretDetail.secretValue || '')
    setEditValueDialogOpen(true)
  }

  const openEditMetadataDialog = () => {
    if (!secretDetail) return
    setEditDescription(secretDetail.description || '')
    setEditTags({ ...secretDetail.tags })
    setEditMetadataDialogOpen(true)
  }

  const openDuplicateDialog = () => {
    if (!secretDetail) return
    setNewSecretName('')
    setNewSecretDescription(secretDetail.description || '')
    setNewSecretValue(secretDetail.secretValue || '')
    setNewSecretTags({ ...secretDetail.tags })
    setDuplicateDialogOpen(true)
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
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!secretsData || secrets.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={KeyRound}
          title="No Secrets"
          description="No secrets found in Secrets Manager."
        />
      </div>
    )
  }

  const renderDetailView = () => {
    if (detailLoading) {
      return (
        <div className="space-y-6 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      )
    }

    if (!secretDetail) return null

    const tags = secretDetail.tags || {}

    return (
      <div className="space-y-6 p-6">
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
          <div className="flex gap-2">
            {secretDetail.deletedDate ? (
              <Button variant="default" size="sm" onClick={handleRestore} disabled={submitting}>
                <RotateCcw className="h-4 w-4 mr-2" />
                {submitting ? 'Restoring...' : 'Restore'}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={openDuplicateDialog}>
                  <Files className="h-4 w-4 mr-2" />
                  Duplicate
                </Button>
                <Button variant="outline" size="sm" onClick={openEditValueDialog}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Value
                </Button>
                <Button variant="outline" size="sm" onClick={openEditMetadataDialog}>
                  <FileText className="h-4 w-4 mr-2" />
                  Edit Metadata
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={refreshDetail}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
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
            <TagsSection
              tags={tags}
              onSave={async (newTags) => {
                await updateResourceTags('secretsmanager', 'secrets', secretDetail.name, newTags, activeEndpoint)
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  const renderListView = () => (
    <div className="space-y-6 p-6">
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
        <Button variant="default" size="sm" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Secret
        </Button>
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
              <TableHead>Tags</TableHead>
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
                <TableCell>
                  <TagCountBadge count={Object.keys(secret.tags || {}).length} />
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

  return (
    <>
      {selectedSecret && (secretDetail || detailLoading)
        ? renderDetailView()
        : renderListView()}

      {/* Create Secret Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Secret</DialogTitle>
            <DialogDescription>Create a new secret in Secrets Manager</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name *</Label>
              <Input
                id="create-name"
                value={newSecretName}
                onChange={(e) => setNewSecretName(e.target.value)}
                placeholder="my-secret-name"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-description">Description</Label>
              <Input
                id="create-description"
                value={newSecretDescription}
                onChange={(e) => setNewSecretDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <ValueEditor value={newSecretValue} onChange={setNewSecretValue} />
            <TagsEditor tags={newSecretTags} onChange={setNewSecretTags} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleCreateSecret} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Secret'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Value Dialog */}
      <Dialog open={editValueDialogOpen} onOpenChange={setEditValueDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Secret Value</DialogTitle>
            <DialogDescription>Update the value of {secretDetail?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <ValueEditor value={editSecretValue} onChange={setEditSecretValue} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditValueDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleUpdateValue} disabled={submitting}>
              {submitting ? 'Updating...' : 'Update Value'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Metadata Dialog */}
      <Dialog open={editMetadataDialogOpen} onOpenChange={setEditMetadataDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Metadata</DialogTitle>
            <DialogDescription>Update description and tags for {secretDetail?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <TagsEditor tags={editTags} onChange={setEditTags} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMetadataDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleUpdateMetadata} disabled={submitting}>
              {submitting ? 'Updating...' : 'Update Metadata'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Secret</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {secretDetail?.name}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="force-delete"
                checked={forceDelete}
                onCheckedChange={(checked) => setForceDelete(checked === true)}
              />
              <Label htmlFor="force-delete" className="text-sm cursor-pointer">
                Force delete immediately (cannot be recovered)
              </Label>
            </div>
            {!forceDelete && (
              <p className="text-xs text-muted-foreground mt-2">
                Without force delete, the secret will be scheduled for deletion in 7 days and can be restored.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? 'Deleting...' : 'Delete Secret'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Duplicate Secret</DialogTitle>
            <DialogDescription>Create a copy of {secretDetail?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="duplicate-name">Name *</Label>
              <Input
                id="duplicate-name"
                value={newSecretName}
                onChange={(e) => setNewSecretName(e.target.value)}
                placeholder="new-secret-name"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duplicate-description">Description</Label>
              <Input
                id="duplicate-description"
                value={newSecretDescription}
                onChange={(e) => setNewSecretDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <ValueEditor value={newSecretValue} onChange={setNewSecretValue} />
            <TagsEditor tags={newSecretTags} onChange={setNewSecretTags} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleDuplicate} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Copy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
