import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  batchWriteDynamoDBItems,
  deleteDynamoDBItem,
  fetchDynamoDBTables,
  fetchDynamoDBTable,
  fetchDynamoDBItems,
  putDynamoDBItem,
  queryDynamoDBTable,
  updateDynamoDBItem,
  fetchResourceTags,
  updateResourceTags,
} from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useHealth } from '@/hooks/useHealth'
import {
  buildDefaultPlainItem,
  countUnprocessed,
  dynamoItemToPlainMap,
  extractKeyDynamo,
  plainItemToDynamoMap,
} from '@/lib/dynamodb-marshal'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import type {
  DynamoDBTable,
  DynamoDBTableDetail,
  DynamoDBItem,
  DynamoDBScanResponse,
} from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import { ExportDropdown } from '@/components/ExportDropdown'
import { JsonViewer } from '@/components/JsonViewer'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { TagsSection } from '@/components/TagsSection'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Database,
  Table as TableIcon,
  Search,
  Key,
  Hash,
  Layers,
  Clock,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Pencil,
  Trash2,
  Plus,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

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

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object' && value !== null) {
    if ('S' in value) return String((value as { S: string }).S)
    if ('N' in value) return String((value as { N: string }).N)
    if ('BOOL' in value) return String((value as { BOOL: boolean }).BOOL)
    if ('NULL' in value) return 'null'
    if ('L' in value) return `[${(value as { L: unknown[] }).L.length} items]`
    if ('M' in value) return `{${Object.keys((value as { M: Record<string, unknown> }).M).length} keys}`
    if ('SS' in value) return `[${(value as { SS: string[] }).SS.length} strings]`
    if ('NS' in value) return `[${(value as { NS: string[] }).NS.length} numbers]`
    if ('BS' in value) return `[${(value as { BS: string[] }).BS.length} binaries]`
    if ('B' in value) return '[binary]'
    return JSON.stringify(value)
  }
  return String(value)
}

