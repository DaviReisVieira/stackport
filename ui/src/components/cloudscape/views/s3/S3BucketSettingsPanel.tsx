import { useCallback, useEffect, useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Autosuggest from '@cloudscape-design/components/autosuggest'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Multiselect from '@cloudscape-design/components/multiselect'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Toggle from '@cloudscape-design/components/toggle'
import { toast } from 'sonner'
import {
  fetchResources,
  fetchS3CORS,
  fetchS3Lifecycle,
  fetchS3Notifications,
  fetchS3Versioning,
  putS3CORS,
  putS3Lifecycle,
  putS3Notifications,
  putS3Versioning,
} from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'

const S3_EVENT_TYPES = [
  { group: 'Object Created', events: ['s3:ObjectCreated:*', 's3:ObjectCreated:Put', 's3:ObjectCreated:Post', 's3:ObjectCreated:Copy', 's3:ObjectCreated:CompleteMultipartUpload'] },
  { group: 'Object Removed', events: ['s3:ObjectRemoved:*', 's3:ObjectRemoved:Delete', 's3:ObjectRemoved:DeleteMarkerCreated'] },
  { group: 'Object Restore', events: ['s3:ObjectRestore:Post', 's3:ObjectRestore:Completed'] },
  { group: 'Other', events: ['s3:ReducedRedundancyLostObject', 's3:ObjectTagging:*', 's3:ObjectAcl:Put'] },
]

const EVENT_OPTIONS = S3_EVENT_TYPES.map((group) => ({
  label: group.group,
  options: group.events.map((event) => ({ label: event, value: event })),
}))

const HTTP_METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'] as const
const METHOD_OPTIONS = HTTP_METHODS.map((m) => ({ label: m, value: m }))

const DESTINATION_TYPES = [
  { label: 'Lambda function', value: 'Lambda' },
  { label: 'SQS queue', value: 'SQS' },
  { label: 'SNS topic', value: 'SNS' },
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

const DESTINATION_SOURCES: Record<string, { service: string; type: string; toOption: (item: Record<string, unknown>) => DestinationOption }> = {
  Lambda: {
    service: 'lambda',
    type: 'functions',
    toOption: (item) => ({
      label: (item.FunctionName as string) || (item.id as string),
      arn: (item.FunctionArn as string) || `arn:aws:lambda:::function:${item.id}`,
    }),
  },
  SQS: {
    service: 'sqs',
    type: 'queues',
    toOption: (item) => {
      const url = item.id as string
      const parts = url.replace(/https?:\/\//, '').split('/')
      const accountId = parts[1] || '000000000000'
      const queueName = parts[2] || url.split('/').pop() || url
      return { label: queueName, arn: `arn:aws:sqs:us-east-1:${accountId}:${queueName}` }
    },
  },
  SNS: {
    service: 'sns',
    type: 'topics',
    toOption: (item) => ({
      label: (item.id as string).split(':').pop() || (item.id as string),
      arn: item.id as string,
    }),
  },
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
  const typeOptions = destinations[notification.destination_type] ?? []
  const isLoadingDest = loadingDestinations[notification.destination_type] ?? false

  return (
    <ExpandableSection
      defaultExpanded={!notification.destination_arn}
      headerText={notification.destination_arn ? `${notification.destination_type}: ${notification.destination_arn}` : `New ${notification.destination_type} notification`}
      headerActions={
        <Button variant="icon" iconName="remove" ariaLabel={`Delete notification ${notification.id}`} onClick={onDelete} />
      }
      variant="container"
    >
      <SpaceBetween size="m">
        <ColumnLayout columns={2}>
          <FormField label="Destination type">
            <Select
              selectedOption={DESTINATION_TYPES.find((o) => o.value === notification.destination_type) ?? DESTINATION_TYPES[0]}
              onChange={({ detail }) =>
                onChange({ ...notification, destination_type: detail.selectedOption.value as string, destination_arn: '' })
              }
              options={DESTINATION_TYPES}
            />
          </FormField>
          <FormField label="Destination ARN">
            <Autosuggest
              value={notification.destination_arn}
              onChange={({ detail }) => onChange({ ...notification, destination_arn: detail.value })}
              onFocus={() => onLoadDestinations(notification.destination_type)}
              options={typeOptions.map((opt) => ({ value: opt.arn, label: opt.label, description: opt.arn }))}
              statusType={isLoadingDest ? 'loading' : 'finished'}
              loadingText="Loading resources"
              placeholder={`Select or type ${notification.destination_type} ARN`}
              empty={`No ${notification.destination_type} resources found. Type an ARN manually.`}
              enteredTextLabel={(value) => `Use "${value}"`}
              ariaLabel="Destination ARN"
            />
          </FormField>
        </ColumnLayout>
        <FormField label="Events">
          <Multiselect
            selectedOptions={notification.events.map((e) => ({ label: e, value: e }))}
            onChange={({ detail }) =>
              onChange({ ...notification, events: detail.selectedOptions.map((o) => o.value as string) })
            }
            options={EVENT_OPTIONS}
            placeholder="Select events"
            ariaLabel="Notification events"
          />
        </FormField>
        <ColumnLayout columns={2}>
          <FormField label="Filter prefix" description="Optional">
            <Input
              value={notification.filter_prefix}
              onChange={({ detail }) => onChange({ ...notification, filter_prefix: detail.value })}
              placeholder="images/"
            />
          </FormField>
          <FormField label="Filter suffix" description="Optional">
            <Input
              value={notification.filter_suffix}
              onChange={({ detail }) => onChange({ ...notification, filter_suffix: detail.value })}
              placeholder=".jpg"
            />
          </FormField>
        </ColumnLayout>
      </SpaceBetween>
    </ExpandableSection>
  )
}

export function S3BucketSettingsPanel({ bucket }: { bucket: string }) {
  const { activeEndpoint } = useEndpoint()
  const [versioningStatus, setVersioningStatus] = useState<string>('Disabled')
  const [lifecycleRules, setLifecycleRules] = useState<LifecycleRule[]>([])
  const [notifications, setNotifications] = useState<NotificationConfig[]>([])
  const [corsRules, setCorsRules] = useState<CORSRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [destinations, setDestinations] = useState<Record<string, DestinationOption[]>>({})
  const [loadingDestinations, setLoadingDestinations] = useState<Record<string, boolean>>({})

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [v, l, n, c] = await Promise.all([
        fetchS3Versioning(bucket, activeEndpoint).catch(() => ({ status: 'Disabled', mfa_delete: 'Disabled' })),
        fetchS3Lifecycle(bucket, activeEndpoint).catch(() => ({ rules: [] })),
        fetchS3Notifications(bucket, activeEndpoint).catch(() => ({ configurations: [] })),
        fetchS3CORS(bucket, activeEndpoint).catch(() => ({ rules: [] })),
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
  }, [bucket, activeEndpoint])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const loadDestinations = useCallback(
    async (type: string) => {
      if (destinations[type] || loadingDestinations[type]) return
      setLoadingDestinations((prev) => ({ ...prev, [type]: true }))
      try {
        const source = DESTINATION_SOURCES[type]
        if (!source) return
        const resp = await fetchResources(source.service, source.type, activeEndpoint)
        const items = resp.resources[source.type] || []
        setDestinations((prev) => ({ ...prev, [type]: items.map((item) => source.toOption(item as Record<string, unknown>)) }))
      } catch {
        setDestinations((prev) => ({ ...prev, [type]: [] }))
      } finally {
        setLoadingDestinations((prev) => ({ ...prev, [type]: false }))
      }
    },
    [destinations, loadingDestinations, activeEndpoint],
  )

  const toggleVersioning = async (checked: boolean) => {
    const newStatus = checked ? 'Enabled' : 'Suspended'
    try {
      await putS3Versioning(bucket, newStatus, activeEndpoint)
      setVersioningStatus(newStatus)
      toast.success(`Versioning ${newStatus.toLowerCase()}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update versioning')
    }
  }

  const saveLifecycle = async () => {
    setSaving('lifecycle')
    try {
      await putS3Lifecycle(
        bucket,
        lifecycleRules.map((r) => ({ id: r.id, prefix: r.prefix, expirationDays: r.expiration_days, enabled: r.enabled })),
        activeEndpoint,
      )
      toast.success('Lifecycle rules saved')
      await loadSettings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save lifecycle rules')
    } finally {
      setSaving(null)
    }
  }

  const saveNotifications = async () => {
    if (notifications.some((n) => !n.destination_arn)) {
      toast.error('All notifications must have a destination ARN')
      return
    }
    setSaving('notifications')
    try {
      await putS3Notifications(
        bucket,
        notifications.map((n) => ({
          id: n.id,
          destinationType: n.destination_type,
          destinationArn: n.destination_arn,
          events: n.events,
          filterPrefix: n.filter_prefix,
          filterSuffix: n.filter_suffix,
        })),
        activeEndpoint,
      )
      toast.success('Notifications saved')
      await loadSettings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notifications')
    } finally {
      setSaving(null)
    }
  }

  const saveCors = async () => {
    if (corsRules.some((r) => r.allowed_origins.length === 0 || r.allowed_methods.length === 0)) {
      toast.error('Each CORS rule must have at least one origin and method')
      return
    }
    setSaving('cors')
    try {
      await putS3CORS(
        bucket,
        corsRules.map((r) => ({
          id: r.id ?? undefined,
          allowedOrigins: r.allowed_origins,
          allowedMethods: r.allowed_methods,
          allowedHeaders: r.allowed_headers,
          exposeHeaders: r.expose_headers,
          maxAgeSeconds: r.max_age_seconds ?? undefined,
        })),
        activeEndpoint,
      )
      toast.success('CORS configuration saved')
      await loadSettings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save CORS')
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <StatusIndicator type="loading">Loading bucket settings</StatusIndicator>
  if (error) {
    return (
      <Alert type="error" header="Could not load settings" action={<Button onClick={() => void loadSettings()}>Retry</Button>}>
        {error}
      </Alert>
    )
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h3">Versioning</Header>}>
        <SpaceBetween direction="horizontal" size="m" alignItems="center">
          <Toggle checked={versioningStatus === 'Enabled'} onChange={({ detail }) => void toggleVersioning(detail.checked)}>
            Bucket versioning
          </Toggle>
          <Badge color={versioningStatus === 'Enabled' ? 'green' : 'grey'}>{versioningStatus}</Badge>
        </SpaceBetween>
        <Box color="text-body-secondary" fontSize="body-s" margin={{ top: 'xs' }}>
          Keep multiple versions of each object
        </Box>
      </Container>

      <Container
        header={
          <Header
            variant="h3"
            actions={
              <Button
                iconName="add-plus"
                onClick={() =>
                  setLifecycleRules([
                    ...lifecycleRules,
                    { id: `rule-${Date.now()}`, prefix: '', expiration_days: 30, enabled: true },
                  ])
                }
              >
                Add rule
              </Button>
            }
          >
            Lifecycle rules
          </Header>
        }
      >
        {lifecycleRules.length === 0 ? (
          <Box color="text-status-inactive" textAlign="center" padding="m">
            No lifecycle rules configured
          </Box>
        ) : (
          <SpaceBetween size="m">
            {lifecycleRules.map((rule, idx) => (
              <ColumnLayout key={rule.id} columns={4}>
                <FormField label="Prefix filter">
                  <Input
                    value={rule.prefix}
                    onChange={({ detail }) =>
                      setLifecycleRules(lifecycleRules.map((r, i) => (i === idx ? { ...r, prefix: detail.value } : r)))
                    }
                    placeholder="(all objects)"
                  />
                </FormField>
                <FormField label="Expire after (days)">
                  <Input
                    type="number"
                    value={String(rule.expiration_days)}
                    onChange={({ detail }) =>
                      setLifecycleRules(
                        lifecycleRules.map((r, i) => (i === idx ? { ...r, expiration_days: parseInt(detail.value) || 1 } : r)),
                      )
                    }
                  />
                </FormField>
                <FormField label="Status">
                  <Toggle
                    checked={rule.enabled}
                    onChange={({ detail }) =>
                      setLifecycleRules(lifecycleRules.map((r, i) => (i === idx ? { ...r, enabled: detail.checked } : r)))
                    }
                  >
                    Enabled
                  </Toggle>
                </FormField>
                <FormField label="&nbsp;">
                  <Button
                    variant="icon"
                    iconName="remove"
                    ariaLabel={`Delete lifecycle rule ${rule.id}`}
                    onClick={() => setLifecycleRules(lifecycleRules.filter((_, i) => i !== idx))}
                  />
                </FormField>
              </ColumnLayout>
            ))}
            <Button variant="primary" onClick={() => void saveLifecycle()} loading={saving === 'lifecycle'} data-testid="save-lifecycle">
              Save rules
            </Button>
          </SpaceBetween>
        )}
      </Container>

      <Container
        header={
          <Header
            variant="h3"
            actions={
              <Button
                iconName="add-plus"
                onClick={() =>
                  setNotifications([
                    ...notifications,
                    {
                      id: `notif-${Date.now()}`,
                      destination_type: 'Lambda',
                      destination_arn: '',
                      events: ['s3:ObjectCreated:*'],
                      filter_prefix: '',
                      filter_suffix: '',
                    },
                  ])
                }
              >
                Add notification
              </Button>
            }
          >
            Event notifications
          </Header>
        }
      >
        {notifications.length === 0 ? (
          <Box color="text-status-inactive" textAlign="center" padding="m">
            No event notifications configured
          </Box>
        ) : (
          <SpaceBetween size="m">
            {notifications.map((n, idx) => (
              <NotificationEditor
                key={n.id}
                notification={n}
                destinations={destinations}
                loadingDestinations={loadingDestinations}
                onLoadDestinations={(type) => void loadDestinations(type)}
                onChange={(updated) => setNotifications(notifications.map((item, i) => (i === idx ? updated : item)))}
                onDelete={() => setNotifications(notifications.filter((_, i) => i !== idx))}
              />
            ))}
            <Button
              variant="primary"
              onClick={() => void saveNotifications()}
              loading={saving === 'notifications'}
              data-testid="save-notifications"
            >
              Save notifications
            </Button>
          </SpaceBetween>
        )}
      </Container>

      <Container
        header={
          <Header
            variant="h3"
            actions={
              <Button
                iconName="add-plus"
                onClick={() =>
                  setCorsRules([
                    ...corsRules,
                    {
                      id: `cors-${Date.now()}`,
                      allowed_origins: ['*'],
                      allowed_methods: ['GET'],
                      allowed_headers: ['*'],
                      expose_headers: [],
                      max_age_seconds: 3600,
                    },
                  ])
                }
              >
                Add rule
              </Button>
            }
          >
            CORS configuration
          </Header>
        }
      >
        {corsRules.length === 0 ? (
          <Box color="text-status-inactive" textAlign="center" padding="m">
            No CORS rules configured
          </Box>
        ) : (
          <SpaceBetween size="m">
            {corsRules.map((rule, idx) => (
              <SpaceBetween key={rule.id ?? idx} size="s">
                <ColumnLayout columns={2}>
                  <FormField label="Allowed origins" description="Comma-separated">
                    <Input
                      value={rule.allowed_origins.join(', ')}
                      onChange={({ detail }) =>
                        setCorsRules(
                          corsRules.map((r, i) =>
                            i === idx
                              ? { ...r, allowed_origins: detail.value.split(',').map((s) => s.trim()).filter(Boolean) }
                              : r,
                          ),
                        )
                      }
                      placeholder="*"
                    />
                  </FormField>
                  <FormField label="Allowed methods">
                    <Multiselect
                      selectedOptions={rule.allowed_methods.map((m) => ({ label: m, value: m }))}
                      onChange={({ detail }) =>
                        setCorsRules(
                          corsRules.map((r, i) =>
                            i === idx ? { ...r, allowed_methods: detail.selectedOptions.map((o) => o.value as string) } : r,
                          ),
                        )
                      }
                      options={METHOD_OPTIONS}
                      placeholder="Select methods"
                      ariaLabel="Allowed methods"
                    />
                  </FormField>
                  <FormField label="Allowed headers" description="Comma-separated">
                    <Input
                      value={rule.allowed_headers.join(', ')}
                      onChange={({ detail }) =>
                        setCorsRules(
                          corsRules.map((r, i) =>
                            i === idx
                              ? { ...r, allowed_headers: detail.value.split(',').map((s) => s.trim()).filter(Boolean) }
                              : r,
                          ),
                        )
                      }
                      placeholder="*"
                    />
                  </FormField>
                  <FormField label="Max age (seconds)">
                    <Input
                      type="number"
                      value={rule.max_age_seconds !== null ? String(rule.max_age_seconds) : ''}
                      onChange={({ detail }) =>
                        setCorsRules(
                          corsRules.map((r, i) =>
                            i === idx ? { ...r, max_age_seconds: detail.value ? parseInt(detail.value) : null } : r,
                          ),
                        )
                      }
                      placeholder="3600"
                    />
                  </FormField>
                </ColumnLayout>
                <Button
                  variant="icon"
                  iconName="remove"
                  ariaLabel={`Delete CORS rule ${idx + 1}`}
                  onClick={() => setCorsRules(corsRules.filter((_, i) => i !== idx))}
                />
              </SpaceBetween>
            ))}
            <Button variant="primary" onClick={() => void saveCors()} loading={saving === 'cors'} data-testid="save-cors">
              Save CORS
            </Button>
          </SpaceBetween>
        )}
      </Container>
    </SpaceBetween>
  )
}
