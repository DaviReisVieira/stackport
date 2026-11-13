import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Checkbox from '@cloudscape-design/components/checkbox'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import LiveRegion from '@cloudscape-design/components/live-region'
import Input from '@cloudscape-design/components/input'
import Modal from '@cloudscape-design/components/modal'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import Toggle from '@cloudscape-design/components/toggle'
import { toast } from 'sonner'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { ConnectionCheckSummary } from '@/components/cloudscape/ConnectionCheckSummary'
import { useEndpoint } from '@/hooks/useEndpoint'
import {
  addEndpoint,
  deleteEndpoint,
  fetchProfiles,
  setDefaultEndpoint,
  testEndpointConnection,
  updateEndpoint,
} from '@/lib/api'
import type { AuthType, ConnectionCheck, Endpoint, EndpointConnectionSettings } from '@/lib/types'
import { isHttpsUrl } from '@/lib/utils'

const AUTH_OPTIONS: ReadonlyArray<{ label: string; value: AuthType }> = [
  { label: 'Default (env vars / instance role)', value: 'default' },
  { label: 'AWS Profile (~/.aws/config)', value: 'profile' },
  { label: 'Static Credentials', value: 'credentials' },
]

const URL_EXAMPLE = 'http://localhost:4566'

/** Why `value` can't be an endpoint URL, or null when it can. */
function endpointUrlProblem(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return `Enter the endpoint URL, for example ${URL_EXAMPLE}.`
  let protocol: string
  try {
    protocol = new URL(trimmed).protocol
  } catch {
    return `Enter a full URL, for example ${URL_EXAMPLE}.`
  }
  if (protocol !== 'http:' && protocol !== 'https:') return 'The URL must start with http:// or https://.'
  return null
}

type TestOutcome = { kind: 'checked'; check: ConnectionCheck } | { kind: 'failed'; message: string }

