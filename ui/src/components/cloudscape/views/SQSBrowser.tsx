import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Checkbox from '@cloudscape-design/components/checkbox'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
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
import Tabs from '@cloudscape-design/components/tabs'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  createSQSQueue,
  deleteSQSMessage,
  deleteSQSMessagesBatch,
  deleteSQSQueue,
  fetchResourceTags,
  fetchSQSQueueDetail,
  fetchSQSQueues,
  purgeSQSQueue,
  receiveSQSMessages,
  sendSQSMessage,
  sendSQSMessagesBatch,
  updateResourceTags,
  updateSQSQueueAttributes,
  updateSQSRedrivePolicy,
} from '@/lib/api'
import type {
  SQSBatchSendMessageEntry,
  SQSFavoriteMessage,
  SQSMessage,
  SQSQueue,
  SQSQueueDetail,
  SQSSendMessageRequest,
} from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { useSQSFavoriteMessages } from '@/hooks/useSQSFavoriteMessages'

type ModalKind = 'create' | 'send' | 'batch-send' | 'settings' | 'purge' | 'delete'

// Same storage key as the legacy view so queue favorites survive the migration
const QUEUE_FAVORITES_KEY = 'sqs-favorites'

function useSqsQueueFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(QUEUE_FAVORITES_KEY) ?? '[]'))
    } catch {
      return new Set()
    }
  })

  const toggle = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      try {
        localStorage.setItem(QUEUE_FAVORITES_KEY, JSON.stringify([...next]))
      } catch {
        // Ignore localStorage errors
      }
      return next
    })
  }, [])

  return { favorites, toggle }
}

