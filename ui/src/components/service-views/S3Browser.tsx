import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  fetchS3Buckets,
  fetchS3Objects,
  fetchS3Object,
  getS3DownloadUrl,
  uploadS3Object,
  deleteS3Object,
  deleteS3ObjectsBatch,
  createS3Folder,
  fetchS3UploadConfig,
  fetchResourceTags,
  updateResourceTags,
} from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import type { S3Bucket, S3File, S3ObjectsResponse, S3ObjectDetail } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import { S3BucketSettings } from '@/components/service-views/s3/S3BucketSettings'
import { ExportDropdown } from '@/components/ExportDropdown'
import { JsonViewer } from '@/components/JsonViewer'
import { Breadcrumb, createHomeSegment, type BreadcrumbSegment } from '@/components/Breadcrumb'
import { getServiceIcon } from '@/lib/service-icons'
import { toast } from 'sonner'
import { useFetch } from '@/hooks/useFetch'
import { TagsSection, TagCountBadge } from '@/components/TagsSection'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { Input } from '@/components/ui/input'
import {
  HardDrive,
  Folder,
  File,
  FileText,
  FileImage,
  FileCode,
  FileArchive,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  Clock,
  Globe,
  Lock,
  Shield,
  Download,
  Search,
  RefreshCw,
  Upload,
  Trash2,
  FolderPlus,
  Settings,
} from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

function isFileDrag(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types
  if (!types) return false
  return Array.from(types as unknown as Iterable<string>).includes('Files')
}


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