function EndpointFormModal({
  mode,
  endpoint,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'edit'
  endpoint: Endpoint | null
  onClose: () => void
  onSubmit: (name: string, url: string | null, region: string | null, settings: EndpointConnectionSettings) => Promise<void>
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
  // Unlike credentials, TLS settings aren't secret, so editing starts from the saved values
  const [tlsVerify, setTlsVerify] = useState(endpoint?.tls_verify ?? true)
  const [caBundle, setCaBundle] = useState(endpoint?.ca_bundle ?? '')
  const [profiles, setProfiles] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [lastTest, setLastTest] = useState<{ key: string; outcome: TestOutcome } | null>(null)
  const [validateUrl, setValidateUrl] = useState(false)

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

  // An environment endpoint keeps its URL; everything else is edited here
  const editsUrl = !isEnvEdit && !isRealAWS
  const effectiveUrl = isEnvEdit ? (endpoint?.url ?? null) : isRealAWS ? null : url.trim() || null
  // TLS settings are only offered for https:// endpoints: not plain http://, not real AWS
  const usesTls = isHttpsUrl(effectiveUrl)
  const urlError = validateUrl && editsUrl ? endpointUrlProblem(url) : null

  const settings: EndpointConnectionSettings = {
    auth_type: authType,
    auth_profile: authType === 'profile' ? authProfile.trim() || null : null,
    auth_access_key_id: authType === 'credentials' ? authAccessKeyId.trim() || null : null,
    auth_secret_access_key: authType === 'credentials' ? authSecretAccessKey.trim() || null : null,
    // Real AWS and http:// endpoints get the defaults: nothing uses TLS settings over
    // http://, and a CA bundle replaces the system trust store, so one saved for an
    // emulator must not follow the endpoint to real AWS. The backend rejects a bundle
    // with verification off, so it's only sent while verification is on (the field
    // keeps its text either way).
    tls_verify: usesTls ? tlsVerify : true,
    ca_bundle: usesTls && tlsVerify ? caBundle.trim() || null : null,
  }
  const connectionParams = { url: effectiveUrl, region: region.trim() || null, ...settings }
  // A test result only describes the settings it ran with
  const connectionKey = JSON.stringify(connectionParams)
  const testOutcome = lastTest?.key === connectionKey ? lastTest.outcome : null

  /** Show the URL error, if any, and say whether the form can go ahead. */
  const checkUrl = () => {
    setValidateUrl(true)
    return !editsUrl || endpointUrlProblem(url) === null
  }

  /** Say what the chosen authentication is missing, if anything, and whether the form can go ahead. */
  const checkAuth = () => {
    if (authType === 'profile' && !authProfile.trim()) {
      toast.error('Profile name is required')
      return false
    }
    if (authType === 'credentials' && (!authAccessKeyId.trim() || !authSecretAccessKey.trim())) {
      toast.error('Both Access Key ID and Secret Access Key are required')
      return false
    }
    return true
  }

  const handleTest = async () => {
    // Editing never shows the saved profile or keys, so testing without them would test other credentials
    if (!checkUrl() || !checkAuth()) return
    const key = connectionKey
    setTesting(true)
    setLastTest(null)
    try {
      const check = await testEndpointConnection({ name: name.trim() || 'test', ...connectionParams })
      setLastTest({ key, outcome: { kind: 'checked', check } })
    } catch (error) {
      setLastTest({ key, outcome: { kind: 'failed', message: error instanceof Error ? error.message : String(error) } })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!checkUrl() || !checkAuth()) return
    setSubmitting(true)
    try {
      await onSubmit(name.trim(), effectiveUrl, region.trim() || null, settings)
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

          <FormField label="Endpoint URL" errorText={urlError}>
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
                    placeholder={URL_EXAMPLE}
                    disabled={submitting}
                    ariaLabel="Endpoint URL"
                    invalid={urlError !== null}
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
              onChange={({ detail }) => {
                const option = AUTH_OPTIONS.find((o) => o.value === detail.selectedOption.value)
                if (option) setAuthType(option.value)
              }}
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

          {usesTls && (
            <ExpandableSection
              headerText="Connection security"
              headerDescription="Certificates StackPort trusts for this endpoint"
              defaultExpanded={endpoint !== null && (!endpoint.tls_verify || endpoint.ca_bundle !== null)}
            >
              <SpaceBetween size="m">
                <Toggle
                  checked={tlsVerify}
                  onChange={({ detail }) => setTlsVerify(detail.checked)}
                  disabled={submitting}
                  description="Turn this off only for an endpoint you trust whose certificate can't be verified."
                >
                  Verify certificates
                </Toggle>
                {!tlsVerify && (
                  <Alert type="warning">
                    StackPort will accept any certificate this endpoint presents. A CA bundle keeps the connection verified.
                  </Alert>
                )}
                <FormField
                  label="CA bundle"
                  description="Path to a PEM file on the machine that runs StackPort. Not needed for AWS Emulator at https://127.0.0.1:<port>: StackPort picks up its certificate automatically."
                  constraintText={tlsVerify ? undefined : 'Not used while certificate verification is off.'}
                >
                  <Input
                    value={caBundle}
                    onChange={({ detail }) => setCaBundle(detail.value)}
                    placeholder="~/certs/emulator-ca.pem"
                    disabled={!tlsVerify || submitting}
                    ariaLabel="CA bundle path"
                  />
                </FormField>
              </SpaceBetween>
            </ExpandableSection>
          )}

          <SpaceBetween size="s">
            <Box>
              <Button onClick={() => void handleTest()} loading={testing} disabled={submitting} data-testid="test-connection">
                Test connection
              </Button>
            </Box>
            {testOutcome?.kind === 'checked' && <ConnectionCheckSummary check={testOutcome.check} />}
            {testOutcome?.kind === 'failed' && (
              <LiveRegion>
                <SpaceBetween size="xxs">
                  <StatusIndicator type="error">Couldn't test the connection</StatusIndicator>
                  <Box>{testOutcome.message}</Box>
                </SpaceBetween>
              </LiveRegion>
            )}
          </SpaceBetween>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

/** Flags an https:// endpoint's TLS settings that differ from the default, so the table stays quiet otherwise. */
function tlsIndicator(endpoint: Endpoint): ReactNode {
  // Nothing uses them over plain http://
  if (!isHttpsUrl(endpoint.url)) return null
  if (!endpoint.tls_verify) return <StatusIndicator type="warning">Verification off</StatusIndicator>
  if (endpoint.ca_bundle) return <StatusIndicator type="info">Custom CA</StatusIndicator>
  return null
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

  const handleFormSubmit = async (
    name: string,
    url: string | null,
    region: string | null,
    settings: EndpointConnectionSettings,
  ) => {
    if (form?.mode === 'add') {
      await addEndpoint(name, url, region, settings)
      toast.success(`Endpoint "${name}" added`)
    } else {
      await updateEndpoint(name, url, region, settings)
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
            cell: (e) => {
              if (e.url === null) return <Badge color="severity-medium">Real AWS</Badge>
              const tls = tlsIndicator(e)
              return tls ? (
                <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                  <span>{e.url}</span>
                  {tls}
                </SpaceBetween>
              ) : (
                e.url
              )
            },
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
    <CloudscapeShell activeHref="/settings">
      <SpaceBetween size="l">
        <Header variant="h1" description="Manage StackPort configuration and preferences">
          Settings
        </Header>
        <Tabs tabs={[{ id: 'endpoints', label: 'Endpoints', content: <EndpointsPanel /> }]} />
      </SpaceBetween>
    </CloudscapeShell>
  )
}
