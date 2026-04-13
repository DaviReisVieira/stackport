import { useCallback, useState, useEffect } from 'react'
import { useFetch } from '../hooks/useFetch'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useFavorites } from '../hooks/useFavorites'
import { fetchStats } from '../lib/api'
import type { StatsResponse, ServiceStats } from '../lib/types'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getServiceIcon } from '@/lib/service-icons'
import { cn, formatUptime } from '@/lib/utils'
import { RefreshCw, AlertTriangle, Star, LayoutGrid, List } from 'lucide-react'

type ViewMode = 'grid' | 'list'

function getInitialViewMode(): ViewMode {
  const stored = localStorage.getItem('stackport:view-mode')
  return stored === 'list' ? 'list' : 'grid'
}

function formatRelativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full flex-shrink-0',
        status === 'available' ? 'bg-emerald-500' : 'bg-red-500'
      )}
      title={status}
    />
  )
}

export default function Dashboard() {
  const statsFetcher = useCallback(() => fetchStats(), [])
  const { data: stats, error, refresh } = useFetch<StatsResponse>(statsFetcher, 5000)
  const { favorites, toggleFavorite, isFavorite } = useFavorites()
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [, setTick] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode)

  useEffect(() => {
    localStorage.setItem('stackport:view-mode', viewMode)
  }, [viewMode])

  useKeyboardShortcuts([
    { key: 'r', handler: () => refresh() },
    { key: 'v', handler: () => setViewMode((m) => m === 'grid' ? 'list' : 'grid') },
  ])

  useEffect(() => {
    if (stats) setLastUpdated(new Date())
  }, [stats])

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000)
    return () => clearInterval(id)
  }, [])

  // Error state
  if (!stats && error) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-lg font-semibold">Unable to connect</h2>
          <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  // Loading state
  if (!stats) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
          <div className="flex gap-1">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
          </div>
        </div>
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded" />
            ))}
          </div>
        )}
      </div>
    )
  }

  const services = Object.entries(stats.services)

  const favoriteServices = favorites
    .map((favName) => services.find(([name]) => name === favName))
    .filter((s): s is [string, ServiceStats] => s !== undefined)

  const nonFavoriteServices = services
    .filter(([name]) => !favorites.includes(name))
    .sort((a, b) => a[0].localeCompare(b[0]))

  const renderServiceCard = ([name, svc]: [string, ServiceStats]) => {
    const totalRes = Object.values(svc.resources).reduce((a, b) => a + b, 0)
    const Icon = getServiceIcon(name)
    const favorite = isFavorite(name)

    return (
      <Card
        key={name}
        className={cn(
          'transition-all h-full group border-l-2',
          svc.status === 'available' ? 'border-l-emerald-500/40' : 'border-l-red-500/40',
          'hover:border-l-primary hover:shadow-md'
        )}
      >
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <Link to={`/resources/${name}`} className="flex items-center gap-2.5 flex-1 min-w-0">
              <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium truncate">{name}</span>
            </Link>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-6 w-6 transition-opacity',
                  favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
                onClick={(e) => {
                  e.preventDefault()
                  toggleFavorite(name)
                }}
                title={favorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={cn('h-3.5 w-3.5', favorite && 'fill-yellow-500 text-yellow-500')} />
              </Button>
              <StatusDot status={svc.status} />
            </div>
          </div>
        </CardHeader>
        <Link to={`/resources/${name}`}>
          <CardContent className="p-4 pt-0">
            <div className="space-y-1">
              {Object.entries(svc.resources).map(([label, count]) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={count > 0 ? 'text-primary font-medium' : 'text-muted-foreground/50'}>
                    {count}
                  </span>
                </div>
              ))}
              {Object.keys(svc.resources).length === 0 && (
                <div className="text-xs text-muted-foreground/50">No tracked resources</div>
              )}
            </div>
            {totalRes > 0 && (
              <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                {totalRes} total
              </div>
            )}
          </CardContent>
        </Link>
      </Card>
    )
  }

  const renderServiceRow = ([name, svc]: [string, ServiceStats]) => {
    const totalRes = Object.values(svc.resources).reduce((a, b) => a + b, 0)
    const Icon = getServiceIcon(name)
    const favorite = isFavorite(name)
    const resourceSummary = Object.entries(svc.resources)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${count} ${label}`)
      .join(', ')

    return (
      <TableRow key={name} className="group">
        <TableCell className="w-8 px-2">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 transition-opacity',
              favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
            onClick={() => toggleFavorite(name)}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={cn('h-3.5 w-3.5', favorite && 'fill-yellow-500 text-yellow-500')} />
          </Button>
        </TableCell>
        <TableCell>
          <Link to={`/resources/${name}`} className="flex items-center gap-2.5 hover:text-primary transition-colors">
            <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium">{name}</span>
          </Link>
        </TableCell>
        <TableCell className="w-16">
          <StatusDot status={svc.status} />
        </TableCell>
        <TableCell className="text-muted-foreground text-xs">
          {resourceSummary || <span className="text-muted-foreground/50">none</span>}
        </TableCell>
        <TableCell className="w-20 text-right">
          <Badge variant="secondary" className="text-xs tabular-nums">{totalRes}</Badge>
        </TableCell>
      </TableRow>
    )
  }

  const renderSection = (
    title: string,
    items: [string, ServiceStats][],
    showTitle: boolean
  ) => {
    if (items.length === 0) return null

    return (
      <div className="space-y-3">
        {showTitle && (
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
        )}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map(renderServiceCard)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Service</TableHead>
                <TableHead className="w-16">Status</TableHead>
                <TableHead>Resources</TableHead>
                <TableHead className="w-20 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(renderServiceRow)}
            </TableBody>
          </Table>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant="secondary">{services.length} services</Badge>
            <Badge variant="secondary">{stats.total_resources} resources</Badge>
            <Badge variant="secondary">uptime {formatUptime(stats.uptime_seconds)}</Badge>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">
                updated {formatRelativeTime(lastUpdated)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Favorites */}
      {renderSection('Favorites', favoriteServices, favoriteServices.length > 0)}

      {/* All Services */}
      {renderSection(
        'All Services',
        nonFavoriteServices,
        favoriteServices.length > 0
      )}
    </div>
  )
}
