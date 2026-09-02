import { useCallback, useState } from 'react'
import { useCollection } from '@cloudscape-design/collection-hooks'
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
import Pagination from '@cloudscape-design/components/pagination'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  createSQSQueue,
  deleteSQSMessage,
  deleteSQSQueue,
  fetchSQSQueues,
  purgeSQSQueue,
  receiveSQSMessages,
  sendSQSMessage,
  updateSQSQueueAttributes,
} from '@/lib/api'
import type { SQSMessage, SQSQueue } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

type ModalKind = 'create' | 'send' | 'messages' | 'settings' | 'purge' | 'delete'

function CreateQueueModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [fifo, setFifo] = useState(false)
  const [dedup, setDedup] = useState(false)
  const [visibility, setVisibility] = useState('30')
  const [retention, setRetention] = useState('345600')
  const [delay, setDelay] = useState('0')
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
        },
        activeEndpoint,
      )
      toast.success(`Queue '${queueName}' created`)
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
            <FormField label="Delivery delay (seconds)">
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

function MessagesModal({ queue, onClose }: { queue: SQSQueue; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [messages, setMessages] = useState<SQSMessage[]>([])
  const [polling, setPolling] = useState(false)

  const poll = useCallback(async () => {
    setPolling(true)
    try {
      const result = await receiveSQSMessages(queue.name, 10, 0, activeEndpoint)
      setMessages(result.messages)
      if (result.messages.length === 0) toast.info('No messages available')
    } catch (error) {
      toast.error(`Failed to receive messages: ${error}`)
    } finally {
      setPolling(false)
    }
  }, [queue.name, activeEndpoint])

  const remove = async (message: SQSMessage) => {
    try {
      await deleteSQSMessage(queue.name, message.receiptHandle, activeEndpoint)
      setMessages((prev) => prev.filter((m) => m.messageId !== message.messageId))
      toast.success('Message deleted')
    } catch (error) {
      toast.error(`Failed to delete message: ${error}`)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Messages in ${queue.name}`} size="large">
      <SpaceBetween size="m">
        <Box color="text-body-secondary" fontSize="body-s">
          Polling peeks up to 10 messages with visibility timeout 0, so they stay available to consumers.
        </Box>
        <Button iconName="refresh" onClick={poll} loading={polling}>
          Poll for messages
        </Button>
        <Table
          items={messages}
          trackBy="messageId"
          variant="embedded"
          empty={<Box textAlign="center">No messages polled yet</Box>}
          columnDefinitions={[
            {
              id: 'id',
              header: 'Message ID',
              cell: (m) => <Box fontSize="body-s">{m.messageId}</Box>,
            },
            {
              id: 'body',
              header: 'Body',
              cell: (m) => (
                <Box fontSize="body-s">{m.body.length > 120 ? `${m.body.slice(0, 117)}...` : m.body}</Box>
              ),
            },
            {
              id: 'actions',
              header: '',
              width: 90,
              cell: (m) => (
                <Button variant="inline-link" onClick={() => remove(m)}>
                  Delete
                </Button>
              ),
            },
          ]}
        />
      </SpaceBetween>
    </Modal>
  )
}

function EditSettingsModal({ queue, onClose, onDone }: { queue: SQSQueue; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [visibility, setVisibility] = useState(String(queue.visibilityTimeout))
  const [retention, setRetention] = useState(String(queue.messageRetentionPeriod))
  const [delay, setDelay] = useState(String(queue.delaySeconds))
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
        },
        activeEndpoint,
      )
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

export function CloudscapeSQSBrowser() {
  const { activeEndpoint } = useEndpoint()
  const queuesFetcher = useCallback(() => fetchSQSQueues(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ queues: SQSQueue[] }>(queuesFetcher, 10000)
  const [selected, setSelected] = useState<SQSQueue | null>(null)
  const [modal, setModal] = useState<ModalKind | null>(null)

  const queues = data?.queues ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(queues, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

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
                <Button disabled={!selected} onClick={() => setModal('messages')}>
                  View messages
                </Button>
                <Button disabled={!selected} onClick={() => setModal('settings')}>
                  Edit
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
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (q) => q.name,
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
      {modal === 'messages' && selected && <MessagesModal queue={selected} onClose={closeModal} />}
      {modal === 'settings' && selected && (
        <EditSettingsModal queue={selected} onClose={closeModal} onDone={doneAndRefresh} />
      )}
      {modal === 'purge' && selected && (
        <ConfirmActionModal queue={selected} action="purge" onClose={closeModal} onDone={doneAndRefresh} />
      )}
      {modal === 'delete' && selected && (
        <ConfirmActionModal queue={selected} action="delete" onClose={closeModal} onDone={doneDeleted} />
      )}
    </SpaceBetween>
  )
}
