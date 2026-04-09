import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useFetch } from '../hooks/useFetch'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { fetchStats, fetchResources, fetchResourceDetail } from '../lib/api'
import type { StatsResponse, ResourceListResponse, ResourceDetailResponse } from '../lib/types'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { JsonViewer } from '@/components/JsonViewer'
import { SERVICE_VIEWS } from '@/components/service-views'
import { getServiceIcon } from '@/lib/service-icons'
import { FolderOpen, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'

const PAGE_SIZE_OPTIONS = [25, 50, 100]

function getTimeAgo(date: Date | null): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function PaginationBar({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number
  page: number
  pageSize: number
  onPageChange: (p: number) => void
  onPageSizeChange: (s: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  if (total <= PAGE_SIZE_OPTIONS[0]) return null

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Show</span>
        <Select value={String(pageSize)} onValueChange={(v) => { onPageSizeChange(Number(v)); onPageChange(0) }}>
          <SelectTrigger className="h-7 w-16 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((s) => (
              <SelectItem key={s} value={String(s)}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>{total} total</span>
      </div>
      <div className="flex items-center gap-1">
        <span>Page {page + 1} of {totalPages}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export default function ResourceBrowser() {
  const { service } = useParams<{ service?: string }>()
  const navigate = useNavigate()
  const statsFetcher = useCallback(() => fetchStats(), [])
  const { data: stats } = useFetch<StatsResponse>(statsFetcher, 10000)
  const [resources, setResources] = useState<Record<string, unknown[]> | null>(null)
  const [detail, setDetail] = useState<ResourceDetailResponse | null>(null)
  const [loadingResources, setLoadingResources] = useState(false)
  const [resourceError, setResourceError] = useState<string | null>(null)
  const [pages, setPages] = useState<Record<string, number>>({})
  const [pageSize, setPageSize] = useState(25)
  const [searchQuery, setSearchQuery] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [, setTimestamp] = useState(0)
  const [selectedRow, setSelectedRow] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!service) {
      setResources(null)
      setResourceError(null)
      setLastUpdated(null)
      return
    }
    setLoadingResources(true)
    setResourceError(null)
    setPages({})
    setSearchQuery('')
    fetchResources(service)
      .then((data: ResourceListResponse) => {
        setResources(data.resources ?? {})
        setLastUpdated(new Date())
      })
      .catch((e) => {
        setResources(null)
        setResourceError(e instanceof Error ? e.message : 'Failed to load resources')
      })
      .finally(() => setLoadingResources(false))
  }, [service])

  // Update timestamp display every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTimestamp(Date.now())
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const openDetail = async (svc: string, type: string, id: string) => {
    try {
      const data = await fetchResourceDetail(svc, type, id) as ResourceDetailResponse
      setDetail(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load detail'
      toast.error('Failed to load resource detail', { description: msg })
    }
  }

  const refreshResources = () => {
    if (!service) return
    setLoadingResources(true)
    setResourceError(null)
    fetchResources(service)
      .then((data: ResourceListResponse) => {
        setResources(data.resources ?? {})
        setLastUpdated(new Date())
      })
      .catch((e) => {
        setResources(null)
        setResourceError(e instanceof Error ? e.message : 'Failed to load resources')
      })
      .finally(() => setLoadingResources(false))
  }

  const services = stats ? Object.entries(stats.services) : []

  // Compute flat list of all visible resource items for j/k navigation
  const allVisibleItems: { service: string; type: string; id: string }[] = []
  if (service && !SERVICE_VIEWS[service] && resources) {
    for (const [type, items] of Object.entries(resources)) {
      const arr = Array.isArray(items) ? items as Record<string, unknown>[] : []
      const filteredArr = searchQuery
        ? arr.filter((item) => {
            const searchLower = searchQuery.toLowerCase()
            return Object.values(item).some((value) => {
              if (value === null || value === undefined) return false
              return String(value).toLowerCase().includes(searchLower)
            })
          })
        : arr
      const currentPage = pages[type] ?? 0
      const paginatedItems = filteredArr.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
      for (const item of paginatedItems) {
        allVisibleItems.push({ service, type, id: String((item as Record<string, unknown>).id ?? '') })
      }
    }
  }

  // Reset row selection when service or resources change
  useEffect(() => {
    setSelectedRow(-1)
  }, [service, resources, searchQuery])

  // Page-level keyboard shortcuts
  useKeyboardShortcuts(
    [
      { key: '/', handler: () => searchInputRef.current?.focus() },
      { key: 'Escape', handler: () => {
        if (detail) setDetail(null)
        else if (selectedRow >= 0) setSelectedRow(-1)
        else searchInputRef.current?.blur()
      }},
      { key: 'r', handler: () => refreshResources() },
      { key: '[', handler: () => {
        if (services.length === 0) return
        if (!service) {
          navigate(`/resources/${services[services.length - 1][0]}`)
          return
        }
        const idx = services.findIndex(([name]) => name === service)
        if (idx > 0) navigate(`/resources/${services[idx - 1][0]}`)
      }},
      { key: ']', handler: () => {
        if (services.length === 0) return
        if (!service) {
          navigate(`/resources/${services[0][0]}`)
          return
        }
        const idx = services.findIndex(([name]) => name === service)
        if (idx >= 0 && idx < services.length - 1) navigate(`/resources/${services[idx + 1][0]}`)
      }},
      { key: 'j', handler: () => {
        if (allVisibleItems.length === 0) return
        setSelectedRow((prev) => Math.min(prev + 1, allVisibleItems.length - 1))
      }},
      { key: 'k', handler: () => {
        if (allVisibleItems.length === 0) return
        setSelectedRow((prev) => Math.max(prev - 1, 0))
      }},
      { key: 'Enter', handler: () => {
        if (selectedRow >= 0 && selectedRow < allVisibleItems.length) {
          const item = allVisibleItems[selectedRow]
          openDetail(item.service, item.type, item.id)
        }
      }},
    ]
  )

  return (
    <div className="flex h-full">
      {/* Service sidebar */}
      <ScrollArea className="w-52 border-r bg-card/50">
        <div className="px-3 py-3 border-b">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Services</h3>
        </div>
        <ul className="py-1">
          {services.map(([name, svc]) => {
            const total = Object.values(svc.resources).reduce((a, b) => a + b, 0)
            const Icon = getServiceIcon(name)
            return (
              <li key={name}>
                <Link
                  to={`/resources/${name}`}
                  className={`flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                    service === name
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Icon className="h-3.5 w-3.5" />
                    {name}
                  </span>
                  {total > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-2">
                      {total}
                    </Badge>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </ScrollArea>

      {/* Resource content */}
      <div className="flex-1 overflow-auto p-6">
        {!service && (
          <EmptyState
            icon={FolderOpen}
            title="Select a service"
            description="Choose a service from the sidebar to browse its resources."
          />
        )}

        {service && SERVICE_VIEWS[service] && (() => {
          const CustomBrowser = SERVICE_VIEWS[service]
          return <CustomBrowser />
        })()}

        {service && !SERVICE_VIEWS[service] && loadingResources && (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {/* Error state */}
        {service && !SERVICE_VIEWS[service] && !loadingResources && resourceError && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-3">
              <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
              <p className="text-sm text-muted-foreground">{resourceError}</p>
              <Button variant="outline" size="sm" onClick={refreshResources}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {service && !SERVICE_VIEWS[service] && resources && (() => {
          let globalRowIdx = 0

          return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {(() => { const Icon = getServiceIcon(service); return <Icon className="h-5 w-5 text-muted-foreground" /> })()}
                <h2 className="text-xl font-bold">{service}</h2>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={refreshResources}
                    disabled={loadingResources}
                    className="h-7 gap-1.5"
                    aria-label="Refresh resources"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingResources ? 'animate-spin' : ''}`} />
                    <span className="text-xs">Refresh</span>
                  </Button>
                  {lastUpdated && (
                    <span className="text-xs text-muted-foreground">
                      {getTimeAgo(lastUpdated)}
                    </span>
                  )}
                </div>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search resources..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setPages({})
                  }}
                  className="pl-8 pr-8 h-8 text-sm"
                  aria-label="Search resources"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0.5 top-0.5 h-7 w-7"
                    onClick={() => {
                      setSearchQuery('')
                      setPages({})
                    }}
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {Object.entries(resources).map(([type, items]) => {
              const arr = Array.isArray(items) ? items as Record<string, unknown>[] : []

              // Filter resources based on search query
              const filteredArr = searchQuery
                ? arr.filter((item) => {
                    const searchLower = searchQuery.toLowerCase()
                    return Object.values(item).some((value) => {
                      if (value === null || value === undefined) return false
                      return String(value).toLowerCase().includes(searchLower)
                    })
                  })
                : arr

              const currentPage = pages[type] ?? 0
              const paginatedItems = filteredArr.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

              return (
                <Card key={type}>
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">{type}</CardTitle>
                      <Badge variant="secondary" className="text-[10px]">
                        {searchQuery && filteredArr.length !== arr.length
                          ? `${filteredArr.length} of ${arr.length} items`
                          : `${arr.length} items`}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {filteredArr.length === 0 && searchQuery && (
                      <div className="px-4 py-6 text-center space-y-1">
                        <div className="flex justify-center">
                          <Search className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">No matches for "{searchQuery}"</p>
                      </div>
                    )}
                    {filteredArr.length === 0 && !searchQuery && (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">Empty</div>
                    )}
                    {filteredArr.length > 0 && (
                      <>
                        <Table>
                          <TableBody>
                            {paginatedItems.map((item, i) => {
                              const rowIdx = globalRowIdx++
                              const isSelected = rowIdx === selectedRow
                              return (
                              <TableRow
                                key={i}
                                className={`cursor-pointer ${isSelected ? 'bg-accent' : ''}`}
                                onClick={() => openDetail(service, type, String(item.id ?? i))}
                                data-row-index={rowIdx}
                              >
                                <TableCell className="text-primary font-mono font-medium text-xs">
                                  {String(item.id ?? i)}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-xs truncate max-w-md">
                                  {Object.entries(item)
                                    .filter(([k]) => k !== 'id')
                                    .slice(0, 4)
                                    .map(([k, v]) => `${k}: ${typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '...' : v}`)
                                    .join(' | ')}
                                </TableCell>
                              </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                        <PaginationBar
                          total={filteredArr.length}
                          page={currentPage}
                          pageSize={pageSize}
                          onPageChange={(p) => setPages((prev) => ({ ...prev, [type]: p }))}
                          onPageSizeChange={setPageSize}
                        />
                      </>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
          )
        })()}

        {/* Detail Sheet */}
        <Sheet open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
          <SheetContent className="sm:max-w-lg overflow-auto">
            {detail && (
              <>
                <SheetHeader>
                  <SheetTitle>{detail.type} / {detail.id}</SheetTitle>
                  <SheetDescription>{detail.service}</SheetDescription>
                </SheetHeader>
                <JsonViewer data={detail.detail} />
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