function starButton(name: string, favorites: Set<string>, toggle: (name: string) => void) {
  const isFav = favorites.has(name)
  return (
    <Button
      variant="inline-icon"
      iconName={isFav ? 'star-filled' : 'star'}
      ariaLabel={isFav ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
      onClick={() => toggle(name)}
    />
  )
}

function CreateQueueModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [fifo, setFifo] = useState(false)
  const [dedup, setDedup] = useState(false)
  const [visibility, setVisibility] = useState('30')
  const [retention, setRetention] = useState('345600')
  const [delay, setDelay] = useState('0')
  const [maxSize, setMaxSize] = useState('262144')
  const [receiveWait, setReceiveWait] = useState('0')
  const [dlqEnabled, setDlqEnabled] = useState(false)
  const [maxReceiveCount, setMaxReceiveCount] = useState('5')
  const [sseEnabled, setSseEnabled] = useState(true)
  const [kmsKeyId, setKmsKeyId] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const queueName = fifo && !name.endsWith('.fifo') ? `${name}.fifo` : name
    setSaving(true)
    try {
      await createSQSQueue(
        {
          queueName,
          queueType: fifo ? 'FIFO' : 'Standard',
          contentBasedDeduplication: fifo ? dedup : undefined,
          visibilityTimeout: Number(visibility),
          messageRetentionPeriod: Number(retention),
          delaySeconds: Number(delay),
          maximumMessageSize: Number(maxSize),
          receiveMessageWaitTime: Number(receiveWait),
          dlqEnabled,
          maxReceiveCount: dlqEnabled ? Number(maxReceiveCount) : undefined,
          sqsManagedSseEnabled: sseEnabled,
          kmsMasterKeyId: !sseEnabled ? kmsKeyId || undefined : undefined,
        },
        activeEndpoint,
      )
      toast.success(`Queue '${queueName}' created${dlqEnabled ? ' with a dead-letter queue' : ''}`)
      onDone()
    } catch (error) {
      toast.error(`Failed to create queue: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header="Create queue" size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={!name.trim()}>
              Create queue
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Queue name" description={fifo ? '.fifo is appended automatically' : undefined}>
            <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="my-queue" autoFocus />
          </FormField>
          <Checkbox checked={fifo} onChange={({ detail }) => setFifo(detail.checked)}>
            FIFO queue
          </Checkbox>
          {fifo && (
            <Checkbox checked={dedup} onChange={({ detail }) => setDedup(detail.checked)}>
              Content-based deduplication
            </Checkbox>
          )}
          <FormField label="Visibility timeout (seconds)">
            <Input type="number" value={visibility} onChange={({ detail }) => setVisibility(detail.value)} />
          </FormField>
          <FormField label="Message retention period (seconds)" description="60-1209600 seconds (14 days). Default: 345600">
            <Input type="number" value={retention} onChange={({ detail }) => setRetention(detail.value)} />
          </FormField>
          <FormField label="Delivery delay (seconds)">
            <Input type="number" value={delay} onChange={({ detail }) => setDelay(detail.value)} />
          </FormField>
          <ExpandableSection headerText="Advanced settings">
            <SpaceBetween size="m">
              <FormField label="Maximum message size (bytes)" description="1024-262144. Default: 262144">
                <Input type="number" value={maxSize} onChange={({ detail }) => setMaxSize(detail.value)} />
              </FormField>
              <FormField label="Receive message wait time (seconds)" description="0-20. Long polling when greater than 0">
                <Input type="number" value={receiveWait} onChange={({ detail }) => setReceiveWait(detail.value)} />
              </FormField>
              <Checkbox checked={dlqEnabled} onChange={({ detail }) => setDlqEnabled(detail.checked)}>
                Create a dead-letter queue
              </Checkbox>
              {dlqEnabled && (
                <FormField label="Max receive count" description="Messages move to the DLQ after this many receives">
                  <Input type="number" value={maxReceiveCount} onChange={({ detail }) => setMaxReceiveCount(detail.value)} />
                </FormField>
              )}
              <Checkbox checked={sseEnabled} onChange={({ detail }) => setSseEnabled(detail.checked)}>
                SQS-managed server-side encryption (SSE-SQS)
              </Checkbox>
              {!sseEnabled && (
                <FormField label="KMS master key ID" description="Leave empty for no encryption">
                  <Input value={kmsKeyId} onChange={({ detail }) => setKmsKeyId(detail.value)} />
                </FormField>
              )}
            </SpaceBetween>
          </ExpandableSection>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

function SendMessageModal({ queue, onClose, onDone }: { queue: SQSQueue; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [body, setBody] = useState('')
  const [delay, setDelay] = useState('0')
  const [groupId, setGroupId] = useState('')
  const [dedupId, setDedupId] = useState('')
  const [sending, setSending] = useState(false)
  const isFifo = queue.type === 'FIFO'

  const submit = async () => {
    setSending(true)
    try {
      await sendSQSMessage(
        queue.name,
        {
          messageBody: body,
          delaySeconds: Number(delay) || undefined,
          messageGroupId: isFifo ? groupId : undefined,
          messageDeduplicationId: isFifo && dedupId ? dedupId : undefined,
        },
        activeEndpoint,
      )
      toast.success('Message sent')
      onDone()
    } catch (error) {
      toast.error(`Failed to send message: ${error}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Send message to ${queue.name}`} size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={sending} disabled={!body.trim() || (isFifo && !groupId.trim())}>
              Send message
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Message body">
            <Textarea value={body} onChange={({ detail }) => setBody(detail.value)} rows={6} autoFocus />
          </FormField>
          {!isFifo && (
            <FormField label="Delivery delay (seconds)" description="0-900">
              <Input type="number" value={delay} onChange={({ detail }) => setDelay(detail.value)} />
            </FormField>
          )}
          {isFifo && (
            <>
              <FormField label="Message group ID" description="Required for FIFO queues">
                <Input value={groupId} onChange={({ detail }) => setGroupId(detail.value)} />
              </FormField>
              <FormField label="Message deduplication ID" description="Optional if content-based deduplication is enabled">
                <Input value={dedupId} onChange={({ detail }) => setDedupId(detail.value)} />
              </FormField>
            </>
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

function EditSettingsModal({ queue, onClose, onDone }: { queue: SQSQueueDetail; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [visibility, setVisibility] = useState(String(queue.visibilityTimeout))
  const [retention, setRetention] = useState(String(queue.messageRetentionPeriod))
  const [delay, setDelay] = useState(String(queue.delaySeconds))
  const [maxSize, setMaxSize] = useState(String(queue.maximumMessageSize))
  const [receiveWait, setReceiveWait] = useState('0')
  const [dlqEnabled, setDlqEnabled] = useState(Boolean(queue.redrivePolicy))
  const [dlqArn, setDlqArn] = useState(queue.redrivePolicy?.deadLetterTargetArn ?? '')
  const [maxReceiveCount, setMaxReceiveCount] = useState(String(queue.redrivePolicy?.maxReceiveCount ?? 5))
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await updateSQSQueueAttributes(
        queue.name,
        {
          visibilityTimeout: Number(visibility),
          messageRetentionPeriod: Number(retention),
          delaySeconds: Number(delay),
          maximumMessageSize: Number(maxSize),
          receiveMessageWaitTime: Number(receiveWait),
        },
        activeEndpoint,
      )
      const hadPolicy = Boolean(queue.redrivePolicy)
      if (dlqEnabled && dlqArn.trim()) {
        await updateSQSRedrivePolicy(queue.name, { deadLetterTargetArn: dlqArn.trim(), maxReceiveCount: Number(maxReceiveCount) }, activeEndpoint)
      } else if (!dlqEnabled && hadPolicy) {
        await updateSQSRedrivePolicy(queue.name, null, activeEndpoint)
      }
      toast.success('Queue settings updated')
      onDone()
    } catch (error) {
      toast.error(`Failed to update settings: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Edit ${queue.name}`} size="medium">
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
          <FormField label="Visibility timeout (seconds)">
            <Input type="number" value={visibility} onChange={({ detail }) => setVisibility(detail.value)} />
          </FormField>
          <FormField label="Message retention period (seconds)" description="60-1209600 seconds (14 days)">
            <Input type="number" value={retention} onChange={({ detail }) => setRetention(detail.value)} />
          </FormField>
          <FormField label="Delivery delay (seconds)">
            <Input type="number" value={delay} onChange={({ detail }) => setDelay(detail.value)} />
          </FormField>
          <FormField label="Maximum message size (bytes)">
            <Input type="number" value={maxSize} onChange={({ detail }) => setMaxSize(detail.value)} />
          </FormField>
          <FormField label="Receive message wait time (seconds)">
            <Input type="number" value={receiveWait} onChange={({ detail }) => setReceiveWait(detail.value)} />
          </FormField>
          <ExpandableSection headerText="Dead-letter queue" defaultExpanded={dlqEnabled}>
            <SpaceBetween size="m">
              <Checkbox checked={dlqEnabled} onChange={({ detail }) => setDlqEnabled(detail.checked)}>
                Enable dead-letter queue
              </Checkbox>
              {dlqEnabled && (
                <>
                  <FormField label="DLQ target ARN">
                    <Input value={dlqArn} onChange={({ detail }) => setDlqArn(detail.value)} placeholder="arn:aws:sqs:..." />
                  </FormField>
                  <FormField label="Max receive count">
                    <Input type="number" value={maxReceiveCount} onChange={({ detail }) => setMaxReceiveCount(detail.value)} />
                  </FormField>
                </>
              )}
            </SpaceBetween>
          </ExpandableSection>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

/** Port of the legacy BatchSendSheet: paste a JSON array, entries are auto-wrapped. */
function BatchSendModal({ queue, onClose, onDone }: { queue: SQSQueueDetail; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const isFifo = queue.type === 'FIFO'
  const [jsonInput, setJsonInput] = useState(() =>
    JSON.stringify(
      isFifo
        ? [
            { documentNumber: '123456789', filters: [{ name: 'John Doe', age: '30' }], messageGroupId: 'group1' },
            { documentNumber: '987654321', filters: [{ name: 'Jane Doe', age: '30' }], messageGroupId: 'group1' },
          ]
        : [
            { documentNumber: '123456789', filters: [{ name: 'John Doe', age: '30' }] },
            { documentNumber: '987654321', filters: [{ name: 'Jane Doe', age: '30' }] },
          ],
      null,
      2,
    ),
  )
  const [sending, setSending] = useState(false)

  const submit = async () => {
    let entries: unknown
    try {
      entries = JSON.parse(jsonInput)
    } catch {
      toast.error('Invalid JSON format')
      return
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      toast.error('Root must be a non-empty array of message objects')
      return
    }
    if (entries.length > 10) {
      toast.error('Maximum 10 messages per batch')
      return
    }

    const transformed: SQSBatchSendMessageEntry[] = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (typeof entry !== 'object' || entry === null) {
        toast.error(`Entry ${i + 1} must be an object`)
        return
      }
      const record = entry as Record<string, unknown>
      const batchEntry: SQSBatchSendMessageEntry = {
        id: `msg-${i + 1}`,
        messageBody: typeof record.messageBody === 'string' ? record.messageBody : JSON.stringify(entry),
      }
      if (typeof record.delaySeconds === 'number') batchEntry.delaySeconds = record.delaySeconds
      if (typeof record.messageGroupId === 'string') batchEntry.messageGroupId = record.messageGroupId
      if (typeof record.messageDeduplicationId === 'string') batchEntry.messageDeduplicationId = record.messageDeduplicationId
      transformed.push(batchEntry)
    }

    setSending(true)
    try {
      const response = await sendSQSMessagesBatch(queue.name, { entries: transformed }, activeEndpoint)
      if (response.failed.length > 0) {
        toast.error(`Sent ${response.successful.length}, failed ${response.failed.length}: ${response.failed.map((f) => f.message).join(', ')}`)
      } else {
        toast.success(`Sent ${response.successful.length} message(s) successfully`)
      }
      if (response.successful.length > 0) onDone()
    } catch (error) {
      toast.error(`Failed to send messages: ${error}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Batch send messages to ${queue.name}`} size="large">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={sending} data-testid="batch-send-submit">
              Send batch
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField
            label="Message data (JSON array)"
            description={`Paste an array of message objects as-is; entry IDs are generated and objects are stringified. Max 10 per batch.${isFifo ? ' Each message must have a messageGroupId.' : ''}`}
          >
            <Textarea value={jsonInput} onChange={({ detail }) => setJsonInput(detail.value)} rows={14} spellcheck={false} />
          </FormField>
          <Alert type="info">
            Your entire object (including any <code>id</code> field) is preserved in the message body. Optional per-entry
            fields: <code>messageBody</code>, <code>delaySeconds</code>, <code>messageGroupId</code>,{' '}
            <code>messageDeduplicationId</code>.
          </Alert>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

/** Create or save a reusable message template (single or batch), ported from CreateFavoriteSheet. */
function CreateSavedMessageModal({
  queueName,
  initial,
  onClose,
  onSave,
}: {
  queueName: string
  initial?: { name: string; messageBody: string; originalMessageId?: string }
  onClose: () => void
  onSave: (data: {
    name: string
    messageBody: string
    delaySeconds?: number
    messageGroupId?: string
    messageDeduplicationId?: string
    sourceQueue?: string
    originalMessageId?: string
    isBatch?: boolean
  }) => void
}) {
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [name, setName] = useState(initial?.name ?? '')
  const [body, setBody] = useState(initial?.messageBody ?? '')
  const [batchJson, setBatchJson] = useState(() =>
    JSON.stringify(
      [
        { documentNumber: '123456789', filters: [{ name: 'John Doe', age: '30' }] },
        { documentNumber: '987654321', filters: [{ name: 'Jane Doe', age: '30' }] },
      ],
      null,
      2,
    ),
  )
  const [delay, setDelay] = useState('')
  const [groupId, setGroupId] = useState('')
  const [dedupId, setDedupId] = useState('')

  const submit = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (mode === 'batch') {
      try {
        const parsed = JSON.parse(batchJson)
        if (!Array.isArray(parsed) || parsed.length === 0) {
          toast.error('Batch must be a non-empty JSON array')
          return
        }
      } catch {
        toast.error('Invalid JSON format')
        return
      }
      onSave({ name: name.trim(), messageBody: batchJson, sourceQueue: queueName, isBatch: true })
    } else {
      if (!body.trim()) {
        toast.error('Message body is required')
        return
      }
      onSave({
        name: name.trim(),
        messageBody: body,
        delaySeconds: delay ? Number(delay) : undefined,
        messageGroupId: groupId || undefined,
        messageDeduplicationId: dedupId || undefined,
        sourceQueue: queueName,
        originalMessageId: initial?.originalMessageId,
        isBatch: false,
      })
    }
    toast.success(`Saved "${name.trim()}"`)
    onClose()
  }

  return (
    <Modal visible onDismiss={onClose} header="Save message template" size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} data-testid="save-favorite-submit">
              Save
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <SegmentedControl
            selectedId={mode}
            onChange={({ detail }) => setMode(detail.selectedId as 'single' | 'batch')}
            label="Template kind"
            options={[
              { id: 'single', text: 'Single message' },
              { id: 'batch', text: 'Batch' },
            ]}
          />
          <FormField label="Name">
            <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="Order created event" autoFocus />
          </FormField>
          {mode === 'single' ? (
            <>
              <FormField label="Message body">
                <Textarea value={body} onChange={({ detail }) => setBody(detail.value)} rows={8} spellcheck={false} />
              </FormField>
              <ExpandableSection headerText="Optional send parameters">
                <SpaceBetween size="s">
                  <FormField label="Delay seconds">
                    <Input type="number" value={delay} onChange={({ detail }) => setDelay(detail.value)} />
                  </FormField>
                  <FormField label="Message group ID" description="FIFO queues">
                    <Input value={groupId} onChange={({ detail }) => setGroupId(detail.value)} />
                  </FormField>
                  <FormField label="Message deduplication ID" description="FIFO queues">
                    <Input value={dedupId} onChange={({ detail }) => setDedupId(detail.value)} />
                  </FormField>
                </SpaceBetween>
              </ExpandableSection>
            </>
          ) : (
            <FormField label="Batch messages (JSON array)" description="Sent through the batch endpoint, max 10 per send">
              <Textarea value={batchJson} onChange={({ detail }) => setBatchJson(detail.value)} rows={10} spellcheck={false} />
            </FormField>
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

/** Saved message viewer with in-place editing, ported from FavoriteViewerSheet. */
function SavedMessageViewerModal({
  favorite,
  onClose,
  onUpdate,
  onDelete,
  onSend,
}: {
  favorite: SQSFavoriteMessage
  onClose: () => void
  onUpdate: (id: string, data: { name: string; messageBody: string }) => void
  onDelete: (id: string) => void
  onSend: (favorite: SQSFavoriteMessage) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(favorite.name)
  const [body, setBody] = useState(favorite.messageBody)

  const details: Array<[string, string]> = [
    ['Created', new Date(favorite.createdAt).toLocaleString()],
    ...(favorite.sourceQueue ? ([['Source queue', favorite.sourceQueue]] as Array<[string, string]>) : []),
    ...(favorite.originalMessageId ? ([['Original message ID', favorite.originalMessageId]] as Array<[string, string]>) : []),
    ...(favorite.delaySeconds ? ([['Delay seconds', String(favorite.delaySeconds)]] as Array<[string, string]>) : []),
    ...(favorite.messageGroupId ? ([['Message group ID', favorite.messageGroupId]] as Array<[string, string]>) : []),
    ...(favorite.messageDeduplicationId ? ([['Deduplication ID', favorite.messageDeduplicationId]] as Array<[string, string]>) : []),
  ]

  return (
    <Modal visible onDismiss={onClose} header={favorite.name} size="large">
      <SpaceBetween size="m">
        <SpaceBetween direction="horizontal" size="xs">
          {favorite.isBatch && <Badge color="blue">Batch</Badge>}
          {editing ? (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  onUpdate(favorite.id, { name: name.trim(), messageBody: body })
                  toast.success('Saved message updated')
                  setEditing(false)
                }}
                disabled={!name.trim()}
                data-testid="favorite-save-edit"
              >
                Save
              </Button>
              <Button
                variant="link"
                onClick={() => {
                  setEditing(false)
                  setName(favorite.name)
                  setBody(favorite.messageBody)
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button iconName="edit" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                iconName="copy"
                onClick={() => {
                  navigator.clipboard
                    .writeText(favorite.messageBody)
                    .then(() => toast.success('Copied message body to clipboard'))
                    .catch(() => toast.error('Failed to copy'))
                }}
              >
                Copy
              </Button>
              <Button iconName="send" onClick={() => onSend(favorite)}>
                Send
              </Button>
              <Button iconName="remove" onClick={() => onDelete(favorite.id)}>
                Delete
              </Button>
            </>
          )}
        </SpaceBetween>

        {editing ? (
          <SpaceBetween size="s">
            <FormField label="Name">
              <Input value={name} onChange={({ detail }) => setName(detail.value)} />
            </FormField>
            <FormField label="Message body">
              <Textarea value={body} onChange={({ detail }) => setBody(detail.value)} rows={10} spellcheck={false} />
            </FormField>
          </SpaceBetween>
        ) : (
          <FormField label="Message body">
            <Box variant="code">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{favorite.messageBody}</pre>
            </Box>
          </FormField>
        )}

        <ColumnLayout columns={2} variant="text-grid">
          {details.map(([label, value]) => (
            <div key={label}>
              <Box variant="awsui-key-label">{label}</Box>
              <Box fontSize="body-s">{value}</Box>
            </div>
          ))}
        </ColumnLayout>
      </SpaceBetween>
    </Modal>
  )
}

/** Saved messages tab: reusable templates scoped to this queue, ported from the legacy Favorites tab. */
function SavedMessagesPanel({ queue, onCountsChanged }: { queue: SQSQueueDetail; onCountsChanged: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const { favoriteMessages, addFavorite, removeFavorite, updateFavorite } = useSQSFavoriteMessages()
  const saved = favoriteMessages.filter((f) => f.sourceQueue === queue.name)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<SQSFavoriteMessage | null>(null)

  const send = async (favorite: SQSFavoriteMessage) => {
    try {
      if (favorite.isBatch) {
        let entries: unknown
        try {
          entries = JSON.parse(favorite.messageBody)
        } catch {
          toast.error('Invalid batch format')
          return
        }
        if (!Array.isArray(entries)) {
          toast.error('Batch template has an invalid format')
          return
        }
        const transformed = entries.map((entry, i) => ({
          id: `msg-${i + 1}`,
          messageBody:
            typeof entry === 'object' && entry !== null && 'messageBody' in entry
              ? String((entry as Record<string, unknown>).messageBody)
              : JSON.stringify(entry),
        }))
        const response = await sendSQSMessagesBatch(queue.name, { entries: transformed }, activeEndpoint)
        if (response.failed.length > 0) {
          toast.error(`Sent ${response.successful.length}, failed ${response.failed.length}`)
        } else {
          toast.success(`Sent batch "${favorite.name}" (${response.successful.length} messages)`)
        }
      } else {
        const request: SQSSendMessageRequest = {
          messageBody: favorite.messageBody,
          delaySeconds: favorite.delaySeconds,
          messageGroupId: favorite.messageGroupId,
          messageDeduplicationId: favorite.messageDeduplicationId,
        }
        await sendSQSMessage(queue.name, request, activeEndpoint)
        toast.success(`Sent "${favorite.name}" to ${queue.name}`)
      }
      onCountsChanged()
    } catch (error) {
      toast.error(`Failed to send: ${error}`)
    }
  }

  return (
    <SpaceBetween size="m">
      <Table
        items={saved}
        trackBy="id"
        variant="embedded"
        header={
          <Header
            variant="h3"
            counter={saved.length ? `(${saved.length})` : undefined}
            description="Save frequently used message templates for quick reuse"
            actions={
              <Button iconName="add-plus" onClick={() => setCreating(true)}>
                Create saved message
              </Button>
            }
          >
            Saved messages
          </Header>
        }
        empty={
          <Box textAlign="center" padding="l">
            <SpaceBetween size="s">
              <Box>No saved messages</Box>
              <Box color="text-body-secondary">Save polled messages or create templates to quickly reuse them.</Box>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            cell: (f) => (
              <SpaceBetween direction="horizontal" size="xs">
                <Link
                  href={`#${f.id}`}
                  onFollow={(event) => {
                    event.preventDefault()
                    setViewing(f)
                  }}
                >
                  {f.name}
                </Link>
                {f.isBatch && <Badge color="blue">Batch</Badge>}
              </SpaceBetween>
            ),
          },
          {
            id: 'preview',
            header: 'Body preview',
            cell: (f) => <Box fontSize="body-s">{f.messageBody.length > 100 ? `${f.messageBody.slice(0, 97)}...` : f.messageBody}</Box>,
          },
          { id: 'created', header: 'Created', cell: (f) => new Date(f.createdAt).toLocaleString() },
          {
            id: 'actions',
            header: '',
            cell: (f) => (
              <SpaceBetween direction="horizontal" size="xxs">
                <Button variant="inline-icon" iconName="send" ariaLabel={`Send ${f.name}`} onClick={() => void send(f)} />
                <Button
                  variant="inline-icon"
                  iconName="copy"
                  ariaLabel={`Copy body of ${f.name}`}
                  onClick={() => {
                    navigator.clipboard
                      .writeText(f.messageBody)
                      .then(() => toast.success('Copied message body to clipboard'))
                      .catch(() => toast.error('Failed to copy'))
                  }}
                />
                <Button
                  variant="inline-icon"
                  iconName="remove"
                  ariaLabel={`Delete ${f.name}`}
                  onClick={() => {
                    removeFavorite(f.id)
                    toast.success(`Deleted "${f.name}"`)
                  }}
                />
              </SpaceBetween>
            ),
          },
        ]}
      />

      {creating && (
        <CreateSavedMessageModal queueName={queue.name} onClose={() => setCreating(false)} onSave={addFavorite} />
      )}
      {viewing && (
        <SavedMessageViewerModal
          favorite={favoriteMessages.find((f) => f.id === viewing.id) ?? viewing}
          onClose={() => setViewing(null)}
          onUpdate={updateFavorite}
          onDelete={(id) => {
            removeFavorite(id)
            toast.success('Saved message deleted')
            setViewing(null)
          }}
          onSend={(f) => void send(f)}
        />
      )}
    </SpaceBetween>
  )
}

