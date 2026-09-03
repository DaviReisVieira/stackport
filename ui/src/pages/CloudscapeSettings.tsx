import { useEffect, useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Checkbox from '@cloudscape-design/components/checkbox'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Modal from '@cloudscape-design/components/modal'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import { toast } from 'sonner'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { useEndpoint } from '@/hooks/useEndpoint'
import {
  addEndpoint,
  deleteEndpoint,
  fetchProfiles,
  setDefaultEndpoint,
  testEndpointConnection,
  updateEndpoint,
} from '@/lib/api'
import type { AuthType, Endpoint } from '@/lib/types'

const AUTH_OPTIONS = [
  { label: 'Default (env vars / instance role)', value: 'default' },
  { label: 'AWS Profile (~/.aws/config)', value: 'profile' },
  { label: 'Static Credentials', value: 'credentials' },
]

interface AuthConfig {
  auth_type: string
  auth_profile: string | null
  auth_access_key_id: string | null
  auth_secret_access_key: string | null
}

function EndpointFormModal({
  mode,
  endpoint,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'edit'
  endpoint: Endpoint | null
  onClose: () => void
  onSubmit: (name: string, url: string | null, region: string | null, auth: AuthConfig) => Promise<void>
}) {
  const isEnvEdit = mode === 'edit' && endpoint?.source === 'env'
  const [name, setName] = useState(endpoint?.name ?? '')
  const [url, setUrl] = useState(endpoint?.url ?? '')
  const [region, setRegion] = useState(endpoint?.region ?? '')
  const [isRealAWS, setIsRealAWS] = useState(endpoint ? endpoint.url === null : false)
  const [authType, setAuthType] = useState<AuthType>(endpoint?.auth_type ?? 'default')
  const [authProfile, setAuthProfile] = useState('')
  const [authAccessKeyId, setAuthAccessKeyId] = useState('')
  const [authSecretAccessKey, setAuthSecretAccessKey] = useState('')
  const [profiles, setProfiles] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ health: string; error?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchProfiles()
      .then(({ profiles: p }) => {
        if (!cancelled) setProfiles(p)
      })
      .catch(() => {
        if (!cancelled) setProfiles([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const effectiveUrl = () => (isEnvEdit ? (endpoint?.url ?? null) : isRealAWS ? null : url.trim() || null)

  const buildAuth = (): AuthConfig => ({
    auth_type: authType,
    auth_profile: authType === 'profile' ? authProfile.trim() || null : null,
    auth_access_key_id: authType === 'credentials' ? authAccessKeyId.trim() || null : null,
    auth_secret_access_key: authType === 'credentials' ? authSecretAccessKey.trim() || null : null,
  })

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testEndpointConnection({
        name: name.trim() || 'test',
        url: effectiveUrl(),
        region: region.trim() || null,
        ...buildAuth(),
      })
      setTestResult({ health: result.health, error: result.error || undefined })
      if (result.health === 'healthy') toast.success('Connection successful')
      else toast.error('Connection failed')
    } catch (error) {
      setTestResult({ health: 'unhealthy', error: String(error) })
      toast.error('Failed to test connection')
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!isEnvEdit && !isRealAWS && !url.trim()) {
      toast.error('URL is required for local endpoints')
      return
    }
    if (authType === 'profile' && !authProfile.trim()) {
      toast.error('Profile name is required')
      return
    }
    if (authType === 'credentials' && (!authAccessKeyId.trim() || !authSecretAccessKey.trim())) {
      toast.error('Both Access Key ID and Secret Access Key are required')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(name.trim(), effectiveUrl(), region.trim() || null, buildAuth())
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={mode === 'add' ? 'Add endpoint' : `Edit ${endpoint?.name}`} size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleSubmit()} loading={submitting} data-testid="endpoint-submit">
              {mode === 'add' ? 'Add endpoint' : 'Update endpoint'}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Name">
            <Input
              value={name}
              onChange={({ detail }) => setName(detail.value)}
              placeholder="e.g., local, ministack, prod"
              disabled={mode === 'edit' || submitting}
              autoFocus={mode === 'add'}
            />
          </FormField>

          <FormField label="Endpoint URL">
            {isEnvEdit ? (
              <Alert type="info">URL is set by environment variable</Alert>
            ) : (
              <SpaceBetween size="xs">
                <Checkbox checked={isRealAWS} onChange={({ detail }) => setIsRealAWS(detail.checked)} disabled={submitting}>
                  Real AWS
                </Checkbox>
                {isRealAWS ? (
                  <Alert type="warning">Will use the configured authentication against real AWS.</Alert>
                ) : (
                  <Input
                    value={url}
                    onChange={({ detail }) => setUrl(detail.value)}
                    placeholder="http://localhost:4566"
                    disabled={submitting}
                    ariaLabel="Endpoint URL"
                  />
                )}
              </SpaceBetween>
            )}
          </FormField>

          <FormField label="Region" description="Leave empty to use the global region setting">
            <Input
              value={region}
              onChange={({ detail }) => setRegion(detail.value)}
              placeholder="e.g., us-east-1"
              disabled={submitting}
            />
          </FormField>

          <FormField label="Authentication">
            <Select
              selectedOption={AUTH_OPTIONS.find((o) => o.value === authType) ?? AUTH_OPTIONS[0]}
              onChange={({ detail }) => setAuthType(detail.selectedOption.value as AuthType)}
              options={AUTH_OPTIONS}
              disabled={submitting}
            />
          </FormField>

          {authType === 'profile' && (
            <FormField label="Profile" description="Supports SSO, AssumeRole, and static credentials configured in ~/.aws/config">
              {profiles.length > 0 ? (
                <Select
                  selectedOption={profiles.includes(authProfile) ? { label: authProfile, value: authProfile } : null}
                  onChange={({ detail }) => setAuthProfile(detail.selectedOption.value as string)}
                  options={profiles.map((p) => ({ label: p, value: p }))}
                  placeholder="Select a profile"
                  disabled={submitting}
                />
              ) : (
                <Input
                  value={authProfile}
                  onChange={({ detail }) => setAuthProfile(detail.value)}
                  placeholder="e.g., prod, nprod"
                  disabled={submitting}
                />
              )}
            </FormField>
          )}

          {authType === 'credentials' && (
            <SpaceBetween size="s">
              <FormField label="Access Key ID">
                <Input
                  value={authAccessKeyId}
                  onChange={({ detail }) => setAuthAccessKeyId(detail.value)}
                  placeholder="AKIA..."
                  disabled={submitting}
                />
              </FormField>
              <FormField label="Secret Access Key">
                <Input
                  value={authSecretAccessKey}
                  onChange={({ detail }) => setAuthSecretAccessKey(detail.value)}
                  type="password"
                  disabled={submitting}
                />
              </FormField>
              <Alert type="warning">
                Credentials are stored locally in ~/.stackport/endpoints.json. Use AWS profiles for better security.
              </Alert>
            </SpaceBetween>
          )}

          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => void handleTest()} loading={testing} disabled={submitting} data-testid="test-connection">
              Test connection
            </Button>
            {testResult &&
              (testResult.health === 'healthy' ? (
                <StatusIndicator type="success">Connected</StatusIndicator>
              ) : (
                <StatusIndicator type="error">Failed</StatusIndicator>
              ))}
          </SpaceBetween>
          {testResult?.error && (
            <Box color="text-body-secondary" fontSize="body-s">
              {testResult.error}
            </Box>
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

function EndpointsPanel() {
  const { endpoints, refresh, setActiveEndpoint } = useEndpoint()
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; endpoint: Endpoint | null } | null>(null)
  const [endpointToDelete, setEndpointToDelete] = useState<Endpoint | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleSetDefault = async (name: string) => {
    try {
      await setDefaultEndpoint(name)
      toast.success(`Default endpoint set to "${name}"`)
      setActiveEndpoint(name)
      refresh()
    } catch (error) {
      toast.error(`Failed to set default: ${error instanceof Error ? error.message : error}`)
    }
  }

  const handleFormSubmit = async (name: string, url: string | null, region: string | null, auth: AuthConfig) => {
    if (form?.mode === 'add') {
      await addEndpoint(name, url, region, auth)
      toast.success(`Endpoint "${name}" added`)
    } else {
      await updateEndpoint(name, url, region, auth)
      toast.success(`Endpoint "${name}" updated`)
    }
    refresh()
  }

  const confirmDelete = async () => {
    if (!endpointToDelete) return
    setDeleting(true)
    try {
      await deleteEndpoint(endpointToDelete.name)
      toast.success(`Endpoint "${endpointToDelete.name}" deleted`)
      refresh()
      setEndpointToDelete(null)
    } catch (error) {
      toast.error(`Failed to delete endpoint: ${error instanceof Error ? error.message : error}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SpaceBetween size="m">
      <Table
        items={endpoints}
        trackBy="name"
        variant="borderless"
        header={
          <Header
            variant="h2"
            counter={`(${endpoints.length})`}
            description="Manage AWS endpoints and local emulators. Switch between endpoints to browse different environments."
            actions={
              <Button variant="primary" iconName="add-plus" onClick={() => setForm({ mode: 'add', endpoint: null })}>
                Add endpoint
              </Button>
            }
          >
            Endpoints
          </Header>
        }
        empty={
          <Box textAlign="center" padding="l">
            <SpaceBetween size="s">
              <Box>No endpoints configured</Box>
              <Button onClick={() => setForm({ mode: 'add', endpoint: null })}>Add endpoint</Button>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: 'default',
            header: '',
            cell: (e) =>
              e.active ? (
                <StatusIndicator type="success">Default</StatusIndicator>
              ) : (
                <Button variant="inline-link" onClick={() => void handleSetDefault(e.name)} ariaLabel={`Set ${e.name} as default`}>
                  Set default
                </Button>
              ),
          },
          { id: 'name', header: 'Name', cell: (e) => e.name },
          {
            id: 'url',
            header: 'URL / Type',
            cell: (e) => (e.url === null ? <Badge color="severity-medium">Real AWS</Badge> : e.url),
          },
          { id: 'region', header: 'Region', cell: (e) => e.region },
          {
            id: 'auth',
            header: 'Auth',
            cell: (e) => (
              <Badge color="grey">{e.auth_type === 'profile' ? 'Profile' : e.auth_type === 'credentials' ? 'Keys' : 'Default'}</Badge>
            ),
          },
          {
            id: 'health',
            header: 'Health',
            cell: (e) =>
              e.health === 'healthy' ? (
                <StatusIndicator type="success">healthy</StatusIndicator>
              ) : e.health === 'unhealthy' ? (
                <StatusIndicator type="error">unhealthy</StatusIndicator>
              ) : (
                <StatusIndicator type="pending">unknown</StatusIndicator>
              ),
          },
          {
            id: 'source',
            header: 'Source',
            cell: (e) => <Badge color={e.source === 'env' ? 'blue' : 'grey'}>{e.source === 'env' ? 'Environment' : 'User'}</Badge>,
          },
          {
            id: 'actions',
            header: 'Actions',
            cell: (e) => (
              <SpaceBetween direction="horizontal" size="xxs">
                <Button variant="icon" iconName="edit" ariaLabel={`Edit endpoint ${e.name}`} onClick={() => setForm({ mode: 'edit', endpoint: e })} />
                <Button
                  variant="icon"
                  iconName="remove"
                  ariaLabel={`Delete endpoint ${e.name}`}
                  disabled={e.source === 'env' || endpoints.length === 1}
                  onClick={() => setEndpointToDelete(e)}
                />
              </SpaceBetween>
            ),
          },
        ]}
      />

      {form && (
        <EndpointFormModal mode={form.mode} endpoint={form.endpoint} onClose={() => setForm(null)} onSubmit={handleFormSubmit} />
      )}

      {endpointToDelete && (
        <Modal
          visible
          onDismiss={() => setEndpointToDelete(null)}
          header="Delete endpoint"
          size="small"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setEndpointToDelete(null)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void confirmDelete()} loading={deleting} data-testid="confirm-delete-endpoint">
                  Delete
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          Are you sure you want to delete the endpoint "{endpointToDelete.name}"? This action cannot be undone.
        </Modal>
      )}
    </SpaceBetween>
  )
}

export default function CloudscapeSettings() {
  return (
    <CloudscapeShell activeHref="/cloudscape/settings">
      <SpaceBetween size="l">
        <Header variant="h1" description="Manage StackPort configuration and preferences">
          Settings
        </Header>
        <Tabs tabs={[{ id: 'endpoints', label: 'Endpoints', content: <EndpointsPanel /> }]} />
      </SpaceBetween>
    </CloudscapeShell>
  )
}