function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  hasNextPage,
}: {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  hasNextPage?: boolean
}) {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, totalItems)

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {start}–{end} {hasNextPage ? '(more available)' : `of ${totalItems}`}
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
          {page + 1} {hasNextPage ? '/ ...' : `/ ${totalPages}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={hasNextPage ? false : page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function DynamoDBBrowser() {
  const { activeEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const writesEnabled = health?.writes_enabled ?? true
  const [searchParams, setSearchParams] = useSearchParams()
  const tablesFetcher = useCallback(() => fetchDynamoDBTables(activeEndpoint), [activeEndpoint])
  const { data: tablesData, loading: tablesLoading, refresh: refreshTables } = useFetch<{ tables: DynamoDBTable[] }>(tablesFetcher, 10000)
  const [refreshing, setRefreshing] = useState(false)

  // Read selected table from URL params
  const selectedTable = searchParams.get('table')

  // Helper to update URL params
  const setSelectedTable = (table: string | null) => {
    if (table === null) {
      setSearchParams({})
    } else {
      setSearchParams({ table })
    }
  }

  const [tableDetail, setTableDetail] = useState<DynamoDBTableDetail | null>(null)
  const [itemsData, setItemsData] = useState<DynamoDBScanResponse | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemDetail, setItemDetail] = useState<DynamoDBItem | null>(null)
  const [tableSearch, setTableSearch] = useState('')
  const [tablePage, setTablePage] = useState(0)
  const [itemPage, setItemPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [mode, setMode] = useState<'scan' | 'query'>('scan')

  const [queryPartitionKey, setQueryPartitionKey] = useState('')
  const [querySortKey, setQuerySortKey] = useState('')
  const [querySortKeyOp, setQuerySortKeyOp] = useState('=')
  const [tableTags, setTableTags] = useState<Record<string, string>>({})

  const [itemEditorOpen, setItemEditorOpen] = useState(false)
  const [itemEditorMode, setItemEditorMode] = useState<'create' | 'edit'>('create')
  const [itemEditorText, setItemEditorText] = useState('')
  const [itemView, setItemView] = useState<'plain' | 'dynamodb'>('plain')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!selectedTable) {
      setTableDetail(null)
      setItemsData(null)
      setTableTags({})
      return
    }
    fetchDynamoDBTable(selectedTable, activeEndpoint)
      .then(setTableDetail)
      .catch(() => setTableDetail(null))
    fetchResourceTags('dynamodb', 'tables', selectedTable, activeEndpoint)
      .then(res => setTableTags(res.tags))
      .catch(() => setTableTags({}))
  }, [selectedTable, activeEndpoint])

  useEffect(() => {
    setSelectedRows(new Set())
  }, [itemsData])

  useEffect(() => {
    if (!selectedTable) return
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable, pageSize])

  const loadItems = async () => {
    if (!selectedTable) return
    setLoadingItems(true)
    try {
      const data = await fetchDynamoDBItems(selectedTable, pageSize, undefined, activeEndpoint)
      setItemsData(data)
      setItemPage(0)
    } catch {
      setItemsData(null)
      toast.error('Failed to load items')
    } finally {
      setLoadingItems(false)
    }
  }

  const loadNextPage = async () => {
    if (!selectedTable || !itemsData?.next_token) return
    setLoadingItems(true)
    try {
      const data = await fetchDynamoDBItems(selectedTable, pageSize, itemsData.next_token, activeEndpoint)
      setItemsData(data)
      setItemPage((p) => p + 1)
    } catch {
      toast.error('Failed to load next page')
    } finally {
      setLoadingItems(false)
    }
  }

  const loadPreviousPage = () => {
    setItemPage((p) => Math.max(0, p - 1))
    loadItems()
  }

  const executeQuery = async () => {
    if (!selectedTable || !queryPartitionKey) {
      toast.error('Partition key value is required')
      return
    }
    setLoadingItems(true)
    try {
      const data = await queryDynamoDBTable(selectedTable, {
        partition_key_value: queryPartitionKey,
        sort_key_value: querySortKey || null,
        sort_key_operator: querySortKeyOp,
        limit: pageSize,
      }, activeEndpoint)
      setItemsData({ ...data, next_token: null })
      setItemPage(0)
    } catch {
      toast.error('Query failed')
    } finally {
      setLoadingItems(false)
    }
  }

  const openItem = (item: DynamoDBItem) => {
    setItemDetail(item)
  }

  const reloadCurrentItems = async () => {
    if (!selectedTable) return
    if (mode === 'query' && queryPartitionKey) {
      setLoadingItems(true)
      try {
        const data = await queryDynamoDBTable(
          selectedTable,
          {
            partition_key_value: queryPartitionKey,
            sort_key_value: querySortKey || null,
            sort_key_operator: querySortKeyOp,
            limit: pageSize,
          },
          activeEndpoint
        )
        setItemsData({ ...data, next_token: null })
      } catch {
        toast.error('Refresh failed')
      } finally {
        setLoadingItems(false)
      }
    } else {
      await loadItems()
    }
  }

  const openCreateItem = () => {
    if (!tableDetail?.partition_key) {
      toast.error('Table key schema not loaded')
      return
    }
    setItemEditorMode('create')
    setItemView('plain')
    const def = buildDefaultPlainItem(
      tableDetail.partition_key,
      tableDetail.sort_key,
      tableDetail.partition_key_type,
      tableDetail.sort_key_type
    )
    setItemEditorText(JSON.stringify(def, null, 2))
    setItemEditorOpen(true)
  }

  const openEditItem = (item: DynamoDBItem) => {
    setItemEditorMode('edit')
    setItemView('dynamodb')
    setItemEditorText(JSON.stringify(item, null, 2))
    setItemEditorOpen(true)
  }

  const switchItemView = (next: 'plain' | 'dynamodb') => {
    if (next === itemView) return
    try {
      const parsed = JSON.parse(itemEditorText) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        toast.error('Item must be a JSON object')
        return
      }
      if (next === 'dynamodb') {
        const plain =
          itemView === 'plain'
            ? (parsed as Record<string, unknown>)
            : dynamoItemToPlainMap(parsed as DynamoDBItem)
        setItemEditorText(JSON.stringify(plainItemToDynamoMap(plain), null, 2))
      } else {
        const ddb =
          itemView === 'dynamodb' ? (parsed as DynamoDBItem) : plainItemToDynamoMap(parsed as Record<string, unknown>)
        setItemEditorText(JSON.stringify(dynamoItemToPlainMap(ddb), null, 2))
      }
      setItemView(next)
    } catch {
      toast.error('Invalid JSON')
    }
  }

  const saveItemDialog = async () => {
    if (!selectedTable) return
    let parsed: unknown
    try {
      parsed = JSON.parse(itemEditorText)
    } catch {
      toast.error('Invalid JSON')
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      toast.error('Item must be a JSON object')
      return
    }
    const fmt = itemView === 'plain' ? 'plain' : 'dynamodb'
    const payload = parsed as DynamoDBItem
    try {
      if (itemEditorMode === 'create') {
        await putDynamoDBItem(selectedTable, payload, fmt, activeEndpoint, 'POST')
      } else {
        await updateDynamoDBItem(selectedTable, payload, fmt, activeEndpoint)
      }
      toast.success('Item saved')
      setItemEditorOpen(false)
      setItemDetail(null)
      await reloadCurrentItems()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const deleteItemByKey = async (item: DynamoDBItem) => {
    if (!selectedTable || !tableDetail?.partition_key) return
    if (!window.confirm('Delete this item? This cannot be undone.')) return
    const key = extractKeyDynamo(item, tableDetail.partition_key, tableDetail.sort_key)
    try {
      await deleteDynamoDBItem(selectedTable, key, 'dynamodb', activeEndpoint)
      toast.success('Item deleted')
      setItemDetail(null)
      await reloadCurrentItems()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const runImport = async () => {
    if (!selectedTable) return
    let data: unknown
    try {
      data = JSON.parse(importText)
    } catch {
      toast.error('Invalid JSON')
      return
    }
    if (!Array.isArray(data)) {
      toast.error('Expected a JSON array of objects')
      return
    }
    const rows = data as Record<string, unknown>[]
    try {
      let unprocessedTotal = 0
      for (let i = 0; i < rows.length; i += 25) {
        const chunk = rows.slice(i, i + 25)
        const operations = chunk.map((obj) => ({ op: 'put' as const, item: obj as DynamoDBItem }))
        const resp = await batchWriteDynamoDBItems(selectedTable, operations, 'plain', activeEndpoint)
        unprocessedTotal += countUnprocessed(resp, selectedTable)
      }
      if (unprocessedTotal > 0) {
        const written = rows.length - unprocessedTotal
        toast.warning(
          `Imported ${written} of ${rows.length} item(s); ${unprocessedTotal} not processed — retry needed`
        )
      } else {
        toast.success(`Imported ${rows.length} item(s)`)
      }
      setImportOpen(false)
      setImportText('')
      await reloadCurrentItems()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
    }
  }

  const runBulkDelete = async () => {
    if (!selectedTable || !tableDetail?.partition_key) return
    const list = itemsData?.items ?? []
    const idxs = Array.from(selectedRows).sort((a, b) => a - b)
    const ops: { op: 'delete'; key: DynamoDBItem }[] = idxs.map((i) => {
      const it = list[i]!
      return {
        op: 'delete' as const,
        key: extractKeyDynamo(it, tableDetail.partition_key!, tableDetail.sort_key),
      }
    })
    try {
      let unprocessedTotal = 0
      for (let i = 0; i < ops.length; i += 25) {
        const chunk = ops.slice(i, i + 25)
        const resp = await batchWriteDynamoDBItems(
          selectedTable,
          chunk.map((o) => ({ op: 'delete' as const, key: o.key })),
          'dynamodb',
          activeEndpoint
        )
        unprocessedTotal += countUnprocessed(resp, selectedTable)
      }
      if (unprocessedTotal > 0) {
        const deleted = ops.length - unprocessedTotal
        toast.warning(
          `Deleted ${deleted} of ${ops.length} item(s); ${unprocessedTotal} not processed — retry needed`
        )
      } else {
        toast.success(`Deleted ${ops.length} item(s)`)
      }
      setBulkDeleteOpen(false)
      setSelectedRows(new Set())
      setItemDetail(null)
      await reloadCurrentItems()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk delete failed')
    }
  }

  const tables = tablesData?.tables ?? []
  const filteredTables = tableSearch
    ? tables.filter((t) => t.name.toLowerCase().includes(tableSearch.toLowerCase()))
    : tables

  const tableTotalPages = Math.max(1, Math.ceil(filteredTables.length / pageSize))
  const paginatedTables = useMemo(
    () => filteredTables.slice(tablePage * pageSize, (tablePage + 1) * pageSize),
    [filteredTables, tablePage, pageSize]
  )

  const items = itemsData?.items ?? []
  const itemKeys = items.length > 0 ? Array.from(new Set(items.flatMap((item) => Object.keys(item)))) : []

  if (!selectedTable) {
    if (tablesLoading) {
      return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-auto p-4">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>
      )
    }

    if (tables.length === 0) {
      return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center p-4">
          <EmptyState icon={Database} title="No DynamoDB tables" description="Create a table to see it here." />
        </div>
      )
    }

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto p-4">
        <Breadcrumb segments={[createHomeSegment(), { label: 'DynamoDB', icon: getServiceIcon('dynamodb') }]} />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-bold">DynamoDB Tables</h2>
            <Badge variant="secondary">{tables.length}</Badge>
            {filteredTables.length > 0 && <ExportDropdown service="dynamodb" resourceType="tables" data={filteredTables as unknown as Record<string, unknown>[]} />}
          </div>
          {tables.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search tables..."
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value)
                    setTablePage(0)
                  }}
                  className="pl-8 h-8 text-sm"
                  aria-label="Search tables"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={async () => { setRefreshing(true); await refreshTables(); setRefreshing(false) }}
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          )}
        </div>

        {filteredTables.length === 0 && tableSearch ? (
          <EmptyState icon={Search} title="No matching tables" description={`No tables match "${tableSearch}".`} />
        ) : (
          <>
            <div className="grid gap-3">
              {paginatedTables.map((tbl) => (
                <Card
                  key={tbl.name}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => {
                    setSelectedTable(tbl.name)
                    setMode('scan')
                    setQueryPartitionKey('')
                    setQuerySortKey('')
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <TableIcon className="h-5 w-5 text-primary flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{tbl.name}</div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {tbl.partition_key && (
                              <span className="flex items-center gap-1">
                                <Key className="h-3 w-3" />
                                {tbl.partition_key}
                              </span>
                            )}
                            {tbl.sort_key && (
                              <span className="flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                {tbl.sort_key}
                              </span>
                            )}
                            {tbl.created && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDate(tbl.created)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-sm font-medium">{tbl.item_count.toLocaleString()}</div>
                          <div className="text-xs text-muted-foreground">items</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">{formatBytes(tbl.size_bytes)}</div>
                          <div className="text-xs text-muted-foreground">size</div>
                        </div>
                        <Badge variant={tbl.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-xs">
                          {tbl.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {filteredTables.length > pageSize && (
              <PaginationBar
                page={tablePage}
                totalPages={tableTotalPages}
                totalItems={filteredTables.length}
                pageSize={pageSize}
                onPageChange={setTablePage}
                onPageSizeChange={(size) => {
                  setPageSize(size)
                  setTablePage(0)
                }}
              />
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-hidden p-6 text-card-foreground">
      <div className="flex shrink-0 items-center gap-2">
        <Breadcrumb segments={[
          createHomeSegment(),
          { label: 'DynamoDB', href: '/resources/dynamodb', icon: getServiceIcon('dynamodb') },
          { label: selectedTable },
        ]} />
        {tableDetail && (
          <>
            <Badge variant="secondary" className="text-xs">
              {tableDetail.item_count.toLocaleString()} items
            </Badge>
            {tableDetail.partition_key && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Key className="h-3 w-3" />
                {tableDetail.partition_key}
                {tableDetail.partition_key_type && ` (${tableDetail.partition_key_type})`}
              </span>
            )}
            {tableDetail.sort_key && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {tableDetail.sort_key}
                {tableDetail.sort_key_type && ` (${tableDetail.sort_key_type})`}
              </span>
            )}
          </>
        )}
      </div>

      <Tabs defaultValue="items" className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
        <TabsList className="h-9 w-fit shrink-0">
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>

        <TabsContent
          value="items"
          className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus-visible:outline-none data-[state=active]:flex data-[state=inactive]:hidden"
        >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60">
        <div className="shrink-0 border-b border-border/50 p-4 pb-2">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={mode} onValueChange={(v) => setMode(v as 'scan' | 'query')}>
                  <SelectTrigger className="w-[120px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scan">Scan</SelectItem>
                    <SelectItem value="query">Query</SelectItem>
                  </SelectContent>
                </Select>
                {itemsData && (
                  <span className="text-xs text-muted-foreground">
                    {itemsData.count} items (scanned {itemsData.scanned_count})
                  </span>
                )}
                {items.length > 0 && <ExportDropdown service="dynamodb" resourceType="items" data={items as unknown as Record<string, unknown>[]} />}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {writesEnabled && tableDetail?.partition_key && (
                  <>
                    <Button type="button" size="sm" onClick={openCreateItem} className="h-8" title="Create item (JSON)">
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      New item
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setImportText('')
                        setImportOpen(true)
                      }}
                      className="h-8"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      Import
                    </Button>
                    {selectedRows.size > 0 && (
                      <Button type="button" size="sm" variant="destructive" className="h-8" onClick={() => setBulkDeleteOpen(true)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete ({selectedRows.size})
                      </Button>
                    )}
                  </>
                )}
                {mode === 'scan' && (
                  <Button type="button" size="sm" onClick={loadItems} disabled={loadingItems} className="h-8">
                    Refresh
                  </Button>
                )}
                {mode === 'query' && (
                  <Button type="button" size="sm" onClick={executeQuery} disabled={loadingItems} className="h-8">
                    Refresh
                  </Button>
                )}
              </div>
            </div>
          </div>
          {mode === 'query' && tableDetail && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="pk-value" className="text-xs">
                  {tableDetail.partition_key} (Partition Key)
                </Label>
                <Input
                  id="pk-value"
                  placeholder="Value"
                  value={queryPartitionKey}
                  onChange={(e) => setQueryPartitionKey(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              {tableDetail.sort_key && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="sk-op" className="text-xs">
                      Sort Key Operator
                    </Label>
                    <Select value={querySortKeyOp} onValueChange={setQuerySortKeyOp}>
                      <SelectTrigger id="sk-op" className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="=">=</SelectItem>
                        <SelectItem value="<">&lt;</SelectItem>
                        <SelectItem value="<=">&lt;=</SelectItem>
                        <SelectItem value=">">&gt;</SelectItem>
                        <SelectItem value=">=">&gt;=</SelectItem>
                        <SelectItem value="BEGINS_WITH">BEGINS_WITH</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sk-value" className="text-xs">
                      {tableDetail.sort_key} (Sort Key)
                    </Label>
                    <Input
                      id="sk-value"
                      placeholder="Value (optional)"
                      value={querySortKey}
                      onChange={(e) => setQuerySortKey(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </>
              )}
              <div className="flex items-end">
                <Button size="sm" onClick={executeQuery} disabled={loadingItems} className="h-8 w-full">
                  Query
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {loadingItems ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length > 0 ? (
            <>
              <div className="min-h-0 flex-1 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 p-2">
                        <Checkbox
                          checked={
                            items.length > 0 && selectedRows.size === items.length
                              ? true
                              : selectedRows.size > 0
                                ? 'indeterminate'
                                : false
                          }
                          onCheckedChange={(c) => {
                            if (c) setSelectedRows(new Set(items.map((_, i) => i)))
                            else setSelectedRows(new Set())
                          }}
                          aria-label="Select all items on this page"
                        />
                      </TableHead>
                      {itemKeys.slice(0, 6).map((key) => (
                        <TableHead key={key}>{key}</TableHead>
                      ))}
                      {itemKeys.length > 6 && <TableHead>...</TableHead>}
                      <TableHead className="w-[88px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow
                        key={idx}
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => openItem(item)}
                      >
                        <TableCell
                          className="w-10 p-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedRows.has(idx)}
                            onCheckedChange={(c) => {
                              setSelectedRows((prev) => {
                                const n = new Set(prev)
                                if (c) n.add(idx)
                                else n.delete(idx)
                                return n
                              })
                            }}
                            aria-label="Select row"
                          />
                        </TableCell>
                        {itemKeys.slice(0, 6).map((key) => (
                          <TableCell key={key} className="text-xs font-mono max-w-[200px] truncate">
                            {formatAttributeValue(item[key])}
                          </TableCell>
                        ))}
                        {itemKeys.length > 6 && (
                          <TableCell className="text-xs text-muted-foreground">
                            <Layers className="h-3.5 w-3.5" />
                          </TableCell>
                        )}
                        <TableCell
                          className="p-1 text-right w-[88px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {writesEnabled && tableDetail ? (
                            <div className="inline-flex items-center justify-end gap-0.5">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="Edit item"
                                onClick={() => {
                                  openEditItem(item)
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Delete item"
                                onClick={() => {
                                  void deleteItemByKey(item)
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {mode === 'scan' && (
                <div className="shrink-0 border-t border-border/50">
                  <PaginationBar
                    page={itemPage}
                    totalPages={1}
                    totalItems={items.length}
                    pageSize={pageSize}
                    onPageChange={(p) => {
                      if (p > itemPage) loadNextPage()
                      else loadPreviousPage()
                    }}
                    onPageSizeChange={(size) => {
                      setPageSize(size)
                      loadItems()
                    }}
                    hasNextPage={!!itemsData?.next_token}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <EmptyState
                icon={TableIcon}
                title="No items"
                description={mode === 'query' ? 'No items match your query.' : 'This table is empty.'}
              />
            </div>
          )}
        </div>
      </div>
        </TabsContent>

        <TabsContent
          value="tags"
          className="mt-0 w-full min-w-0 flex-1 space-y-4 overflow-y-auto py-0 outline-none focus-visible:outline-none data-[state=inactive]:hidden"
        >
          <TagsSection
            tags={tableTags}
            onSave={async (newTags) => {
              await updateResourceTags('dynamodb', 'tables', selectedTable, newTags, activeEndpoint)
              setTableTags(newTags)
            }}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={itemEditorOpen} onOpenChange={setItemEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{itemEditorMode === 'create' ? 'New item' : 'Edit item'}</DialogTitle>
            <DialogDescription>
              {itemView === 'plain' ? 'Plain JSON (JavaScript values). On save, the server maps types for DynamoDB.' : 'DynamoDB attribute map (S, N, M, L, ...).'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ddb-view-mode" className="text-xs text-muted-foreground">
                Plain JSON
              </Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="ddb-view-mode"
                  checked={itemView === 'dynamodb'}
                  onCheckedChange={(c) => switchItemView(c ? 'dynamodb' : 'plain')}
                />
                <span className="text-xs text-muted-foreground">DynamoDB JSON</span>
              </div>
            </div>
            <Textarea
              value={itemEditorText}
              onChange={(e) => setItemEditorText(e.target.value)}
              className="min-h-[280px] font-mono text-xs"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setItemEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveItemDialog()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Import items</DialogTitle>
            <DialogDescription>Paste a JSON array of objects. Keys and values use plain JSON; each object is written as one item (batched by 25).</DialogDescription>
          </DialogHeader>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="min-h-[200px] font-mono text-xs"
            placeholder='[ { "pk": "a", "name": "x" }, ... ]'
            spellCheck={false}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void runImport()}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedRows.size} item(s)?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void runBulkDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!itemDetail} onOpenChange={(open) => !open && setItemDetail(null)}>
        <SheetContent className="sm:max-w-lg overflow-auto">
          {itemDetail && (
            <>
              <SheetHeader>
                <div className="flex items-start justify-between gap-3 pr-6">
                  <div>
                    <SheetTitle className="text-base">Item Detail</SheetTitle>
                    <SheetDescription>DynamoDB item attributes</SheetDescription>
                  </div>
                  {writesEnabled && tableDetail?.partition_key && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => {
                          const cur = itemDetail
                          setItemDetail(null)
                          openEditItem(cur)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        onClick={() => {
                          void deleteItemByKey(itemDetail)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              </SheetHeader>

              <div className="space-y-4 mt-4">
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Attributes
                  </h4>
                  <div className="space-y-2">
                    {Object.entries(itemDetail).map(([key, value]) => (
                      <div key={key} className="border rounded p-2">
                        <div className="text-xs font-medium text-muted-foreground mb-1">{key}</div>
                        <div className="text-sm font-mono break-all">{formatAttributeValue(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Raw JSON</h4>
                  <JsonViewer data={itemDetail} />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
