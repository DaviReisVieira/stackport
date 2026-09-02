import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Checkbox from '@cloudscape-design/components/checkbox'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import SegmentedControl from '@cloudscape-design/components/segmented-control'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  createSecret,
  deleteSecret,
  fetchSecretDetail,
  fetchSecrets,
  restoreSecret,
  updateSecretMetadata,
  updateSecretValue,
} from '@/lib/api'
import type { Secret, SecretDetail } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

function detectJson(value: string): { formatted: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'object' && parsed !== null) {
      return { formatted: JSON.stringify(parsed, null, 2), isJson: true }
    }
  } catch {
    // not JSON
  }
  return { formatted: value, isJson: false }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function copyText(text: string, label: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied to clipboard`))
    .catch(() => toast.error(`Failed to copy ${label}`))
}

/** Text/JSON value editor with validation and formatting, ported from the legacy view. */
function ValueEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<'text' | 'json'>('text')
  const [error, setError] = useState<string | null>(null)

  const switchMode = (next: 'text' | 'json') => {
    if (next === 'json') {
      try {
        const parsed = JSON.parse(value)
        onChange(JSON.stringify(parsed, null, 2))
        setError(null)
      } catch {
        setError('Cannot format as JSON: invalid syntax')
        return
      }
    } else {
      setError(null)
    }
    setMode(next)
  }

  const handleChange = (next: string) => {
    onChange(next)
    if (mode === 'json') {
      try {
        JSON.parse(next)
        setError(null)
      } catch {
        setError('Invalid JSON')
      }
    }
  }

  return (
    <FormField label="Secret value" errorText={error ?? undefined}>
      <SpaceBetween size="xs">
        <SegmentedControl
          selectedId={mode}
          onChange={({ detail }) => switchMode(detail.selectedId as 'text' | 'json')}
          label="Value mode"
          options={[
            { id: 'text', text: 'Plain text' },
            { id: 'json', text: 'JSON' },
          ]}
        />
        <Textarea value={value} onChange={({ detail }) => handleChange(detail.value)} rows={8} spellcheck={false} />
      </SpaceBetween>
    </FormField>
  )
}

/** Hidden-by-default value viewer with JSON detection and copy actions. */
function SecretValuePanel({ detail }: { detail: SecretDetail }) {
  const [revealed, setRevealed] = useState(false)

  if (detail.secretBinary) {
    return (
      <SpaceBetween size="s">
        <Box color="text-body-secondary">This secret stores a binary value.</Box>
        <Button iconName="copy" onClick={() => copyText(detail.secretBinary ?? '', 'Base64 value')}>
          Copy Base64
        </Button>
      </SpaceBetween>
    )
  }

  if (detail.secretValue === null) {
    return <Box color="text-status-inactive">No value stored</Box>
  }

  const { formatted, isJson } = detectJson(detail.secretValue)

  return (
    <SpaceBetween size="s">
      <SpaceBetween direction="horizontal" size="xs">
        <Button iconName={revealed ? 'lock-private' : 'unlocked'} onClick={() => setRevealed((r) => !r)}>
          {revealed ? 'Hide value' : 'Show value'}
        </Button>
        <Button iconName="copy" onClick={() => copyText(detail.secretValue ?? '', 'Secret value')}>
          Copy
        </Button>
        {isJson && <Badge color="blue">JSON</Badge>}
      </SpaceBetween>
      {revealed && (
        <Box variant="code">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{formatted}</pre>
        </Box>
      )}
    </SpaceBetween>
  )
}

function CreateSecretModal({
  initialName,
  initialValue,
  title,
  onClose,
  onDone,
}: {
  initialName?: string
  initialValue?: string
  title: string
  onClose: () => void
  onDone: (name: string) => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState(initialName ?? '')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState(initialValue ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await createSecret({ name, description: description || undefined, secretString: value }, activeEndpoint)
      toast.success(`Secret '${name}' created`)
      onDone(name)
    } catch (error) {
      toast.error(`Failed to create secret: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={title} size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={!name.trim() || !value.trim()}>
              Create secret
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Secret name">
            <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="my-app/api-key" autoFocus />
          </FormField>
          <FormField label="Description">
            <Input value={description} onChange={({ detail }) => setDescription(detail.value)} />
          </FormField>
          <ValueEditor value={value} onChange={setValue} />
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

function EditValueModal({ detail, onClose, onDone }: { detail: SecretDetail; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [value, setValue] = useState(detail.secretValue ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await updateSecretValue(detail.name, { secretString: value }, activeEndpoint)
      toast.success('Secret value updated (new version created)')
      onDone()
    } catch (error) {
      toast.error(`Failed to update value: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Edit value of ${detail.name}`} size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={!value.trim()}>
              Save new version
            </Button>
          </SpaceBetween>
        }
      >
        <ValueEditor value={value} onChange={setValue} />
      </Form>
    </Modal>
  )
}

function EditMetadataModal({ detail, onClose, onDone }: { detail: SecretDetail; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [description, setDescription] = useState(detail.description)
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>(
    Object.entries(detail.tags ?? {}).map(([key, value]) => ({ key, value })),
  )
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const tagRecord = Object.fromEntries(tags.filter((t) => t.key.trim()).map((t) => [t.key.trim(), t.value]))
      await updateSecretMetadata(detail.name, { description, tags: tagRecord }, activeEndpoint)
      toast.success('Secret metadata updated')
      onDone()
    } catch (error) {
      toast.error(`Failed to update metadata: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Edit ${detail.name}`} size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving}>
              Save changes
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Description">
            <Input value={description} onChange={({ detail: d }) => setDescription(d.value)} />
          </FormField>
          <FormField label="Tags">
            <AttributeEditor
              items={tags}
              onAddButtonClick={() => setTags([...tags, { key: '', value: '' }])}
              onRemoveButtonClick={({ detail: d }) => setTags(tags.filter((_, i) => i !== d.itemIndex))}
              addButtonText="Add tag"
              removeButtonText="Remove"
              empty="No tags"
              definition={[
                {
                  label: 'Key',
                  control: (item, index) => (
                    <Input
                      value={item.key}
                      onChange={({ detail: d }) => setTags(tags.map((t, i) => (i === index ? { ...t, key: d.value } : t)))}
                    />
                  ),
                },
                {
                  label: 'Value',
                  control: (item, index) => (
                    <Input
                      value={item.value}
                      onChange={({ detail: d }) => setTags(tags.map((t, i) => (i === index ? { ...t, value: d.value } : t)))}
                    />
                  ),
                },
              ]}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

function DeleteSecretModal({ detail, onClose, onDone }: { detail: SecretDetail; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [force, setForce] = useState(false)
  const [working, setWorking] = useState(false)

  const submit = async () => {
    setWorking(true)
    try {
      await deleteSecret(detail.name, force, activeEndpoint)
      toast.success(force ? 'Secret deleted immediately' : 'Secret scheduled for deletion')
      onDone()
    } catch (error) {
      toast.error(`Failed to delete secret: ${error}`)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Delete ${detail.name}`} size="medium">
      <SpaceBetween size="m">
        <Alert type="warning">
          {force
            ? 'Force delete removes the secret immediately and it cannot be recovered.'
            : 'The secret will be scheduled for deletion in 7 days and can be restored until then.'}
        </Alert>
        <Checkbox checked={force} onChange={({ detail: d }) => setForce(d.checked)}>
          Force delete immediately (cannot be recovered)
        </Checkbox>
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="primary" onClick={submit} loading={working} data-testid="confirm-delete-secret">
            Delete secret
          </Button>
          <Button variant="link" onClick={onClose} disabled={working}>
            Cancel
          </Button>
        </SpaceBetween>
      </SpaceBetween>
    </Modal>
  )
}

type DetailModal = 'edit-value' | 'edit-metadata' | 'duplicate' | 'delete'

function SecretDetailView({ secretName, onBack }: { secretName: string; onBack: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchSecretDetail(secretName, activeEndpoint), [secretName, activeEndpoint])
  const { data: detail, loading, error, refresh } = useFetch<SecretDetail>(fetcher)
  const [modal, setModal] = useState<DetailModal | null>(null)
  const [restoring, setRestoring] = useState(false)

  const closeModal = () => setModal(null)
  const doneAndRefresh = () => {
    setModal(null)
    refresh()
  }

  const handleRestore = async () => {
    setRestoring(true)
    try {
      await restoreSecret(secretName, activeEndpoint)
      toast.success('Secret restored')
      refresh()
    } catch (err) {
      toast.error(`Failed to restore secret: ${err}`)
    } finally {
      setRestoring(false)
    }
  }

  if (loading && !detail) return <StatusIndicator type="loading">Loading secret</StatusIndicator>
  if (error && !detail) {
    return (
      <Alert type="error" header="Could not load secret" action={<Button onClick={() => refresh()}>Retry</Button>}>
        {error}
      </Alert>
    )
  }
  if (!detail) return null

  const rotation = detail.rotationEnabled
    ? detail.rotationRules?.AutomaticallyAfterDays
      ? `Every ${detail.rotationRules.AutomaticallyAfterDays} days`
      : detail.rotationRules?.ScheduleExpression ?? 'Enabled'
    : 'Disabled'

  const overview: Array<[string, string]> = [
    ['ARN', detail.arn],
    ['Description', detail.description || '—'],
    ['Created', formatDate(detail.createdDate)],
    ['Last changed', formatDate(detail.lastChangedDate)],
    ['Last accessed', formatDate(detail.lastAccessedDate)],
    ['Rotation', rotation],
    ['Rotation lambda', detail.rotationLambdaARN ?? '—'],
    ['Current version', detail.versionId ?? '—'],
  ]

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onBack}>Back to secrets</Button>
            <Button iconName="refresh" onClick={() => refresh()} ariaLabel="Refresh secret" />
            {detail.deletedDate ? (
              <Button variant="primary" onClick={handleRestore} loading={restoring}>
                Restore
              </Button>
            ) : (
              <>
                <Button onClick={() => setModal('edit-value')}>Edit value</Button>
                <Button onClick={() => setModal('edit-metadata')}>Edit metadata</Button>
                <Button onClick={() => setModal('duplicate')}>Duplicate</Button>
                <Button onClick={() => setModal('delete')}>Delete</Button>
              </>
            )}
          </SpaceBetween>
        }
      >
        <SpaceBetween direction="horizontal" size="xs">
          {detail.name}
          {detail.rotationEnabled && <Badge color="green">Rotation</Badge>}
          {detail.deletedDate && <Badge color="red">Pending deletion</Badge>}
        </SpaceBetween>
      </Header>

      {detail.deletedDate && (
        <Alert type="warning" header="Scheduled for deletion">
          This secret was deleted on {formatDate(detail.deletedDate)} and can be restored until the recovery window ends.
        </Alert>
      )}

      <ColumnLayout columns={2} variant="text-grid">
        {overview.map(([label, value]) => (
          <div key={label}>
            <Box variant="awsui-key-label">{label}</Box>
            <Box fontSize="body-s">{value}</Box>
          </div>
        ))}
      </ColumnLayout>

      <Header variant="h3">Value</Header>
      <SecretValuePanel detail={detail} />

      <Header variant="h3">Tags</Header>
      {Object.keys(detail.tags ?? {}).length === 0 ? (
        <Box color="text-status-inactive">No tags</Box>
      ) : (
        <SpaceBetween direction="horizontal" size="xs">
          {Object.entries(detail.tags).map(([key, value]) => (
            <Badge key={key} color="grey">
              {key}: {value}
            </Badge>
          ))}
        </SpaceBetween>
      )}

      {modal === 'edit-value' && <EditValueModal detail={detail} onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'edit-metadata' && <EditMetadataModal detail={detail} onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'duplicate' && (
        <CreateSecretModal
          title={`Duplicate ${detail.name}`}
          initialName={`${detail.name}-copy`}
          initialValue={detail.secretValue ?? ''}
          onClose={closeModal}
          onDone={doneAndRefresh}
        />
      )}
      {modal === 'delete' && (
        <DeleteSecretModal
          detail={detail}
          onClose={closeModal}
          onDone={() => {
            setModal(null)
            onBack()
          }}
        />
      )}
    </SpaceBetween>
  )
}

export function CloudscapeSecretsManagerBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedSecret = searchParams.get('secret')
  const secretsFetcher = useCallback(() => fetchSecrets(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ secrets: Secret[] }>(secretsFetcher, 10000)
  const [creating, setCreating] = useState(false)

  const secrets = data?.secrets ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(secrets, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const openSecret = useCallback((name: string) => setSearchParams({ secret: name }), [setSearchParams])
  const backToList = useCallback(() => {
    setSearchParams({})
    refresh()
  }, [setSearchParams, refresh])

  if (selectedSecret) {
    return <SecretDetailView secretName={selectedSecret} onBack={backToList} />
  }

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load secrets" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Table
        {...collectionProps}
        items={items}
        trackBy="name"
        loading={loading && !data}
        loadingText="Loading secrets"
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h2"
            counter={data ? `(${secrets.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh secrets" />
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create secret
                </Button>
              </SpaceBetween>
            }
          >
            Secrets
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find a secret"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" padding="l">
            <SpaceBetween size="s">
              <Box>No secrets yet</Box>
              <Button onClick={() => setCreating(true)}>Create secret</Button>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (s) => (
              <Link
                href={`?secret=${encodeURIComponent(s.name)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  openSecret(s.name)
                }}
              >
                {s.name}
              </Link>
            ),
          },
          {
            id: 'description',
            header: 'Description',
            cell: (s) => s.description || '—',
          },
          {
            id: 'rotation',
            header: 'Rotation',
            sortingField: 'rotationEnabled',
            cell: (s) =>
              s.rotationEnabled ? <StatusIndicator type="success">Enabled</StatusIndicator> : <Box color="text-status-inactive">Disabled</Box>,
          },
          {
            id: 'lastChanged',
            header: 'Last changed',
            sortingField: 'lastChangedDate',
            cell: (s) => formatDate(s.lastChangedDate),
          },
        ]}
      />

      {creating && (
        <CreateSecretModal
          title="Create secret"
          onClose={() => setCreating(false)}
          onDone={(name) => {
            setCreating(false)
            refresh()
            openSecret(name)
          }}
        />
      )}
    </SpaceBetween>
  )
}
