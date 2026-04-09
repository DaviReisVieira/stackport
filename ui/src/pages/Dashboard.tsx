import { useCallback, useState, useEffect } from 'react'
import { useFetch } from '../hooks/useFetch'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { fetchStats } from '../lib/api'
import type { StatsResponse } from '../lib/types'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getServiceIcon } from '@/lib/service-icons'
import { RefreshCw, AlertTriangle } from 'lucide-react'

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatRelativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === 'available' ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">
      {status}
    </Badge>
  )
}

export default function Dashboard() {
  const statsFetcher = useCallback(() => fetchStats(), [])
  const { data: stats, error, refresh } = useFetch<StatsResponse>(statsFetcher, 5000)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [, setTick] = useState(0)

  // Page-level keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'r', handler: () => refresh() },
  ])

  useEffect(() => {
    if (stats) setLastUpdated(new Date())
  }, [stats])

  // Update relative time display every 10s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000)
    return () => clearInterval(id)
  }, [])

  // Error state — backend unreachable
  if (!stats && error) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-lg font-semibold">Unable to connect</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {error}
          </p>
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
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const services = Object.entries(stats.services)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {services.length} services | {stats.total_resources} resources | uptime {formatUptime(stats.uptime_seconds)}
            {lastUpdated && (
              <span className="ml-2">| updated {formatRelativeTime(lastUpdated)}</span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Service Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {services.map(([name, svc]) => {
          const totalRes = Object.values(svc.resources).reduce((a, b) => a + b, 0)
          const Icon = getServiceIcon(name)
          return (
            <Link key={name} to={`/resources/${name}`}>
              <Card className="hover:bg-accent/50 transition-colors h-full">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-medium">{name}</CardTitle>
                    </div>
                    <StatusBadge status={svc.status} />
                  </div>
                </CardHeader>
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
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
