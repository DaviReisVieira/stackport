import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Autosuggest from '@cloudscape-design/components/autosuggest'
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
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  createSNSTopic,
  deleteSNSTopic,
  fetchResources,
  fetchSNSTopic,
  fetchSNSTopics,
  publishSNSMessage,
  subscribeSNSTopic,
  unsubscribeSNS,
} from '@/lib/api'
import type { SNSSubscription, SNSTopic, SNSTopicDetail } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

const PROTOCOL_OPTIONS = [
  { label: 'SQS queue', value: 'sqs' },
  { label: 'Lambda function', value: 'lambda' },
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS', value: 'https' },
  { label: 'Email', value: 'email' },
]

// --- Create topic -----------------------------------------------------------

function CreateTopicModal({ onClose, onDone }: { onClose: () => void; onDone: (arn: string) => void }) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [fifo, setFifo] = useState(false)
  const [dedup, setDedup] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const created = await createSNSTopic(
        {
          name: name.trim(),
          displayName: displayName.trim() || undefined,
          fifo,
          contentBasedDeduplication: fifo ? dedup : undefined,
        },
        activeEndpoint,
      )
      toast.success(`Topic '${created.name}' created`)
      onDone(created.arn)
    } catch (error) {
      toast.error(`Failed to create topic: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header="Create topic" size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={!name.trim()} data-testid="create-topic-submit">
              Create topic
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Topic name" description={fifo ? '.fifo is appended automatically' : undefined}>
            <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="order-events" autoFocus />
          </FormField>
          <FormField label="Display name" description="Optional">
            <Input value={displayName} onChange={({ detail }) => setDisplayName(detail.value)} />
          </FormField>
          <Checkbox checked={fifo} onChange={({ detail }) => setFifo(detail.checked)}>
            FIFO topic
          </Checkbox>
          {fifo && (
            <Checkbox checked={dedup} onChange={({ detail }) => setDedup(detail.checked)}>
              Content-based deduplication
            </Checkbox>
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

// --- Publish ------------------------------------------------------------------

function PublishModal({ topic, onClose }: { topic: SNSTopicDetail; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [groupId, setGroupId] = useState('')
  const [dedupId, setDedupId] = useState('')
  const [attributes, setAttributes] = useState<Array<{ key: string; value: string }>>([])
  const [sending, setSending] = useState(false)

  const submit = async () => {
    setSending(true)
    try {
      const messageAttributes = Object.fromEntries(
        attributes
          .filter((a) => a.key.trim())
          .map((a) => [a.key.trim(), { dataType: 'String', stringValue: a.value }]),
      )
      const result = await publishSNSMessage(
        topic.arn,
        {
          message,
          subject: subject.trim() || undefined,
          messageGroupId: topic.fifo ? groupId : undefined,
          messageDeduplicationId: topic.fifo && dedupId ? dedupId : undefined,
          messageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
        },
        activeEndpoint,
      )
      toast.success(`Message published (${result.messageId})`)
      onClose()
    } catch (error) {
      toast.error(`Failed to publish: ${error}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Publish to ${topic.name}`} size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={sending}
              disabled={!message.trim() || (topic.fifo && !groupId.trim())}
              data-testid="publish-submit"
            >
              Publish message
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Subject" description="Optional">
            <Input value={subject} onChange={({ detail }) => setSubject(detail.value)} />
          </FormField>
          <FormField label="Message body">
            <Textarea value={message} onChange={({ detail }) => setMessage(detail.value)} rows={6} spellcheck={false} />
          </FormField>
          {topic.fifo && (
            <>
              <FormField label="Message group ID" description="Required for FIFO topics">
                <Input value={groupId} onChange={({ detail }) => setGroupId(detail.value)} />
              </FormField>
              <FormField label="Message deduplication ID" description="Optional if content-based deduplication is enabled">
                <Input value={dedupId} onChange={({ detail }) => setDedupId(detail.value)} />
              </FormField>
            </>
          )}
          <ExpandableSection headerText="Message attributes">
            <SpaceBetween size="s">
              {attributes.map((attr, index) => (
                <ColumnLayout key={index} columns={3}>
                  <Input
                    value={attr.key}
                    onChange={({ detail }) => setAttributes(attributes.map((a, i) => (i === index ? { ...a, key: detail.value } : a)))}
                    placeholder="Key"
                    ariaLabel={`Attribute ${index + 1} key`}
                  />
                  <Input
                    value={attr.value}
                    onChange={({ detail }) => setAttributes(attributes.map((a, i) => (i === index ? { ...a, value: detail.value } : a)))}
                    placeholder="Value"
                    ariaLabel={`Attribute ${index + 1} value`}
                  />
                  <Button
                    variant="icon"
                    iconName="remove"
                    ariaLabel={`Remove attribute ${index + 1}`}
                    onClick={() => setAttributes(attributes.filter((_, i) => i !== index))}
                  />
                </ColumnLayout>
              ))}
              <Button iconName="add-plus" onClick={() => setAttributes([...attributes, { key: '', value: '' }])}>
                Add attribute
              </Button>
            </SpaceBetween>
          </ExpandableSection>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

// --- Subscribe ------------------------------------------------------------------

function SubscribeModal({ topic, onClose, onDone }: { topic: SNSTopicDetail; onClose: () => void; onDone: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const [protocol, setProtocol] = useState('sqs')
  const [target, setTarget] = useState('')
  const [filterPolicy, setFilterPolicy] = useState('')
  const [suggestions, setSuggestions] = useState<Array<{ value: string; label?: string; description?: string }>>([])
  const [saving, setSaving] = useState(false)

  // Live ARN suggestions for SQS queues and Lambda functions
  useEffect(() => {
    let cancelled = false
    setSuggestions([])
    const source =
      protocol === 'sqs'
        ? { service: 'sqs', type: 'queues' }
        : protocol === 'lambda'
          ? { service: 'lambda', type: 'functions' }
          : null
    if (!source) return
    fetchResources(source.service, source.type, activeEndpoint)
      .then((resp) => {
        if (cancelled) return
        const items = (resp.resources[source.type] ?? []) as Array<Record<string, unknown>>
        const options = items.map((item) => {
          if (protocol === 'lambda') {
            const label = (item.FunctionName as string) || (item.id as string)
            return { value: (item.FunctionArn as string) || `arn:aws:lambda:::function:${item.id}`, label, description: item.FunctionArn as string }
          }
          const url = item.id as string
          const parts = url.replace(/https?:\/\//, '').split('/')
          const accountId = parts[1] || '000000000000'
          const queueName = parts[2] || url.split('/').pop() || url
          const arn = `arn:aws:sqs:us-east-1:${accountId}:${queueName}`
          return { value: arn, label: queueName, description: arn }
        })
        setSuggestions(options)
      })
      .catch(() => {
        if (!cancelled) setSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [protocol, activeEndpoint])

  const submit = async () => {
    let parsedPolicy: Record<string, unknown> | undefined
    if (filterPolicy.trim()) {
      try {
        parsedPolicy = JSON.parse(filterPolicy)
      } catch {
        toast.error('Filter policy must be valid JSON')
        return
      }
    }
    setSaving(true)
    try {
      await subscribeSNSTopic(topic.arn, { protocol, endpoint: target.trim(), filterPolicy: parsedPolicy }, activeEndpoint)
      toast.success('Subscription created')
      onDone()
    } catch (error) {
      toast.error(`Failed to subscribe: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={`Subscribe to ${topic.name}`} size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={!target.trim()} data-testid="subscribe-submit">
              Subscribe
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <FormField label="Protocol">
            <Select
              selectedOption={PROTOCOL_OPTIONS.find((o) => o.value === protocol) ?? PROTOCOL_OPTIONS[0]}
              onChange={({ detail }) => {
                setProtocol(detail.selectedOption.value as string)
                setTarget('')
              }}
              options={PROTOCOL_OPTIONS}
            />
          </FormField>
          <FormField
            label="Endpoint"
            description={
              protocol === 'sqs' || protocol === 'lambda' ? 'Pick a live resource or type an ARN' : 'Destination URL or address'
            }
          >
            <Autosuggest
              value={target}
              onChange={({ detail }) => setTarget(detail.value)}
              options={suggestions}
              placeholder={protocol === 'email' ? 'someone@example.com' : protocol.startsWith('http') ? 'https://example.com/hook' : `${protocol} ARN`}
              empty="No live resources found. Type the endpoint manually."
              enteredTextLabel={(value) => `Use "${value}"`}
              ariaLabel="Subscription endpoint"
            />
          </FormField>
          <FormField label="Filter policy" description="Optional JSON, e.g. {&quot;type&quot;: [&quot;order&quot;]}">
            <Textarea value={filterPolicy} onChange={({ detail }) => setFilterPolicy(detail.value)} rows={4} spellcheck={false} />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

// --- Topic detail ------------------------------------------------------------------

type DetailModal = 'publish' | 'subscribe' | 'delete'

function FilterPolicyBadge({ subscription }: { subscription: SNSSubscription }) {
  const [open, setOpen] = useState(false)
  if (!subscription.filterPolicy) return <Box color="text-status-inactive">—</Box>
  return (
    <>
      <Button variant="inline-link" onClick={() => setOpen(true)}>
        View policy
      </Button>
      {open && (
        <Modal visible onDismiss={() => setOpen(false)} header="Filter policy" size="small">
          <Box variant="code">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
              {typeof subscription.filterPolicy === 'string'
                ? subscription.filterPolicy
                : JSON.stringify(subscription.filterPolicy, null, 2)}
            </pre>
          </Box>
        </Modal>
      )}
    </>
  )
}

function TopicDetailView({ arn, onBack }: { arn: string; onBack: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchSNSTopic(arn, activeEndpoint), [arn, activeEndpoint])
  const { data: topic, loading, error, refresh } = useFetch<SNSTopicDetail>(fetcher, 10000)
  const [modal, setModal] = useState<DetailModal | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const doDelete = async () => {
    if (!topic) return
    setDeleting(true)
    try {
      await deleteSNSTopic(topic.arn, activeEndpoint)
      toast.success(`Topic '${topic.name}' deleted`)
      onBack()
    } catch (err) {
      toast.error(`Failed to delete topic: ${err}`)
    } finally {
      setDeleting(false)
    }
  }

  const unsubscribe = async (subscription: SNSSubscription) => {
    try {
      await unsubscribeSNS(subscription.arn, activeEndpoint)
      toast.success('Subscription removed')
      refresh()
    } catch (err) {
      toast.error(`Failed to unsubscribe: ${err}`)
    }
  }

  if (loading && !topic) return <StatusIndicator type="loading">Loading topic</StatusIndicator>
  if (error && !topic) {
    return (
      <Alert type="error" header="Could not load topic" action={<Button onClick={() => refresh()}>Retry</Button>}>
        {error}
      </Alert>
    )
  }
  if (!topic) return null

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description={topic.arn}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onBack}>Back to topics</Button>
            <Button iconName="refresh" onClick={() => refresh()} ariaLabel="Refresh topic" />
            <Button variant="primary" onClick={() => setModal('publish')}>
              Publish message
            </Button>
            <Button onClick={() => setModal('subscribe')}>Subscribe</Button>
            <Button onClick={() => setModal('delete')}>Delete</Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween direction="horizontal" size="xs">
          {topic.name}
          <Badge color={topic.fifo ? 'blue' : 'grey'}>{topic.fifo ? 'FIFO' : 'Standard'}</Badge>
          <Badge color="green">{topic.subscriptionsConfirmed} subscriptions</Badge>
        </SpaceBetween>
      </Header>

      <Tabs
        tabs={[
          {
            id: 'subscriptions',
            label: `Subscriptions (${topic.subscriptions.length})`,
            content: (
              <Table
                items={topic.subscriptions}
                trackBy="arn"
                variant="embedded"
                empty={
                  <Box textAlign="center" padding="l" color="text-status-inactive">
                    No subscriptions yet
                  </Box>
                }
                columnDefinitions={[
                  { id: 'protocol', header: 'Protocol', cell: (s) => <Badge color="grey">{s.protocol}</Badge> },
                  { id: 'endpoint', header: 'Endpoint', cell: (s) => s.endpoint },
                  {
                    id: 'status',
                    header: 'Status',
                    cell: (s) =>
                      s.pending ? (
                        <StatusIndicator type="pending">Pending confirmation</StatusIndicator>
                      ) : (
                        <StatusIndicator type="success">Confirmed</StatusIndicator>
                      ),
                  },
                  { id: 'filter', header: 'Filter policy', cell: (s) => <FilterPolicyBadge subscription={s} /> },
                  {
                    id: 'actions',
                    header: '',
                    cell: (s) => (
                      <Button
                        variant="inline-link"
                        disabled={s.pending}
                        onClick={() => void unsubscribe(s)}
                        ariaLabel={`Unsubscribe ${s.endpoint}`}
                      >
                        Unsubscribe
                      </Button>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            id: 'attributes',
            label: 'Attributes',
            content: (
              <ColumnLayout columns={2} variant="text-grid">
                {Object.entries(topic.attributes).map(([key, value]) => (
                  <div key={key}>
                    <Box variant="awsui-key-label">{key}</Box>
                    <Box fontSize="body-s">{value || '—'}</Box>
                  </div>
                ))}
              </ColumnLayout>
            ),
          },
        ]}
      />

      {modal === 'publish' && <PublishModal topic={topic} onClose={() => setModal(null)} />}
      {modal === 'subscribe' && (
        <SubscribeModal
          topic={topic}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null)
            refresh()
          }}
        />
      )}
      {modal === 'delete' && (
        <Modal
          visible
          onDismiss={() => setModal(null)}
          header={`Delete ${topic.name}`}
          size="medium"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setModal(null)} disabled={deleting}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void doDelete()}
                  loading={deleting}
                  disabled={confirmText !== topic.name}
                  data-testid="confirm-delete-topic"
                >
                  Delete topic
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Alert type="warning">Deleting the topic removes all of its subscriptions. This cannot be undone.</Alert>
            <FormField label="Type the topic name to confirm">
              <Input value={confirmText} onChange={({ detail }) => setConfirmText(detail.value)} placeholder={topic.name} />
            </FormField>
          </SpaceBetween>
        </Modal>
      )}
    </SpaceBetween>
  )
}

