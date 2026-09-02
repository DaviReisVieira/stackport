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
  updateResourceTags,
  updateSQSQueueAttributes,
  updateSQSRedrivePolicy,
} from '@/lib/api'
import type { SQSMessage, SQSQueue, SQSQueueDetail } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

type ModalKind = 'create' | 'send' | 'settings' | 'purge' | 'delete'

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
  const [messages, setMessages] = useState<SQSMessage[]>([])
  const [selected, setSelected] = useState<SQSMessage[]>([])
  const [viewing, setViewing] = useState<SQSMessage | null>(null)
  const [polling, setPolling] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
            width: 90,
            cell: (m) => (
              <Button variant="inline-link" onClick={() => deleteOne(m)}>
                Delete
              </Button>
            ),
          },
        ]}
      />
      {viewing && <MessageViewerModal message={viewing} onClose={() => setViewing(null)} />}
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
