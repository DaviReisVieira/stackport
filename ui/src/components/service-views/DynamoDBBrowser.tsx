import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  fetchDynamoDBTables,
  fetchDynamoDBTable,
  fetchDynamoDBItems,
  queryDynamoDBTable,
} from '@/lib/api'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import type {
  DynamoDBTable,
  DynamoDBTableDetail,
  DynamoDBItem,
  DynamoDBScanResponse,
} from '@/lib/types'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import { ExportDropdown } from '@/components/ExportDropdown'
import { JsonViewer } from '@/components/JsonViewer'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const tablesFetcher = useCallback(() => fetchDynamoDBTables(), [])
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

  useEffect(() => {
    if (!selectedTable) {
      setTableDetail(null)
      setItemsData(null)
      return
    }
    fetchDynamoDBTable(selectedTable)
      .then(setTableDetail)
      .catch(() => setTableDetail(null))
  }, [selectedTable])

  useEffect(() => {
    if (!selectedTable) return
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable, pageSize])

  const loadItems = async () => {
    if (!selectedTable) return
    setLoadingItems(true)
    try {
      const data = await fetchDynamoDBItems(selectedTable, pageSize)
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
      const data = await fetchDynamoDBItems(selectedTable, pageSize, itemsData.next_token)
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
      })
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
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )
    }

    if (tables.length === 0) {
      return <EmptyState icon={Database} title="No DynamoDB tables" description="Create a table to see it here." />
    }

    return (
      <div className="space-y-4">
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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
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

      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
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
            {mode === 'scan' && (
              <Button size="sm" onClick={loadItems} disabled={loadingItems} className="h-8">
                Refresh
              </Button>
            )}
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
        </CardHeader>
        <CardContent className="p-0">
          {loadingItems ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {itemKeys.slice(0, 6).map((key) => (
                        <TableHead key={key}>{key}</TableHead>
                      ))}
                      {itemKeys.length > 6 && <TableHead>...</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow
                        key={idx}
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => openItem(item)}
                      >
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {mode === 'scan' && (
                <div className="border-t">
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
            <EmptyState
              icon={TableIcon}
              title="No items"
              description={mode === 'query' ? 'No items match your query.' : 'This table is empty.'}
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={!!itemDetail} onOpenChange={(open) => !open && setItemDetail(null)}>
        <SheetContent className="sm:max-w-lg overflow-auto">
          {itemDetail && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">Item Detail</SheetTitle>
                <SheetDescription>DynamoDB item attributes</SheetDescription>
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
