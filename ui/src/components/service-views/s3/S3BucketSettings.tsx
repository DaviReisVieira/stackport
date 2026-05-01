import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { Plus, Trash2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import {
  fetchS3Versioning,
  putS3Versioning,
  fetchS3Lifecycle,
  putS3Lifecycle,
  fetchS3Notifications,
  putS3Notifications,
  fetchS3CORS,
  putS3CORS,
  fetchResources,
} from '@/lib/api'

const S3_EVENT_TYPES = [
  { group: 'Object Created', events: ['s3:ObjectCreated:*', 's3:ObjectCreated:Put', 's3:ObjectCreated:Post', 's3:ObjectCreated:Copy', 's3:ObjectCreated:CompleteMultipartUpload'] },
  { group: 'Object Removed', events: ['s3:ObjectRemoved:*', 's3:ObjectRemoved:Delete', 's3:ObjectRemoved:DeleteMarkerCreated'] },
  { group: 'Object Restore', events: ['s3:ObjectRestore:Post', 's3:ObjectRestore:Completed'] },
  { group: 'Other', events: ['s3:ReducedRedundancyLostObject', 's3:ObjectTagging:*', 's3:ObjectAcl:Put'] },
]

interface NotificationConfig {
  id: string
  destination_type: string
  destination_arn: string
  events: string[]
  filter_prefix: string
  filter_suffix: string
}

interface CORSRule {
  id: string | null
  allowed_origins: string[]
  allowed_methods: string[]
  allowed_headers: string[]
  expose_headers: string[]
  max_age_seconds: number | null
}

interface LifecycleRule {
  id: string
  prefix: string
  expiration_days: number
  enabled: boolean
}

interface DestinationOption {
  label: string
  arn: string
}

interface Props {
  bucket: string
  endpoint?: string | null
}

export function S3BucketSettings({ bucket, endpoint }: Props) {
  const [versioningStatus, setVersioningStatus] = useState<string>('Disabled')
  const [lifecycleRules, setLifecycleRules] = useState<LifecycleRule[]>([])
  const [notifications, setNotifications] = useState<NotificationConfig[]>([])
  const [corsRules, setCorsRules] = useState<CORSRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Destination ARN cache
  const [destinations, setDestinations] = useState<Record<string, DestinationOption[]>>({})
  const [loadingDestinations, setLoadingDestinations] = useState<Record<string, boolean>>({})

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [v, l, n, c] = await Promise.all([
        fetchS3Versioning(bucket, endpoint).catch(() => ({ status: 'Disabled', mfa_delete: 'Disabled' })),
        fetchS3Lifecycle(bucket, endpoint).catch(() => ({ rules: [] })),
        fetchS3Notifications(bucket, endpoint).catch(() => ({ configurations: [] })),
        fetchS3CORS(bucket, endpoint).catch(() => ({ rules: [] })),
      ])
      setVersioningStatus(v.status)
      setLifecycleRules(l.rules)
      setNotifications(n.configurations)
      setCorsRules(c.rules)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [bucket, endpoint])

  useEffect(() => { void loadSettings() }, [loadSettings])

  const loadDestinations = useCallback(async (type: string) => {
    if (destinations[type] || loadingDestinations[type]) return
    setLoadingDestinations(prev => ({ ...prev, [type]: true }))
    try {
      const serviceMap: Record<string, { service: string; type: string; arnExtractor: (item: Record<string, unknown>) => { label: string; arn: string } }> = {
        Lambda: {
          service: 'lambda',
          type: 'functions',
          arnExtractor: (item) => ({
            label: (item.FunctionName as string) || (item.id as string),
            arn: (item.FunctionArn as string) || `arn:aws:lambda:::function:${item.id}`,
          }),
        },
        SQS: {
          service: 'sqs',
          type: 'queues',
          arnExtractor: (item) => {
            const url = item.id as string
            const parts = url.replace(/https?:\/\//, '').split('/')
            const accountId = parts[1] || '000000000000'
            const queueName = parts[2] || url.split('/').pop() || url
            return {
              label: queueName,
              arn: `arn:aws:sqs:us-east-1:${accountId}:${queueName}`,
            }
          },
        },
        SNS: {
          service: 'sns',
          type: 'topics',
          arnExtractor: (item) => ({
            label: (item.id as string).split(':').pop() || (item.id as string),
            arn: item.id as string,
          }),
        },
      }
      const config = serviceMap[type]
      if (!config) return
      const resp = await fetchResources(config.service, config.type, endpoint)
      const items = resp.resources[config.type] || []
      const options = items.map(item => config.arnExtractor(item as Record<string, unknown>))
      setDestinations(prev => ({ ...prev, [type]: options }))
    } catch {
      setDestinations(prev => ({ ...prev, [type]: [] }))
    } finally {
      setLoadingDestinations(prev => ({ ...prev, [type]: false }))
    }
  }, [destinations, loadingDestinations, endpoint])

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {/* Versioning */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Versioning</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Bucket Versioning</div>
              <div className="text-xs text-muted-foreground">
                Keep multiple versions of each object
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={versioningStatus === 'Enabled' ? 'default' : 'secondary'}>
                {versioningStatus}
              </Badge>
              <Switch
                checked={versioningStatus === 'Enabled'}
                onCheckedChange={async (checked) => {
                  const newStatus = checked ? 'Enabled' : 'Suspended'
                  try {
                    await putS3Versioning(bucket, newStatus, endpoint)
                    setVersioningStatus(newStatus)
                    toast.success(`Versioning ${newStatus.toLowerCase()}`)
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to update versioning')
                  }
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lifecycle Rules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Lifecycle Rules</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLifecycleRules([...lifecycleRules, {
                id: `rule-${Date.now()}`,
                prefix: '',
                expiration_days: 30,
                enabled: true,
              }])
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Rule
          </Button>
        </CardHeader>
        <CardContent>
          {lifecycleRules.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No lifecycle rules configured
            </div>
          ) : (
            <div className="space-y-3">
              {lifecycleRules.map((rule, idx) => (
                <div key={rule.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Prefix filter</Label>
                      <Input
                        value={rule.prefix}
                        onChange={(e) => {
                          const updated = [...lifecycleRules]
                          updated[idx] = { ...updated[idx], prefix: e.target.value }
                          setLifecycleRules(updated)
                        }}
                        placeholder="(all objects)"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Expire after (days)</Label>
                      <Input
                        type="number"
                        min="1"
                        value={rule.expiration_days}
                        onChange={(e) => {
                          const updated = [...lifecycleRules]
                          updated[idx] = { ...updated[idx], expiration_days: parseInt(e.target.value) || 1 }
                          setLifecycleRules(updated)
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(checked) => {
                            const updated = [...lifecycleRules]
                            updated[idx] = { ...updated[idx], enabled: checked }
                            setLifecycleRules(updated)
                          }}
                        />
                        <span className="text-xs text-muted-foreground">Enabled</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setLifecycleRules(lifecycleRules.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await putS3Lifecycle(
                      bucket,
                      lifecycleRules.map(r => ({ id: r.id, prefix: r.prefix, expirationDays: r.expiration_days, enabled: r.enabled })),
                      endpoint
                    )
                    toast.success('Lifecycle rules saved')
                    await loadSettings()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to save lifecycle rules')
                  }
                }}
              >
                Save Rules
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Event Notifications</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setNotifications([...notifications, {
                id: `notif-${Date.now()}`,
                destination_type: 'Lambda',
                destination_arn: '',
                events: ['s3:ObjectCreated:*'],
                filter_prefix: '',
                filter_suffix: '',
              }])
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Notification
          </Button>
        </CardHeader>
        <CardContent>
          {notifications.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No event notifications configured
            </div>
          ) : (
            <div className="space-y-4">
              {notifications.map((n, idx) => (
                <NotificationEditor
                  key={n.id}
                  notification={n}
                  destinations={destinations}
                  loadingDestinations={loadingDestinations}
                  onLoadDestinations={loadDestinations}
                  onChange={(updated) => {
                    const newList = [...notifications]
                    newList[idx] = updated
                    setNotifications(newList)
                  }}
                  onDelete={() => setNotifications(notifications.filter((_, i) => i !== idx))}
                />
              ))}
              <Button
                size="sm"
                onClick={async () => {
                  const invalid = notifications.find(n => !n.destination_arn)
                  if (invalid) {
                    toast.error('All notifications must have a destination ARN')
                    return
                  }
                  try {
                    await putS3Notifications(
                      bucket,
                      notifications.map(n => ({
                        id: n.id,
                        destinationType: n.destination_type,
                        destinationArn: n.destination_arn,
                        events: n.events,
                        filterPrefix: n.filter_prefix,
                        filterSuffix: n.filter_suffix,
                      })),
                      endpoint
                    )
                    toast.success('Notifications saved')
                    await loadSettings()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to save notifications')
                  }
                }}
              >
                Save Notifications
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CORS */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">CORS Configuration</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCorsRules([...corsRules, {
                id: `cors-${Date.now()}`,
                allowed_origins: ['*'],
                allowed_methods: ['GET'],
                allowed_headers: ['*'],
                expose_headers: [],
                max_age_seconds: 3600,
              }])
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Rule
          </Button>
        </CardHeader>
        <CardContent>
          {corsRules.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No CORS rules configured
            </div>
          ) : (
            <div className="space-y-3">
              {corsRules.map((rule, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Allowed Origins (comma-separated)</Label>
                      <Input
                        value={rule.allowed_origins.join(', ')}
                        onChange={(e) => {
                          const updated = [...corsRules]
                          updated[idx] = { ...updated[idx], allowed_origins: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }
                          setCorsRules(updated)
                        }}
                        placeholder="*"
                        className="h-8 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Allowed Methods</Label>
                      <CORSMethodsSelect
                        value={rule.allowed_methods}
                        onChange={(methods) => {
                          const updated = [...corsRules]
                          updated[idx] = { ...updated[idx], allowed_methods: methods }
                          setCorsRules(updated)
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Allowed Headers (comma-separated)</Label>
                      <Input
                        value={rule.allowed_headers.join(', ')}
                        onChange={(e) => {
                          const updated = [...corsRules]
                          updated[idx] = { ...updated[idx], allowed_headers: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }
                          setCorsRules(updated)
                        }}
                        placeholder="*"
                        className="h-8 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Max Age (seconds)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={rule.max_age_seconds ?? ''}
                        onChange={(e) => {
                          const updated = [...corsRules]
                          updated[idx] = { ...updated[idx], max_age_seconds: e.target.value ? parseInt(e.target.value) : null }
                          setCorsRules(updated)
                        }}
                        placeholder="3600"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive mt-4"
                    onClick={() => setCorsRules(corsRules.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                onClick={async () => {
                  const invalid = corsRules.find(r => r.allowed_origins.length === 0 || r.allowed_methods.length === 0)
                  if (invalid) {
                    toast.error('Each CORS rule must have at least one origin and method')
                    return
                  }
                  try {
                    await putS3CORS(
                      bucket,
                      corsRules.map(r => ({
                        id: r.id ?? undefined,
                        allowedOrigins: r.allowed_origins,
                        allowedMethods: r.allowed_methods,
                        allowedHeaders: r.allowed_headers,
                        exposeHeaders: r.expose_headers,
                        maxAgeSeconds: r.max_age_seconds ?? undefined,
                      })),
                      endpoint
                    )
                    toast.success('CORS configuration saved')
                    await loadSettings()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to save CORS')
                  }
                }}
              >
                Save CORS
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// --- Sub-components ---

const HTTP_METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'] as const

function CORSMethodsSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        className="h-8 w-full justify-between text-sm font-mono"
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{value.length > 0 ? value.join(', ') : 'Select methods'}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 ml-2 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 ml-2 shrink-0" />}
      </Button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-2 shadow-md">
          {HTTP_METHODS.map((method) => (
            <label key={method} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer">
              <Checkbox
                checked={value.includes(method)}
                onCheckedChange={(checked) => {
                  if (checked) onChange([...value, method])
                  else onChange(value.filter(m => m !== method))
                }}
              />
              <span className="text-sm font-mono">{method}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function NotificationEditor({
  notification,
  destinations,
  loadingDestinations,
  onLoadDestinations,
  onChange,
  onDelete,
}: {
  notification: NotificationConfig
  destinations: Record<string, DestinationOption[]>
  loadingDestinations: Record<string, boolean>
  onLoadDestinations: (type: string) => void
  onChange: (n: NotificationConfig) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(!notification.destination_arn)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [arnDropdownOpen, setArnDropdownOpen] = useState(false)
  const arnInputRef = useRef<HTMLInputElement>(null)

  const typeOptions = destinations[notification.destination_type] || []
  const isLoadingDest = loadingDestinations[notification.destination_type] || false

  useEffect(() => {
    if (arnDropdownOpen) {
      onLoadDestinations(notification.destination_type)
    }
  }, [arnDropdownOpen, notification.destination_type, onLoadDestinations])

  if (!expanded) {
    return (
      <div className="flex items-center gap-3 p-3 border rounded-lg">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{notification.destination_type}</Badge>
            <span className="text-sm font-mono truncate">{notification.destination_arn || '(no destination)'}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {notification.events.join(', ')}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <div className="p-3 border rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Notification: {notification.id}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
            Collapse
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Destination Type</Label>
          <Select
            value={notification.destination_type}
            onValueChange={(v) => onChange({ ...notification, destination_type: v, destination_arn: '' })}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Lambda">Lambda Function</SelectItem>
              <SelectItem value="SQS">SQS Queue</SelectItem>
              <SelectItem value="SNS">SNS Topic</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative">
          <Label className="text-xs">Destination ARN</Label>
          <div className="relative">
            <Input
              ref={arnInputRef}
              value={notification.destination_arn}
              onChange={(e) => onChange({ ...notification, destination_arn: e.target.value })}
              onFocus={() => setArnDropdownOpen(true)}
              onBlur={() => setTimeout(() => setArnDropdownOpen(false), 200)}
              placeholder={`Select or type ${notification.destination_type} ARN`}
              className="h-8 text-sm font-mono pr-8"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-8 w-8"
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); setArnDropdownOpen(!arnDropdownOpen) }}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          {arnDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-md">
              {isLoadingDest ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
              ) : typeOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No {notification.destination_type} resources found. Type an ARN manually.
                </div>
              ) : (
                typeOptions
                  .filter(opt => !notification.destination_arn || opt.arn.toLowerCase().includes(notification.destination_arn.toLowerCase()) || opt.label.toLowerCase().includes(notification.destination_arn.toLowerCase()))
                  .map((opt) => (
                    <button
                      key={opt.arn}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm cursor-pointer"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onChange({ ...notification, destination_arn: opt.arn })
                        setArnDropdownOpen(false)
                      }}
                    >
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{opt.arn}</div>
                    </button>
                  ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Events multi-select */}
      <div>
        <Label className="text-xs">Events</Label>
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            className="h-8 w-full justify-between text-sm"
            onClick={() => setEventsOpen(!eventsOpen)}
          >
            <span className="truncate">
              {notification.events.length > 0
                ? notification.events.length <= 2
                  ? notification.events.join(', ')
                  : `${notification.events.length} events selected`
                : 'Select events'}
            </span>
            {eventsOpen ? <ChevronUp className="h-3.5 w-3.5 ml-2 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 ml-2 shrink-0" />}
          </Button>
          {eventsOpen && (
            <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover p-2 shadow-md">
              {S3_EVENT_TYPES.map((group) => (
                <div key={group.group} className="mb-2">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1">{group.group}</div>
                  {group.events.map((event) => (
                    <label key={event} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer">
                      <Checkbox
                        checked={notification.events.includes(event)}
                        onCheckedChange={(checked) => {
                          const events = checked
                            ? [...notification.events, event]
                            : notification.events.filter(e => e !== event)
                          onChange({ ...notification, events })
                        }}
                      />
                      <span className="text-xs font-mono">{event}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {notification.events.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {notification.events.map((event) => (
              <Badge key={event} variant="secondary" className="text-xs font-mono">
                {event}
                <button
                  type="button"
                  className="ml-1 hover:text-destructive"
                  onClick={() => onChange({ ...notification, events: notification.events.filter(e => e !== event) })}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Filter Prefix (optional)</Label>
          <Input
            value={notification.filter_prefix}
            onChange={(e) => onChange({ ...notification, filter_prefix: e.target.value })}
            placeholder="images/"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Filter Suffix (optional)</Label>
          <Input
            value={notification.filter_suffix}
            onChange={(e) => onChange({ ...notification, filter_suffix: e.target.value })}
            placeholder=".jpg"
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  )
}