function getFileIcon(contentType: string, name: string) {
  if (contentType.startsWith('image/')) return FileImage
  if (contentType.startsWith('text/')) return FileText
  if (contentType.includes('json') || contentType.includes('xml') || contentType.includes('javascript') || contentType.includes('yaml')) return FileCode
  if (contentType.includes('zip') || contentType.includes('tar') || contentType.includes('gzip') || contentType.includes('compressed')) return FileArchive
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) return FileImage
  if (ext && ['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'rb', 'sh', 'css', 'html', 'yml', 'toml'].includes(ext)) return FileCode
  if (ext && ['zip', 'tar', 'gz', 'bz2', 'rar', '7z', 'jar', 'whl'].includes(ext)) return FileArchive
  if (ext && ['md', 'txt', 'csv', 'log', 'ini', 'cfg', 'conf'].includes(ext)) return FileText
  return File
}

function PaginationBar({
  page, totalPages, totalItems, pageSize, onPageChange, onPageSizeChange,
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
        <span>{start}–{end} of {totalItems}</span>
        <Separator orientation="vertical" className="h-4" />
        <span>Rows:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">{size}</SelectItem>
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

type ConfirmDialog =
  | { type: 'delete-file'; key: string }
  | { type: 'delete-bulk' }
  | { type: 'delete-folder'; folderPrefix: string }

export function S3Browser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const bucketsFetcher = useCallback(() => fetchS3Buckets(activeEndpoint), [activeEndpoint])
  const { data: bucketsData, loading: bucketsLoading, refresh: refreshBuckets } = useFetch<{ buckets: S3Bucket[] }>(bucketsFetcher, 10000)
  const [refreshing, setRefreshing] = useState(false)

  // Read bucket and prefix from URL params
  const selectedBucket = searchParams.get('bucket')
  const prefix = searchParams.get('prefix') || ''

  const [objectsData, setObjectsData] = useState<S3ObjectsResponse | null>(null)
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [objectDetail, setObjectDetail] = useState<S3ObjectDetail | null>(null)
  const [bucketSearch, setBucketSearch] = useState('')
  const [fileSearch, setFileSearch] = useState('')
  const [bucketPage, setBucketPage] = useState(0)
  const [filePage, setFilePage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const bucketSearchRef = useRef<HTMLInputElement>(null)
  const fileSearchRef = useRef<HTMLInputElement>(null)
  const fileUploadRef = useRef<HTMLInputElement>(null)

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [fileDragActive, setFileDragActive] = useState(false)
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number } | null>(null)
  const uploadAbortRef = useRef<(() => void) | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [newFolderSegment, setNewFolderSegment] = useState('')
  const [bucketTags, setBucketTags] = useState<Record<string, string>>({})


  // Fetch bucket tags when selectedBucket changes
  useEffect(() => {
    if (!selectedBucket) {
      setBucketTags({})
      return
    }
    fetchResourceTags('s3', 'buckets', selectedBucket, activeEndpoint)
      .then(res => setBucketTags(res.tags))
      .catch(() => setBucketTags({}))
  }, [selectedBucket, activeEndpoint])


  // Helper to update URL params
  const setSelectedBucket = (bucket: string | null) => {
    if (bucket === null) {
      setSearchParams({})
    } else {
      setSearchParams({ bucket })
    }
  }

  const setPrefix = (newPrefix: string) => {
    if (selectedBucket) {
      const params: Record<string, string> = { bucket: selectedBucket }
      if (newPrefix) params.prefix = newPrefix
      setSearchParams(params)
    }
  }

  // Keyboard shortcuts
  useKeyboardShortcuts(
    [
      { key: 'Backspace', handler: () => {
        if (selectedBucket && prefix) navigateUp()
      }},
      { key: 'Escape', handler: () => {
        if (objectDetail) setObjectDetail(null)
      }},
      { key: '/', handler: () => {
        if (selectedBucket) fileSearchRef.current?.focus()
        else bucketSearchRef.current?.focus()
      }},
    ],
    []
  )

  const loadObjects = useCallback(async () => {
    if (!selectedBucket) {
      setObjectsData(null)
      return
    }
    setLoadingObjects(true)
    try {
      const data = await fetchS3Objects(selectedBucket, prefix, '/', activeEndpoint)
      setObjectsData(data)
    } catch {
      setObjectsData(null)
    } finally {
      setLoadingObjects(false)
    }
  }, [selectedBucket, prefix, activeEndpoint])

  useEffect(() => {
    void loadObjects()
  }, [loadObjects])

  useEffect(() => {
    let cancelled = false
    void fetchS3UploadConfig()
      .then((c) => {
        if (!cancelled) setMaxUploadBytes(c.max_upload_bytes)
      })
      .catch(() => {
        if (!cancelled) setMaxUploadBytes(100 * 1024 * 1024)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSelectedKeys(new Set())
  }, [selectedBucket, prefix])

  const openObject = async (bucket: string, key: string) => {
    try {
      const data = await fetchS3Object(bucket, key, activeEndpoint)
      setObjectDetail(data)
    } catch {
      setObjectDetail(null)
    }
  }

  const navigateToFolder = (folderPrefix: string) => {
    setPrefix(folderPrefix)
    setFileSearch('')
    setFilePage(0)
  }

  const navigateUp = () => {
    const parts = prefix.replace(/\/$/, '').split('/')
    parts.pop()
    setPrefix(parts.length > 0 ? parts.join('/') + '/' : '')
    setFileSearch('')
    setFilePage(0)
  }

  // Build breadcrumb segments from current state
  const breadcrumbSegments: BreadcrumbSegment[] = useMemo(() => {
    if (!selectedBucket) return []

    const segments: BreadcrumbSegment[] = [
      createHomeSegment(),
      { label: 'S3', href: '/resources/s3' },
      { label: selectedBucket, href: `/resources/s3?bucket=${selectedBucket}` },
    ]

    if (prefix) {
      const folders = prefix.replace(/\/$/, '').split('/')
      folders.forEach((folder, idx) => {
        const folderPrefix = folders.slice(0, idx + 1).join('/') + '/'
        segments.push({
          label: folder,
          href: `/resources/s3?bucket=${selectedBucket}&prefix=${encodeURIComponent(folderPrefix)}`,
        })
      })
    }

    return segments
  }, [selectedBucket, prefix])

  const buckets = bucketsData?.buckets ?? []
  const filteredBuckets = bucketSearch
    ? buckets.filter((b) => b.name.toLowerCase().includes(bucketSearch.toLowerCase()))
    : buckets

  const filteredFolders = useMemo(
    () =>
      fileSearch && objectsData
        ? objectsData.folders.filter((f) => f.slice(prefix.length).toLowerCase().includes(fileSearch.toLowerCase()))
        : objectsData?.folders ?? [],
    [fileSearch, objectsData, prefix]
  )

  const filteredFiles = useMemo(
    () =>
      fileSearch && objectsData
        ? objectsData.files.filter((f) => f.name.toLowerCase().includes(fileSearch.toLowerCase()))
        : objectsData?.files ?? [],
    [fileSearch, objectsData]
  )

  // Paginate buckets
  const bucketTotalPages = Math.max(1, Math.ceil(filteredBuckets.length / pageSize))
  const paginatedBuckets = useMemo(
    () => filteredBuckets.slice(bucketPage * pageSize, (bucketPage + 1) * pageSize),
    [filteredBuckets, bucketPage, pageSize],
  )

  // Paginate files — combine folders + files into a single list for pagination
  const allItems = useMemo(() => {
    const items: ({ type: 'folder'; folder: string } | { type: 'file'; file: S3File })[] = []
    for (const f of filteredFolders) items.push({ type: 'folder', folder: f })
    for (const f of filteredFiles) items.push({ type: 'file', file: f })
    return items
  }, [filteredFolders, filteredFiles])
  const fileTotalPages = Math.max(1, Math.ceil(allItems.length / pageSize))
  const paginatedItems = useMemo(
    () => allItems.slice(filePage * pageSize, (filePage + 1) * pageSize),
    [allItems, filePage, pageSize],
  )

  const pageFileKeys = useMemo(
    () =>
      paginatedItems
        .filter((i): i is { type: 'file'; file: S3File } => i.type === 'file')
        .map((i) => i.file.key),
    [paginatedItems],
  )

  const allPageFilesSelected =
    pageFileKeys.length > 0 && pageFileKeys.every((k) => selectedKeys.has(k))
  const somePageFilesSelected =
    pageFileKeys.some((k) => selectedKeys.has(k)) && !allPageFilesSelected

  const toggleKey = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const toggleSelectAllPage = (checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const k of pageFileKeys) {
        if (checked) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const effectiveMaxUploadBytes = maxUploadBytes ?? 100 * 1024 * 1024

  const startUpload = (file: File) => {
    if (!selectedBucket) return
    if (file.size > effectiveMaxUploadBytes) {
      toast.error(`File exceeds maximum size (${formatBytes(effectiveMaxUploadBytes)})`)
      return
    }
    const showBar = file.size > 1024 * 1024
    if (showBar) {
      setUploadProgress({ name: file.name, percent: 0 })
    }
    let lastPercent = 0
    void uploadS3Object(selectedBucket, file, prefix, {
      onProgress: showBar
        ? (loaded, total) => {
            const p = total > 0 ? Math.round((100 * loaded) / total) : 0
            if (p !== lastPercent) {
              lastPercent = p
              setUploadProgress({ name: file.name, percent: p })
            }
          }
        : undefined,
      onRegisterAbort: (abort) => {
        uploadAbortRef.current = abort
      },
      endpoint: activeEndpoint,
    })
      .then(() => {
        toast.success(`Uploaded ${file.name}`)
        void loadObjects()
        void refreshBuckets()
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') {
          toast.message('Upload cancelled')
        } else {
          toast.error(e instanceof Error ? e.message : 'Upload failed')
        }
      })
      .finally(() => {
        setUploadProgress(null)
        uploadAbortRef.current = null
        if (fileUploadRef.current) fileUploadRef.current.value = ''
      })
  }

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) startUpload(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setFileDragActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f) startUpload(f)
  }

  const onObjectListDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isFileDrag(e)) return
    setFileDragActive(true)
  }

  const onObjectListDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setFileDragActive(false)
  }

  const onObjectListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const confirmDeleteAction = async () => {
    if (!confirmDialog || !selectedBucket) return
    try {
      if (confirmDialog.type === 'delete-file') {
        await deleteS3Object(selectedBucket, confirmDialog.key, activeEndpoint)
        toast.success('Object deleted')
        if (objectDetail?.key === confirmDialog.key) setObjectDetail(null)
      } else if (confirmDialog.type === 'delete-bulk') {
        const keys = [...selectedKeys]
        await deleteS3ObjectsBatch(selectedBucket, { keys }, activeEndpoint)
        toast.success(`Deleted ${keys.length} object(s)`)
        setSelectedKeys(new Set())
        setObjectDetail(null)
      } else {
        await deleteS3ObjectsBatch(selectedBucket, { prefix: confirmDialog.folderPrefix }, activeEndpoint)
        toast.success('Folder deleted')
        setObjectDetail(null)
      }
      await loadObjects()
      await refreshBuckets()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setConfirmDialog(null)
    }
  }

  const submitNewFolder = async () => {
    if (!selectedBucket) return
    const segment = newFolderSegment.trim().replace(/^\/+|\/+$/g, '')
    if (!segment || segment.includes('..') || segment.includes('/')) {
      toast.error('Enter a single folder name (no slashes)')
      return
    }
    const folderPrefix = `${prefix}${segment}/`
    try {
      await createS3Folder(selectedBucket, folderPrefix, activeEndpoint)
      toast.success(`Created folder ${segment}`)
      setFolderDialogOpen(false)
      setNewFolderSegment('')
      await loadObjects()
      await refreshBuckets()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create folder')
    }
  }

  // Bucket list view
  if (!selectedBucket) {
    if (bucketsLoading) {
      return (
        <div className="space-y-6 p-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )
    }

    if (buckets.length === 0) {
      return (
        <EmptyState
          icon={HardDrive}
          title="No S3 buckets"
          description="Create a bucket to see it here."
        />
      )
    }

    return (
      <div className="space-y-6 p-6">
        <Breadcrumb segments={[createHomeSegment(), { label: 'S3', icon: getServiceIcon('s3') }]} />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">S3 Buckets</h2>
            <Badge variant="secondary">{buckets.length}</Badge>
            {filteredBuckets.length > 0 && <ExportDropdown service="s3" resourceType="buckets" data={filteredBuckets as unknown as Record<string, unknown>[]} />}
          </div>
          {buckets.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  ref={bucketSearchRef}
                  placeholder="Search buckets..."
                  value={bucketSearch}
                  onChange={(e) => { setBucketSearch(e.target.value); setBucketPage(0) }}
                  className="pl-8 h-8 text-sm"
                  aria-label="Search buckets"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={async () => { setRefreshing(true); await refreshBuckets(); setRefreshing(false) }}
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          )}
        </div>

        {filteredBuckets.length === 0 && bucketSearch ? (
          <EmptyState
            icon={Search}
            title="No matching buckets"
            description={`No buckets match "${bucketSearch}".`}
          />
        ) : (
        <>
        <div className="grid gap-3">
          {paginatedBuckets.map((bkt) => (
            <Card
              key={bkt.name}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => { setSelectedBucket(bkt.name); setPrefix('') }}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <HardDrive className="h-5 w-5 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{bkt.name}</div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{bkt.region}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(bkt.created)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-medium">{bkt.object_count}</div>
                      <div className="text-xs text-muted-foreground">objects</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{formatBytes(bkt.total_size)}</div>
                      <div className="text-xs text-muted-foreground">total</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {bkt.versioning === 'Enabled' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Shield className="h-3.5 w-3.5 text-emerald-500" />
                          </TooltipTrigger>
                          <TooltipContent>Versioning enabled</TooltipContent>
                        </Tooltip>
                      )}
                      {bkt.encryption === 'Enabled' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Lock className="h-3.5 w-3.5 text-blue-500" />
                          </TooltipTrigger>
                          <TooltipContent>Encryption enabled</TooltipContent>
                        </Tooltip>
                      )}
                      <TagCountBadge count={Object.keys(bkt.tags).length} />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {filteredBuckets.length > pageSize && (
          <PaginationBar
            page={bucketPage}
            totalPages={bucketTotalPages}
            totalItems={filteredBuckets.length}
            pageSize={pageSize}
            onPageChange={setBucketPage}
            onPageSizeChange={(size) => { setPageSize(size); setBucketPage(0) }}
          />
        )}
        </>
        )}
      </div>
    )
  }

  // Object browser view — fill ResourceBrowser pane (flex chain from Layout main)
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-6 p-6">
      {/* Breadcrumb navigation */}
      <div className="flex shrink-0 items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setSelectedBucket(null)} className="h-8">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Breadcrumb segments={breadcrumbSegments} />
      </div>

      <input
        ref={fileUploadRef}
        type="file"
        className="hidden"
        aria-hidden
        onChange={onFileInputChange}
      />

      <Tabs defaultValue="objects" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="objects">Objects</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="objects" className="flex-1 min-h-0">
      <div
        data-testid="s3-object-drop-zone"
        className="relative flex min-h-0 flex-1 flex-col rounded-lg border border-transparent"
        aria-label="Object list — drop a file here to upload"
        onDragEnter={onObjectListDragEnter}
        onDragLeave={onObjectListDragLeave}
        onDragOver={onObjectListDragOver}
        onDrop={onDrop}
      >
        {fileDragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary">
            Drop file to upload
          </div>
        )}
        <Card
          className={`flex h-full min-h-0 flex-1 flex-col ${fileDragActive ? 'ring-2 ring-primary/30' : ''}`}
        >
        <CardHeader className="shrink-0 p-4 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CardTitle className="text-sm font-medium truncate">
                {prefix ? `${prefix}` : 'Root'}
              </CardTitle>
              {objectsData && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {filteredFolders.length} folders, {filteredFiles.length} files
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => fileUploadRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={() => setFolderDialogOpen(true)}>
                <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
                New folder
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8"
                disabled={selectedKeys.size === 0}
                onClick={() => setConfirmDialog({ type: 'delete-bulk' })}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete selected
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Refresh"
                onClick={() => { void loadObjects(); void refreshBuckets() }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            {objectsData && (
              <>
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    ref={fileSearchRef}
                    placeholder="Search files..."
                    value={fileSearch}
                    onChange={(e) => { setFileSearch(e.target.value); setFilePage(0) }}
                    className="pl-8 h-8 text-sm"
                    aria-label="Search files and folders"
                  />
                </div>
                {filteredFiles.length > 0 && (
                  <ExportDropdown service="s3" resourceType="objects" data={filteredFiles as unknown as Record<string, unknown>[]} />
                )}
              </>
            )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          {loadingObjects ? (
            <div className="flex-1 space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : objectsData && (objectsData.folders.length > 0 || objectsData.files.length > 0) ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {allItems.length === 0 && fileSearch ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8">
                <EmptyState
                  icon={Search}
                  title="No matching files"
                  description={`No files or folders match "${fileSearch}".`}
                />
              </div>
            ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36px] pl-4">
                    <Checkbox
                      checked={
                        allPageFilesSelected
                          ? true
                          : somePageFilesSelected
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(v) => toggleSelectAllPage(v === true)}
                      title="Select all on this page"
                      aria-label="Select all files on this page"
                    />
                  </TableHead>
                  <TableHead className="w-[40%]">Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Last Modified</TableHead>
                  <TableHead className="w-[90px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Back navigation */}
                {prefix && !fileSearch && filePage === 0 && (
                  <TableRow className="cursor-pointer hover:bg-accent/50" onClick={navigateUp}>
                    <TableCell className="text-xs" colSpan={6}>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <ArrowLeft className="h-3.5 w-3.5" />
                        <span>..</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {paginatedItems.map((item) => {
                  if (item.type === 'folder') {
                    const folderName = item.folder.slice(prefix.length).replace(/\/$/, '')
                    return (
                      <TableRow
                        key={item.folder}
                        className="hover:bg-accent/50"
                      >
                        <TableCell className="pl-4 w-[36px]" onClick={(e) => e.stopPropagation()}>
                          <span className="inline-block w-4" aria-hidden />
                        </TableCell>
                        <TableCell
                          className="cursor-pointer"
                          onClick={() => navigateToFolder(item.folder)}
                        >
                          <div className="flex items-center gap-2">
                            <Folder className="h-4 w-4 text-yellow-500" />
                            <span className="text-sm font-medium">{folderName}/</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">Folder</TableCell>
                        <TableCell className="text-xs text-muted-foreground">—</TableCell>
                        <TableCell className="text-xs text-muted-foreground">—</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Delete folder ${folderName}`}
                            onClick={() =>
                              setConfirmDialog({ type: 'delete-folder', folderPrefix: item.folder })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  }
                  const file = item.file
                  const Icon = getFileIcon(file.content_type, file.name)
                  return (
                    <TableRow
                      key={file.key}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => openObject(selectedBucket, file.key)}
                    >
                      <TableCell className="pl-4 w-[36px]" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedKeys.has(file.key)}
                          onCheckedChange={(v) => toggleKey(file.key, v === true)}
                          aria-label={`Select ${file.name}`}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{file.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{file.content_type}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatBytes(file.size)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(file.last_modified)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={getS3DownloadUrl(selectedBucket, file.key, activeEndpoint)}
                                download
                                className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors"
                                aria-label={`Download ${file.name}`}
                              >
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>Download</TooltipContent>
                          </Tooltip>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Delete ${file.name}`}
                            onClick={() => setConfirmDialog({ type: 'delete-file', key: file.key })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </div>
            {allItems.length > pageSize && (
              <div className="shrink-0 border-t">
                <PaginationBar
                  page={filePage}
                  totalPages={fileTotalPages}
                  totalItems={allItems.length}
                  pageSize={pageSize}
                  onPageChange={setFilePage}
                  onPageSizeChange={(size) => { setPageSize(size); setFilePage(0) }}
                />
              </div>
            )}
            </div>
            )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8">
              <EmptyState
                icon={Folder}
                title={prefix ? 'Empty folder' : 'Empty bucket'}
                description="No objects in this location. Upload a file or create a folder."
              />
            </div>
          )}
        </CardContent>
        </Card>
      </div>
        </TabsContent>
        <TabsContent value="tags" className="space-y-4">
          <TagsSection
            tags={bucketTags}
            onSave={async (newTags) => {
              await updateResourceTags('s3', 'buckets', selectedBucket!, newTags, activeEndpoint)
              setBucketTags(newTags)
            }}
          />
        </TabsContent>
        <TabsContent value="settings" className="space-y-4 overflow-auto">
          <S3BucketSettings bucket={selectedBucket} endpoint={activeEndpoint} />
        </TabsContent>
      </Tabs>

      <Dialog
        open={uploadProgress !== null}
        onOpenChange={(open) => {
          if (!open) {
            uploadAbortRef.current?.()
            setUploadProgress(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Uploading</DialogTitle>
            <DialogDescription className="break-all">{uploadProgress?.name}</DialogDescription>
          </DialogHeader>
          {uploadProgress && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">{uploadProgress.percent}%</p>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                uploadAbortRef.current?.()
                setUploadProgress(null)
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDialog !== null} onOpenChange={(o) => !o && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm delete</DialogTitle>
            <DialogDescription>
              {confirmDialog?.type === 'delete-file' && (
                <>Delete <span className="font-mono break-all">{confirmDialog.key}</span>?</>
              )}
              {confirmDialog?.type === 'delete-bulk' && (
                <>Delete {selectedKeys.size} object(s)? This cannot be undone.</>
              )}
              {confirmDialog?.type === 'delete-folder' && (
                <>Delete folder and all objects under <span className="font-mono break-all">{confirmDialog.folderPrefix}</span>?</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDeleteAction()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Folder name under the current path (no slashes). A placeholder object will be created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="s3-new-folder">Folder name</Label>
            <Input
              id="s3-new-folder"
              value={newFolderSegment}
              onChange={(e) => setNewFolderSegment(e.target.value)}
              placeholder="my-folder"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewFolder()
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitNewFolder()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Object detail Sheet */}
      <Sheet open={!!objectDetail} onOpenChange={(open) => !open && setObjectDetail(null)}>
        <SheetContent className="sm:max-w-lg overflow-auto">
          {objectDetail && (
            <>
              <SheetHeader>
                <SheetTitle className="break-all text-base">{objectDetail.key.split('/').pop()}</SheetTitle>
                <SheetDescription className="break-all">{objectDetail.key}</SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-2 mt-2">
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <a href={getS3DownloadUrl(objectDetail.bucket, objectDetail.key, activeEndpoint)} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download ({formatBytes(objectDetail.size)})
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => setConfirmDialog({ type: 'delete-file', key: objectDetail.key })}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete object
                </Button>
              </div>

              <Tabs defaultValue="details" className="mt-4">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="tags">Tags</TabsTrigger>
                  <TabsTrigger value="raw">Raw</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div className="text-muted-foreground">Size</div>
                        <div className="font-mono">{formatBytes(objectDetail.size)}</div>

                        <div className="text-muted-foreground">Content-Type</div>
                        <div className="font-mono text-xs">{objectDetail.content_type}</div>

                        {objectDetail.content_encoding && (
                          <>
                            <div className="text-muted-foreground">Encoding</div>
                            <div className="font-mono text-xs">{objectDetail.content_encoding}</div>
                          </>
                        )}

                        <div className="text-muted-foreground">ETag</div>
                        <div className="font-mono text-xs truncate">{objectDetail.etag}</div>

                        <div className="text-muted-foreground">Last Modified</div>
                        <div>{formatDate(objectDetail.last_modified)}</div>

                        {objectDetail.version_id && (
                          <>
                            <div className="text-muted-foreground">Version ID</div>
                            <div className="font-mono text-xs truncate">{objectDetail.version_id}</div>
                          </>
                        )}
                      </div>

                      {Object.keys(objectDetail.metadata).length > 0 && (
                        <>
                          <Separator className="my-4" />
                          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">User Metadata</h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                            {Object.entries(objectDetail.metadata).map(([k, v]) => (
                              <div key={k} className="contents">
                                <div className="text-muted-foreground font-mono text-xs">{k}</div>
                                <div className="font-mono text-xs">{v}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {Object.keys(objectDetail.preserved_headers).length > 0 && (
                        <>
                          <Separator className="my-4" />
                          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">HTTP Headers</h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                            {Object.entries(objectDetail.preserved_headers).map(([k, v]) => (
                              <div key={k} className="contents">
                                <div className="text-muted-foreground font-mono text-xs">{k}</div>
                                <div className="font-mono text-xs">{v}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="tags" className="space-y-4">
                  <TagsSection tags={objectDetail.tags} />
                </TabsContent>

                <TabsContent value="raw" className="space-y-4">
                  <JsonViewer data={objectDetail} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