// --- Root --------------------------------------------------------------------------

export function CloudscapeSNSBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTopic = searchParams.get('topic')

  const topicsFetcher = useCallback(() => fetchSNSTopics(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ topics: SNSTopic[] }>(topicsFetcher, 10000)
  const [creating, setCreating] = useState(false)

  const topics = data?.topics ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(topics, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const openTopic = useCallback((arn: string) => setSearchParams({ topic: arn }), [setSearchParams])
  const backToList = useCallback(() => {
    setSearchParams({})
    refresh()
  }, [setSearchParams, refresh])

  if (selectedTopic) {
    return <TopicDetailView arn={selectedTopic} onBack={backToList} />
  }

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load topics" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Table
        {...collectionProps}
        items={items}
        trackBy="arn"
        loading={loading && !data}
        loadingText="Loading topics"
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h2"
            counter={data ? `(${topics.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh topics" />
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create topic
                </Button>
              </SpaceBetween>
            }
          >
            Topics
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find a topic"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" padding="l">
            <SpaceBetween size="s">
              <Box>No topics yet</Box>
              <Button onClick={() => setCreating(true)}>Create topic</Button>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (t) => (
              <Link
                href={`?topic=${encodeURIComponent(t.arn)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  openTopic(t.arn)
                }}
              >
                {t.name}
              </Link>
            ),
          },
          {
            id: 'type',
            header: 'Type',
            sortingField: 'fifo',
            cell: (t) => <Badge color={t.fifo ? 'blue' : 'grey'}>{t.fifo ? 'FIFO' : 'Standard'}</Badge>,
          },
          { id: 'displayName', header: 'Display name', cell: (t) => t.displayName || '—' },
          {
            id: 'subscriptions',
            header: 'Subscriptions',
            sortingField: 'subscriptionsConfirmed',
            cell: (t) =>
              t.subscriptionsPending > 0
                ? `${t.subscriptionsConfirmed} confirmed, ${t.subscriptionsPending} pending`
                : t.subscriptionsConfirmed,
          },
        ]}
      />

      {creating && (
        <CreateTopicModal
          onClose={() => setCreating(false)}
          onDone={(arn) => {
            setCreating(false)
            refresh()
            openTopic(arn)
          }}
        />
      )}
    </SpaceBetween>
  )
}
