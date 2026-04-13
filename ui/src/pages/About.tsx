import { useCallback } from 'react'
import { useFetch } from '../hooks/useFetch'
import { fetchHealth } from '../lib/api'
import type { HealthResponse } from '../lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatUptime } from '@/lib/utils'
import { Info, ExternalLink, RefreshCw, AlertTriangle, Globe, GitFork, Bug } from 'lucide-react'

const LINKS = [
  {
    label: 'GitHub Repository',
    url: 'https://github.com/DaviReisVieira/stackport',
    icon: GitFork,
  },
  {
    label: 'Report an Issue',
    url: 'https://github.com/DaviReisVieira/stackport/issues',
    icon: Bug,
  },
]

export default function About() {
  const healthFetcher = useCallback(() => fetchHealth(), [])
  const { data: health, error, refresh } = useFetch<HealthResponse>(healthFetcher, 10000)

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-destructive mb-4">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-medium">Failed to load system info</span>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          Retry
        </Button>
      </div>
    )
  }

  if (!health) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-8" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Info className="h-6 w-6 text-muted-foreground" />
            About
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            System information and project details
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Project Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm font-medium">StackPort</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Version</span>
              <Badge variant="secondary">{health.version}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">License</span>
              <span className="text-sm">MIT</span>
            </div>
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Universal AWS resource browser for local emulators
            </p>
          </CardContent>
        </Card>

        {/* Connection Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Endpoint</span>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{health.endpoint_url}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Region</span>
              <span className="text-sm">{health.region}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Services</span>
              <span className="text-sm">{health.services_count}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Uptime</span>
              <span className="text-sm">{formatUptime(health.uptime_seconds)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={health.status === 'ok' ? 'default' : 'destructive'}>{health.status}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Links Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {LINKS.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 -mx-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <link.icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{link.label}</span>
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
              </a>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