function ConfirmActionModal({
  queue,
  action,
  onClose,
  onDone,
}: {
  queue: SQSQueue
  action: 'purge' | 'delete'
  onClose: () => void
  onDone: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [confirmText, setConfirmText] = useState('')
  const [working, setWorking] = useState(false)
  const verb = action === 'purge' ? 'Purge' : 'Delete'

  const submit = async () => {
    setWorking(true)
    try {
      if (action === 'purge') {
        await purgeSQSQueue(queue.name, activeEndpoint)
        toast.success(`Queue '${queue.name}' purged`)
      } else {
        await deleteSQSQueue(queue.name, activeEndpoint)
        toast.success(`Queue '${queue.name}' deleted`)
      }
      onDone()
    } catch (error) {
      toast.error(`Failed to ${action} queue: ${error}`)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`${verb} ${queue.name}`} size="medium">
      <SpaceBetween size="m">
        <Alert type="warning">
          {action === 'purge'
            ? 'Purging permanently deletes every message in the queue. This cannot be undone.'
            : 'Deleting the queue removes it and all of its messages. This cannot be undone.'}
        </Alert>
        <FormField label="Type the queue name to confirm">
          <Input value={confirmText} onChange={({ detail }) => setConfirmText(detail.value)} placeholder={queue.name} />
        </FormField>
        <SpaceBetween direction="horizontal" size="xs">
          <Button
            variant="primary"
            onClick={submit}
            loading={working}
            disabled={confirmText !== queue.name}
            data-testid={`confirm-${action}`}
          >
            {verb} queue
          </Button>
          <Button variant="link" onClick={onClose} disabled={working}>
            Cancel
          </Button>
        </SpaceBetween>
      </SpaceBetween>
    </Modal>
  )
}

function MessageViewerModal({ message, onClose }: { message: SQSMessage; onClose: () => void }) {
  const attributeRows = [
    ...Object.entries(message.attributes ?? {}).map(([name, value]) => ({ name, value, kind: 'system' })),
    ...Object.entries(message.messageAttributes ?? {}).map(([name, attr]) => ({
      name,
      value: attr.StringValue ?? attr.BinaryValue ?? '',
      kind: attr.DataType,
    })),
  ]

  return (
    <Modal visible onDismiss={onClose} header={`Message ${message.messageId}`} size="large">
      <SpaceBetween size="m">
        <FormField label="Body">
          <Box variant="code">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{message.body}</pre>
          </Box>
        </FormField>
        <ColumnLayout columns={2} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">MD5 of body</Box>
            <Box fontSize="body-s">{message.md5OfBody}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Receipt handle</Box>
            <Box fontSize="body-s">{message.receiptHandle.slice(0, 48)}...</Box>
          </div>
        </ColumnLayout>
        {attributeRows.length > 0 && (
          <Table
            variant="embedded"
            items={attributeRows}
            trackBy="name"
            columnDefinitions={[
              { id: 'name', header: 'Attribute', cell: (r) => r.name },
              { id: 'value', header: 'Value', cell: (r) => r.value },
              { id: 'kind', header: 'Type', cell: (r) => r.kind },
            ]}
          />
        )}
      </SpaceBetween>
    </Modal>
  )
}

function MessagesPanel({ queue, onCountsChanged }: { queue: SQSQueueDetail; onCountsChanged: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const { addFavorite, addFavorites } = useSQSFavoriteMessages()
  const [messages, setMessages] = useState<SQSMessage[]>([])
  const [selected, setSelected] = useState<SQSMessage[]>([])
  const [viewing, setViewing] = useState<SQSMessage | null>(null)
  const [saving, setSaving] = useState<SQSMessage | null>(null)
  const [polling, setPolling] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const saveSelected = () => {
    if (selected.length === 0) return
    addFavorites(
      selected.map((m) => ({
        messageBody: m.body,
        name: `Message from ${queue.name}`,
        sourceQueue: queue.name,
        originalMessageId: m.messageId,
      })),
    )
    setSelected([])
    toast.success(`Saved ${selected.length} message(s)`)
  }

  const poll = useCallback(async () => {
    setPolling(true)
    try {
      const result = await receiveSQSMessages(queue.name, 10, 0, activeEndpoint)
      setMessages(result.messages)
      setSelected([])
      if (result.messages.length === 0) toast.info('No messages available')
    } catch (error) {
      toast.error(`Failed to receive messages: ${error}`)
    } finally {
      setPolling(false)
    }
  }, [queue.name, activeEndpoint])

  const deleteOne = async (message: SQSMessage) => {
    try {
      await deleteSQSMessage(queue.name, message.receiptHandle, activeEndpoint)
      setMessages((prev) => prev.filter((m) => m.messageId !== message.messageId))
      setSelected((prev) => prev.filter((m) => m.messageId !== message.messageId))
      toast.success('Message deleted')
      onCountsChanged()
    } catch (error) {
      toast.error(`Failed to delete message: ${error}`)
    }
  }

  const deleteSelected = async () => {
    setDeleting(true)
    try {
      await deleteSQSMessagesBatch(queue.name, { receiptHandles: selected.map((m) => m.receiptHandle) }, activeEndpoint)
      const ids = new Set(selected.map((m) => m.messageId))
      setMessages((prev) => prev.filter((m) => !ids.has(m.messageId)))
      toast.success(`Deleted ${selected.length} message(s)`)
      setSelected([])
      onCountsChanged()
    } catch (error) {
      toast.error(`Failed to delete messages: ${error}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SpaceBetween size="m">
      <Box color="text-body-secondary" fontSize="body-s">
        Polling peeks up to 10 messages with visibility timeout 0, so they stay available to consumers.
      </Box>
      <Table
        items={messages}
        trackBy="messageId"
        variant="embedded"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems as SQSMessage[])}
        header={
          <Header
            variant="h3"
            counter={messages.length ? `(${messages.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={poll} loading={polling}>
                  Poll for messages
                </Button>
                <Button disabled={selected.length === 0} onClick={saveSelected}>
                  Save selected ({selected.length})
                </Button>
                <Button disabled={selected.length === 0} loading={deleting} onClick={deleteSelected}>
                  Delete selected ({selected.length})
                </Button>
              </SpaceBetween>
            }
          >
            Messages
          </Header>
        }
        empty={<Box textAlign="center">No messages polled yet</Box>}
        columnDefinitions={[
          {
            id: 'id',
            header: 'Message ID',
            cell: (m) => (
              <Link
                href={`#${m.messageId}`}
                onFollow={(event) => {
                  event.preventDefault()
                  setViewing(m)
                }}
              >
                {m.messageId.slice(0, 18)}...
              </Link>
            ),
          },
          {
            id: 'body',
            header: 'Body',
            cell: (m) => <Box fontSize="body-s">{m.body.length > 100 ? `${m.body.slice(0, 97)}...` : m.body}</Box>,
          },
          {
            id: 'actions',
            header: '',
            width: 130,
            cell: (m) => (
              <SpaceBetween direction="horizontal" size="xxs">
                <Button
                  variant="inline-icon"
                  iconName="star"
                  ariaLabel={`Save message ${m.messageId}`}
                  onClick={() => setSaving(m)}
                />
                <Button variant="inline-link" onClick={() => deleteOne(m)}>
                  Delete
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
      />
      {viewing && <MessageViewerModal message={viewing} onClose={() => setViewing(null)} />}
      {saving && (
        <CreateSavedMessageModal
          queueName={queue.name}
          initial={{ name: `Message from ${queue.name}`, messageBody: saving.body, originalMessageId: saving.messageId }}
          onClose={() => setSaving(null)}
          onSave={addFavorite}
        />
      )}
    </SpaceBetween>
  )
}

function ConfigPanel({ detail }: { detail: SQSQueueDetail }) {
  const rows: Array<[string, string]> = [
    ['ARN', detail.arn],
    ['URL', detail.url],
    ['Type', detail.type],
    ['Visibility timeout', `${detail.visibilityTimeout}s`],
    ['Message retention', `${detail.messageRetentionPeriod}s`],
    ['Delivery delay', `${detail.delaySeconds}s`],
    ['Maximum message size', `${detail.maximumMessageSize} bytes`],
    ['Content-based deduplication', detail.contentBasedDeduplication ? 'Enabled' : 'Disabled'],
    ['Dead-letter queue', detail.redrivePolicy ? `${detail.redrivePolicy.deadLetterTargetArn} (max ${detail.redrivePolicy.maxReceiveCount})` : 'None'],
  ]
  return (
    <ColumnLayout columns={2} variant="text-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <Box variant="awsui-key-label">{label}</Box>
          <Box fontSize="body-s">{value}</Box>
        </div>
      ))}
    </ColumnLayout>
  )
}

function TagsPanel({ queueName }: { queueName: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchResourceTags('sqs', 'queues', queueName, activeEndpoint), [queueName, activeEndpoint])
  const { data, loading, refresh } = useFetch(fetcher)
  const [items, setItems] = useState<Array<{ key: string; value: string }>>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data && !dirty) {
      setItems(Object.entries((data as { tags: Record<string, string> }).tags ?? {}).map(([key, value]) => ({ key, value })))
    }
  }, [data, dirty])

  const save = async () => {
    setSaving(true)
    try {
      const tags = Object.fromEntries(items.filter((i) => i.key.trim()).map((i) => [i.key.trim(), i.value]))
      await updateResourceTags('sqs', 'queues', queueName, tags, activeEndpoint)
      toast.success('Tags updated')
      setDirty(false)
      refresh()
    } catch (error) {
      toast.error(`Failed to update tags: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SpaceBetween size="m">
      <AttributeEditor
        items={items}
        onAddButtonClick={() => {
          setItems([...items, { key: '', value: '' }])
          setDirty(true)
        }}
        onRemoveButtonClick={({ detail }) => {
          setItems(items.filter((_, index) => index !== detail.itemIndex))
          setDirty(true)
        }}
        addButtonText="Add tag"
        removeButtonText="Remove"
        empty={loading ? 'Loading tags' : 'No tags'}
        definition={[
          {
            label: 'Key',
            control: (item, index) => (
              <Input
                value={item.key}
                onChange={({ detail }) => {
                  setItems(items.map((it, i) => (i === index ? { ...it, key: detail.value } : it)))
                  setDirty(true)
                }}
              />
            ),
          },
          {
            label: 'Value',
            control: (item, index) => (
              <Input
                value={item.value}
                onChange={({ detail }) => {
                  setItems(items.map((it, i) => (i === index ? { ...it, value: detail.value } : it)))
                  setDirty(true)
                }}
              />
            ),
          },
        ]}
      />
      <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
        Save tags
      </Button>
    </SpaceBetween>
  )
}

function QueueDetailView({
  queueName,
  favorites,
  toggleFavorite,
  onBack,
}: {
  queueName: string
  favorites: Set<string>
  toggleFavorite: (name: string) => void
  onBack: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchSQSQueueDetail(queueName, activeEndpoint), [queueName, activeEndpoint])
  const { data: detail, loading, error, refresh } = useFetch<SQSQueueDetail>(fetcher, 10000)
  const [modal, setModal] = useState<ModalKind | null>(null)

  const closeModal = () => setModal(null)
  const doneAndRefresh = () => {
    setModal(null)
    refresh()
  }

  if (loading && !detail) return <StatusIndicator type="loading">Loading queue</StatusIndicator>
  if (error && !detail) {
    return (
      <Alert type="error" header="Could not load queue" action={<Button onClick={() => refresh()}>Retry</Button>}>
        {error}
      </Alert>
    )
  }
  if (!detail) return null

  const total =
    detail.approximateNumberOfMessages + detail.approximateNumberOfMessagesNotVisible + detail.approximateNumberOfMessagesDelayed

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description={detail.arn}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onBack}>Back to queues</Button>
            <Button iconName="refresh" onClick={() => refresh()} ariaLabel="Refresh queue" />
            <Button onClick={() => setModal('send')}>Send message</Button>
            <Button onClick={() => setModal('batch-send')}>Send batch</Button>
            <Button onClick={() => setModal('settings')}>Edit</Button>
            <Button onClick={() => setModal('purge')}>Purge</Button>
            <Button onClick={() => setModal('delete')}>Delete</Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween direction="horizontal" size="xs">
          {detail.name}
          {starButton(detail.name, favorites, toggleFavorite)}
          <Badge color={detail.type === 'FIFO' ? 'blue' : 'grey'}>{detail.type}</Badge>
          <Badge color="green">{detail.approximateNumberOfMessages} available</Badge>
          <Badge color="grey">{total} total</Badge>
        </SpaceBetween>
      </Header>

      <Tabs
        tabs={[
          {
            id: 'messages',
            label: 'Messages',
            content: <MessagesPanel queue={detail} onCountsChanged={refresh} />,
          },
          {
            id: 'saved',
            label: 'Saved messages',
            content: <SavedMessagesPanel queue={detail} onCountsChanged={refresh} />,
          },
          {
            id: 'config',
            label: 'Configuration',
            content: <ConfigPanel detail={detail} />,
          },
          {
            id: 'tags',
            label: 'Tags',
            content: <TagsPanel queueName={detail.name} />,
          },
        ]}
      />

      {modal === 'send' && <SendMessageModal queue={detail} onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'batch-send' && <BatchSendModal queue={detail} onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'settings' && <EditSettingsModal queue={detail} onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'purge' && <ConfirmActionModal queue={detail} action="purge" onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'delete' && (
        <ConfirmActionModal
          queue={detail}
          action="delete"
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

export function CloudscapeSQSBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedQueueName = searchParams.get('queue')
  const queuesFetcher = useCallback(() => fetchSQSQueues(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ queues: SQSQueue[] }>(queuesFetcher, 10000)
  const [selected, setSelected] = useState<SQSQueue | null>(null)
  const [modal, setModal] = useState<ModalKind | null>(null)
  const { favorites, toggle: toggleFavorite } = useSqsQueueFavorites()

  const queues = data?.queues ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(queues, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const openQueue = useCallback(
    (name: string) => setSearchParams({ queue: name }),
    [setSearchParams],
  )
  const backToList = useCallback(() => {
    setSearchParams({})
    refresh()
  }, [setSearchParams, refresh])

  const closeModal = () => setModal(null)
  const doneAndRefresh = () => {
    setModal(null)
    refresh()
  }
  const doneDeleted = () => {
    setModal(null)
    setSelected(null)
    refresh()
  }

  // j/k/Enter keyboard navigation over the visible page, ported from the legacy browser.
  useEffect(() => {
    if (selectedQueueName) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'j' || e.key === 'k') {
        setSelected((prev) => {
          const list = items as SQSQueue[]
          if (list.length === 0) return prev
          const idx = prev ? list.findIndex((q) => q.name === prev.name) : -1
          const next = e.key === 'j' ? Math.min(idx + 1, list.length - 1) : Math.max(idx - 1, 0)
          return list[next] ?? prev
        })
      } else if (e.key === 'Enter') {
        setSelected((prev) => {
          if (prev) openQueue(prev.name)
          return prev
        })
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [items, selectedQueueName, openQueue])

  // Deep-linked queue detail (?queue=name), matching the legacy view
  if (selectedQueueName) {
    return (
      <QueueDetailView
        queueName={selectedQueueName}
        favorites={favorites}
        toggleFavorite={toggleFavorite}
        onBack={backToList}
      />
    )
  }

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load queues" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Table
        {...collectionProps}
        items={items}
        trackBy="name"
        loading={loading && !data}
        loadingText="Loading queues"
        selectionType="single"
        selectedItems={selected ? [selected] : []}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems[0] ?? null)}
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h2"
            counter={data ? `(${queues.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh queues" />
                <Button disabled={!selected} onClick={() => setModal('send')}>
                  Send message
                </Button>
                <Button disabled={!selected} onClick={() => selected && openQueue(selected.name)}>
                  View details
                </Button>
                <Button disabled={!selected} onClick={() => setModal('purge')}>
                  Purge
                </Button>
                <Button disabled={!selected} onClick={() => setModal('delete')}>
                  Delete
                </Button>
                <Button variant="primary" onClick={() => setModal('create')}>
                  Create queue
                </Button>
              </SpaceBetween>
            }
          >
            Queues
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find a queue"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" padding="l">
            <SpaceBetween size="s">
              <Box>No queues yet</Box>
              <Button onClick={() => setModal('create')}>Create queue</Button>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: 'favorite',
            header: '',
            width: 56,
            cell: (q) => starButton(q.name, favorites, toggleFavorite),
          },
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (q) => (
              <Link
                href={`?queue=${encodeURIComponent(q.name)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  openQueue(q.name)
                }}
              >
                {q.name}
              </Link>
            ),
          },
          {
            id: 'type',
            header: 'Type',
            sortingField: 'type',
            cell: (q) => <Badge color={q.type === 'FIFO' ? 'blue' : 'grey'}>{q.type}</Badge>,
          },
          {
            id: 'available',
            header: 'Available',
            sortingField: 'approximateNumberOfMessages',
            cell: (q) => q.approximateNumberOfMessages,
          },
          {
            id: 'inflight',
            header: 'In flight',
            sortingField: 'approximateNumberOfMessagesNotVisible',
            cell: (q) => q.approximateNumberOfMessagesNotVisible,
          },
          {
            id: 'delayed',
            header: 'Delayed',
            sortingField: 'approximateNumberOfMessagesDelayed',
            cell: (q) => q.approximateNumberOfMessagesDelayed,
          },
          {
            id: 'visibility',
            header: 'Visibility timeout',
            cell: (q) => `${q.visibilityTimeout}s`,
          },
          {
            id: 'dlq',
            header: 'DLQ',
            cell: (q) =>
              q.redrivePolicy ? (
                <StatusIndicator type="info">max {q.redrivePolicy.maxReceiveCount}</StatusIndicator>
              ) : (
                '—'
              ),
          },
        ]}
      />

      {modal === 'create' && <CreateQueueModal onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'send' && selected && <SendMessageModal queue={selected} onClose={closeModal} onDone={doneAndRefresh} />}
      {modal === 'purge' && selected && (
        <ConfirmActionModal queue={selected} action="purge" onClose={closeModal} onDone={doneAndRefresh} />
      )}
      {modal === 'delete' && selected && (
        <ConfirmActionModal queue={selected} action="delete" onClose={closeModal} onDone={doneDeleted} />
      )}
    </SpaceBetween>
  )
}
