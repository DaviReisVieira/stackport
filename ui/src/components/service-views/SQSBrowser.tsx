import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchSQSQueues,
  fetchSQSQueueDetail,
  sendSQSMessage,
  receiveSQSMessages,
  deleteSQSMessage,
  purgeSQSQueue,
  createSQSQueue,
  deleteSQSQueue,
  updateSQSQueueAttributes,
  sendSQSMessagesBatch,
  deleteSQSMessagesBatch,
  updateSQSRedrivePolicy,
  updateResourceTags
} from '@/lib/api'
import type {
  SQSQueue,
  SQSQueueDetail,
  SQSMessage,
  SQSSendMessageRequest,
  SQSCreateQueueRequest,
  SQSBatchSendRequest,
  SQSUpdateAttributesRequest,
  SQSFavoriteMessage,
} from '@/lib/types'
import { useSQSFavoriteMessages } from '@/hooks/useSQSFavoriteMessages'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { JsonViewer } from '@/components/JsonViewer'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { TagsSection, TagCountBadge } from '@/components/TagsSection'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ExportDropdown } from '@/components/ExportDropdown'
import { toast } from 'sonner'
import {
  Inbox,
  Send,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Eye,
  Copy,
  RefreshCw,
  Plus,
  Settings,
  CheckSquare,
  Square,
  Edit,
  Star,
} from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

function formatNumber(num: number): string {
  if (num === 0) return '0'
  if (num < 1000) return String(num)
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`
  return `${(num / 1000000).toFixed(1)}M`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function QueueTypeBadge({ type }: { type: 'Standard' | 'FIFO' }) {
  const color = type === 'FIFO' ? 'bg-purple-500' : 'bg-blue-500'
  return (
    <Badge variant="secondary" className={`${color} text-white`}>
      {type}
    </Badge>
  )
}

function QueueDepthBadge({ count }: { count: number }) {
  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'secondary'
  let label = 'Empty'

  if (count === 0) {
    variant = 'outline'
    label = 'Empty'
  } else if (count < 10) {
    variant = 'secondary'
    label = 'Low'
  } else if (count < 100) {
    variant = 'default'
    label = 'Medium'
  } else {
    variant = 'destructive'
    label = 'High'
  }

  return (
    <Badge variant={variant}>
      ~{formatNumber(count)} {label}
    </Badge>
  )
}

function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, totalItems)

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {start}–{end} of {totalItems}
        </span>
        <Separator orientation="vertical" className="h-4" />
        <span>Rows:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground px-2">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function CreateQueueSheet({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  // Basic settings
  const [queueName, setQueueName] = useState('')
  const [queueType, setQueueType] = useState<'Standard' | 'FIFO'>('Standard')
  const [contentBasedDeduplication, setContentBasedDeduplication] = useState(false)
  const [visibilityTimeout, setVisibilityTimeout] = useState(30)
  const [messageRetentionPeriod, setMessageRetentionPeriod] = useState(345600)
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [maximumMessageSize, setMaximumMessageSize] = useState(262144)
  const [receiveMessageWaitTime, setReceiveMessageWaitTime] = useState(0)

  // Advanced settings
  const [dlqEnabled, setDlqEnabled] = useState(false)
  const [maxReceiveCount, setMaxReceiveCount] = useState(5)
  const [sqsManagedSseEnabled, setSqsManagedSseEnabled] = useState(true)
  const [kmsMasterKeyId, setKmsMasterKeyId] = useState('')
  const [tags, setTags] = useState<Record<string, string>>({})
  const [tagKey, setTagKey] = useState('')
  const [tagValue, setTagValue] = useState('')

  const [creating, setCreating] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')

  const isFifo = queueType === 'FIFO'

  const handleCreate = async () => {
    if (!queueName.trim()) {
      toast.error('Queue name is required')
      return
    }

    try {
      setCreating(true)
      const request: SQSCreateQueueRequest = {
        queueName: queueName.trim(),
        queueType,
        contentBasedDeduplication: contentBasedDeduplication || undefined,
        visibilityTimeout,
        messageRetentionPeriod,
        delaySeconds,
        maximumMessageSize,
        receiveMessageWaitTime,
        sqsManagedSseEnabled,
        kmsMasterKeyId: !sqsManagedSseEnabled ? kmsMasterKeyId || undefined : undefined,
        dlqEnabled,
        maxReceiveCount: dlqEnabled ? maxReceiveCount : undefined,
      }

      // Don't send redrivePolicy - let backend handle DLQ creation

      if (Object.keys(tags).length > 0) {
        request.tags = tags
      }

      const response = await createSQSQueue(request)
      toast.success(`Queue created: ${response.queueName}`)

      // Reset form
      setQueueName('')
      setQueueType('Standard')
      setContentBasedDeduplication(false)
      setVisibilityTimeout(30)
      setMessageRetentionPeriod(345600)
      setDelaySeconds(0)
      setMaximumMessageSize(262144)
      setReceiveMessageWaitTime(0)
      setDlqEnabled(false)
      setMaxReceiveCount(5)
      setSqsManagedSseEnabled(true)
      setKmsMasterKeyId('')
      setTags({})
      setTagKey('')
      setTagValue('')
      setActiveTab('basic')

      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to create queue: ${error}`)
    } finally {
      setCreating(false)
    }
  }

  const addTag = () => {
    if (tagKey.trim() && tagValue.trim()) {
      setTags({ ...tags, [tagKey.trim()]: tagValue.trim() })
      setTagKey('')
      setTagValue('')
    }
  }

  const removeTag = (key: string) => {
    const newTags = { ...tags }
    delete newTags[key]
    setTags(newTags)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create SQS Queue
          </SheetTitle>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">Basic Settings</TabsTrigger>
            <TabsTrigger value="advanced">
              <Settings className="h-4 w-4 mr-1" />
              Advanced
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="queue-name">Queue Name *</Label>
              <Input
                id="queue-name"
                value={queueName}
                onChange={(e) => setQueueName(e.target.value)}
                placeholder="my-queue or my-queue.fifo"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Alphanumeric, hyphens, and underscores. For FIFO queues, <code>.fifo</code> will be auto-appended if not provided.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="queue-type">Queue Type</Label>
              <Select value={queueType} onValueChange={(v: 'Standard' | 'FIFO') => setQueueType(v)}>
                <SelectTrigger id="queue-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Standard">Standard</SelectItem>
                  <SelectItem value="FIFO">FIFO (First-In-First-Out)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isFifo && (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="content-dedup">Content-Based Deduplication</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable deduplication based on message body SHA-256 hash
                  </p>
                </div>
                <Switch
                  id="content-dedup"
                  checked={contentBasedDeduplication}
                  onCheckedChange={setContentBasedDeduplication}
                />
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="visibility-timeout">Visibility Timeout (seconds)</Label>
              <Input
                id="visibility-timeout"
                type="number"
                min="0"
                max="43200"
                value={visibilityTimeout}
                onChange={(e) => setVisibilityTimeout(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">0-43200 seconds. Default: 30</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message-retention">Message Retention Period (seconds)</Label>
              <Input
                id="message-retention"
                type="number"
                min="60"
                max="1209600"
                value={messageRetentionPeriod}
                onChange={(e) => setMessageRetentionPeriod(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">60-1209600 seconds (4 days). Default: 345600</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delay-seconds">Delivery Delay (seconds)</Label>
              <Input
                id="delay-seconds"
                type="number"
                min="0"
                max="900"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">0-900 seconds. Default: 0</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-message-size">Maximum Message Size (bytes)</Label>
              <Input
                id="max-message-size"
                type="number"
                min="1024"
                max="262144"
                value={maximumMessageSize}
                onChange={(e) => setMaximumMessageSize(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">1024-262144 bytes. Default: 262144 (256 KB)</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receive-wait-time">Receive Message Wait Time (seconds)</Label>
              <Input
                id="receive-wait-time"
                type="number"
                min="0"
                max="20"
                value={receiveMessageWaitTime}
                onChange={(e) => setReceiveMessageWaitTime(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">0-20 seconds for long polling. Default: 0</p>
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="dlq-enabled">Enable Dead-Letter Queue</Label>
                  <p className="text-xs text-muted-foreground">
                    Redirect failed messages to a DLQ after max receive count. A DLQ queue named "<code>{queueName || 'my-queue'}-dlq</code>" will be created automatically.
                  </p>
                </div>
                <Switch id="dlq-enabled" checked={dlqEnabled} onCheckedChange={setDlqEnabled} />
              </div>

              {dlqEnabled && (
                <div className="space-y-3 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label htmlFor="max-receive-count">Max Receive Count</Label>
                    <Input
                      id="max-receive-count"
                      type="number"
                      min="1"
                      max="1000"
                      value={maxReceiveCount}
                      onChange={(e) => setMaxReceiveCount(Number(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">Messages will be moved to DLQ after failing this many times. Default: 5</p>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="sse-managed">SQS-Managed Encryption (SSE)</Label>
                  <p className="text-xs text-muted-foreground">
                    Use SQS-owned encryption keys. Disable to use custom KMS key.
                  </p>
                </div>
                <Switch
                  id="sse-managed"
                  checked={sqsManagedSseEnabled}
                  onCheckedChange={setSqsManagedSseEnabled}
                />
              </div>

              {!sqsManagedSseEnabled && (
                <div className="space-y-2 pl-4 border-l-2 border-muted">
                  <Label htmlFor="kms-key-id">KMS Master Key ID</Label>
                  <Input
                    id="kms-key-id"
                    value={kmsMasterKeyId}
                    onChange={(e) => setKmsMasterKeyId(e.target.value)}
                    placeholder="alias/my-key or key-id"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    KMS key ARN, alias, or ID for server-side encryption
                  </p>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Key"
                  value={tagKey}
                  onChange={(e) => setTagKey(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="Value"
                  value={tagValue}
                  onChange={(e) => setTagValue(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={addTag}>
                  Add
                </Button>
              </div>
              {Object.keys(tags).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(tags).map(([key, value]) => (
                    <Badge key={key} variant="secondary" className="text-xs">
                      {TagIcon && <TagIcon className="h-3 w-3 mr-1" />}
                      {key}: {value}
                      <button
                        type="button"
                        onClick={() => removeTag(key)}
                        className="ml-1 hover:text-destructive"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2 mt-6">
          <Button onClick={handleCreate} disabled={creating} className="flex-1">
            <Plus className="h-4 w-4 mr-2" />
            {creating ? 'Creating...' : 'Create Queue'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SendMessageSheet({
  queue,
  open,
  onOpenChange,
  onSuccess,
}: {
  queue: SQSQueueDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [messageBody, setMessageBody] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [messageGroupId, setMessageGroupId] = useState('')
  const [messageDeduplicationId, setMessageDeduplicationId] = useState('')
  const [sending, setSending] = useState(false)

  const isFifo = queue?.type === 'FIFO'

  const handleSend = async () => {
    if (!queue || !messageBody.trim()) {
      toast.error('Message body is required')
      return
    }

    try {
      setSending(true)
      const request: SQSSendMessageRequest = {
        messageBody,
        delaySeconds: delaySeconds || undefined,
      }

      if (isFifo) {
        if (messageGroupId) request.messageGroupId = messageGroupId
        if (messageDeduplicationId) request.messageDeduplicationId = messageDeduplicationId
      }

      const response = await sendSQSMessage(queue.name, request, activeEndpoint)
      toast.success(`Message sent: ${response.messageId}`)
      setMessageBody('')
      setDelaySeconds(0)
      setMessageGroupId('')
      setMessageDeduplicationId('')
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to send message: ${error}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send Message to {queue?.name}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="message-body">Message Body</Label>
            <Textarea
              id="message-body"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              className="font-mono text-xs h-64"
              placeholder='{"key": "value"} or plain text'
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="delay">Delay Seconds (0-900)</Label>
            <Input
              id="delay"
              type="number"
              min="0"
              max="900"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))}
            />
          </div>

          {isFifo && (
            <>
              <div className="space-y-2">
                <Label htmlFor="message-group-id">Message Group ID {isFifo && '*'}</Label>
                <Input
                  id="message-group-id"
                  value={messageGroupId}
                  onChange={(e) => setMessageGroupId(e.target.value)}
                  placeholder="Required for FIFO queues"
                />
              </div>

              {!queue?.contentBasedDeduplication && (
                <div className="space-y-2">
                  <Label htmlFor="dedup-id">Message Deduplication ID *</Label>
                  <Input
                    id="dedup-id"
                    value={messageDeduplicationId}
                    onChange={(e) => setMessageDeduplicationId(e.target.value)}
                    placeholder="Required unless content-based dedup enabled"
                  />
                </div>
              )}
            </>
          )}

          <Button onClick={handleSend} disabled={sending} className="w-full">
            <Send className="h-4 w-4 mr-2" />
            {sending ? 'Sending...' : 'Send Message'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EditSettingsSheet({
  queue,
  open,
  onOpenChange,
  onSuccess,
}: {
  queue: SQSQueueDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [visibilityTimeout, setVisibilityTimeout] = useState(30)
  const [messageRetentionPeriod, setMessageRetentionPeriod] = useState(345600)
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [maximumMessageSize, setMaximumMessageSize] = useState(262144)
  const [receiveMessageWaitTime, setReceiveMessageWaitTime] = useState(0)
  const { activeEndpoint } = useEndpoint()
  const [deleting, setDeleting] = useState(false)

  // DLQ settings
  const [dlqEnabled, setDlqEnabled] = useState(false)
  const [dlqTargetArn, setDlqTargetArn] = useState('')
  const [maxReceiveCount, setMaxReceiveCount] = useState(5)

  const [updating, setUpdating] = useState(false)

  // Load current values when queue changes or sheet opens
  useEffect(() => {
    if (queue && open) {
      setVisibilityTimeout(queue.visibilityTimeout)
      setMessageRetentionPeriod(queue.messageRetentionPeriod)
      setDelaySeconds(queue.delaySeconds)
      setMaximumMessageSize(queue.maximumMessageSize)
      setReceiveMessageWaitTime(0) // Not exposed in detail

      if (queue.redrivePolicy) {
        setDlqEnabled(true)
        setDlqTargetArn(queue.redrivePolicy.deadLetterTargetArn)
        setMaxReceiveCount(queue.redrivePolicy.maxReceiveCount)
      } else {
        setDlqEnabled(false)
        setDlqTargetArn('')
        setMaxReceiveCount(5)
      }
    }
  }, [queue, open])

  const handleSave = async () => {
    if (!queue) return

    try {
      setUpdating(true)

      // Update basic attributes
      const attrsRequest: SQSUpdateAttributesRequest = {
        visibilityTimeout,
        messageRetentionPeriod,
        delaySeconds,
        maximumMessageSize,
        receiveMessageWaitTime,
      }
      await updateSQSQueueAttributes(queue.name, attrsRequest)

      // Update DLQ if needed
      if (dlqEnabled) {
        await updateSQSRedrivePolicy(queue.name, {
          deadLetterTargetArn: dlqTargetArn,
          maxReceiveCount: maxReceiveCount,
        })
      } else {
        // Remove DLQ by passing null
        await updateSQSRedrivePolicy(queue.name, null)
      }

      toast.success('Queue settings updated successfully')
      onSuccess()
      setDeleting(true)
      await deleteSQSMessage(queueName, message.receiptHandle, activeEndpoint)
      toast.success('Message deleted')
      onDelete()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to update settings: ${error}`)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Edit Queue Settings
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-visibility-timeout">Visibility Timeout (seconds)</Label>
            <Input
              id="edit-visibility-timeout"
              type="number"
              min="0"
              max="43200"
              value={visibilityTimeout}
              onChange={(e) => setVisibilityTimeout(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">0-43200 seconds</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-message-retention">Message Retention Period (seconds)</Label>
            <Input
              id="edit-message-retention"
              type="number"
              min="60"
              max="1209600"
              value={messageRetentionPeriod}
              onChange={(e) => setMessageRetentionPeriod(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">60-1209600 seconds (4 days)</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-delay-seconds">Delivery Delay (seconds)</Label>
            <Input
              id="edit-delay-seconds"
              type="number"
              min="0"
              max="900"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">0-900 seconds</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-max-message-size">Maximum Message Size (bytes)</Label>
            <Input
              id="edit-max-message-size"
              type="number"
              min="1024"
              max="262144"
              value={maximumMessageSize}
              onChange={(e) => setMaximumMessageSize(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">1024-262144 bytes</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-receive-wait-time">Receive Message Wait Time (seconds)</Label>
            <Input
              id="edit-receive-wait-time"
              type="number"
              min="0"
              max="20"
              value={receiveMessageWaitTime}
              onChange={(e) => setReceiveMessageWaitTime(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">0-20 seconds for long polling</p>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="edit-dlq-enabled">Enable Dead-Letter Queue</Label>
                <p className="text-xs text-muted-foreground">
                  Redirect failed messages to another queue after max receive count
                </p>
              </div>
              <Switch id="edit-dlq-enabled" checked={dlqEnabled} onCheckedChange={setDlqEnabled} />
            </div>

            {dlqEnabled && (
              <div className="space-y-3 pl-4 border-l-2 border-muted">
                <div className="space-y-2">
                  <Label htmlFor="edit-dlq-arn">DLQ Target ARN</Label>
                  <Input
                    id="edit-dlq-arn"
                    value={dlqTargetArn}
                    onChange={(e) => setDlqTargetArn(e.target.value)}
                    placeholder="arn:aws:sqs:us-east-1:123456789:dlq-queue"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-max-receive-count">Max Receive Count</Label>
                  <Input
                    id="edit-max-receive-count"
                    type="number"
                    min="1"
                    max="1000"
                    value={maxReceiveCount}
                    onChange={(e) => setMaxReceiveCount(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">1-1000</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={updating} className="flex-1">
            <Edit className="h-4 w-4 mr-2" />
            {updating ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updating}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function BatchSendSheet({
  queue,
  open,
  onOpenChange,
  onSuccess,
}: {
  queue: SQSQueueDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [jsonInput, setJsonInput] = useState('')
  const [sending, setSending] = useState(false)

  const isFifo = queue?.type === 'FIFO'

  // Set default template when opening
  useEffect(() => {
    if (open) {
      const template = isFifo
        ? JSON.stringify(
            [
              { documentNumber: '123456789', filters: [{ name: 'John Doe', age: '30' }], messageGroupId: 'group1' },
              { documentNumber: '987654321', filters: [{ name: 'Jane Doe', age: '30' }], messageGroupId: 'group1' },
            ],
            null,
            2
          )
        : JSON.stringify(
            [
              { documentNumber: '123456789', filters: [{ name: 'John Doe', age: '30' }] },
              { documentNumber: '987654321', filters: [{ name: 'Jane Doe', age: '30' }] },
            ],
            null,
            2
          )
      setJsonInput(template)
    }
  }, [open, isFifo])

  const handleSend = async () => {
    if (!queue) {
      toast.error('No queue selected')
      return
    }

    if (!jsonInput.trim()) {
      toast.error('Please enter message data')
      return
    }

    let entries: unknown
    try {
      entries = JSON.parse(jsonInput)
    } catch {
      toast.error('Invalid JSON format')
      return
    }

    if (!Array.isArray(entries)) {
      toast.error('Root must be an array of message objects')
      return
    }

    if (entries.length === 0) {
      toast.error('At least one message is required')
      return
    }

    if (entries.length > 10) {
      toast.error('Maximum 10 messages per batch')
      return
    }

    // Transform and validate each entry
    const transformedEntries: Array<{ id: string; messageBody: string }> = []

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]

      if (typeof entry !== 'object' || entry === null) {
        toast.error(`Entry ${i + 1} must be an object`)
        return
      }

      // Always auto-generate id for SQS batch entry (msg-1, msg-2, etc.)
      const id = `msg-${i + 1}`

      // If messageBody exists, use it; otherwise stringify the entire entry as-is
      let messageBody: string
      if ('messageBody' in entry && typeof entry.messageBody === 'string') {
        messageBody = entry.messageBody
      } else {
        // Stringify entire object - user's id (if any) is preserved inside
        messageBody = JSON.stringify(entry)
      }

      transformedEntries.push({ id, messageBody })
    }

    try {
      setSending(true)
      const request: SQSBatchSendRequest = { entries: transformedEntries }
      const response = await sendSQSMessagesBatch(queue.name, request)

      if (response.failed.length > 0) {
        toast.error(
          `Sent ${response.successful.length}, Failed ${response.failed.length}: ${response.failed.map((f) => f.message).join(', ')}`
        )
      } else {
        toast.success(`Sent ${response.successful.length} message(s) successfully`)
      }

      if (response.successful.length > 0) {
        onSuccess()
        setJsonInput('')
        onOpenChange(false)
      }
    } catch (error) {
      toast.error(`Failed to send messages: ${error}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Batch Send Messages to {queue?.name}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="batch-json">Message Data (JSON Array)</Label>
            <p className="text-xs text-muted-foreground">
              Enter an array of message objects. Max 10 messages per batch.
              {isFifo && ' Each message must have a messageGroupId.'}
            </p>
            <Textarea
              id="batch-json"
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              className="font-mono text-xs h-64"
              placeholder={isFifo ? '[{"documentNumber":"X","messageGroupId":"group1"}]' : '[{"documentNumber":"X"}]'}
            />
          </div>

          <div className="rounded-md border p-3 bg-muted/50">
            <p className="text-sm font-medium mb-1">Flexible format:</p>
            <p className="text-xs text-muted-foreground mb-2">
              Paste your JSON array as-is. We'll auto-generate entry IDs and stringify your objects.
            </p>
            <p className="text-xs font-medium mb-1">Example:</p>
            <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
{`[
  {
    "key": "value",
    "filters": [
      { "key": "value", "key2": "value2" }
    ]
  },
  {
    "key": "value",
    "filters": [
      { "key": "value", "key2": "value2" }
    ]
  }
]`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Your entire object (including any <code>id</code> field) will be preserved in the message body.
            </p>
            {isFifo && (
              <p className="text-xs text-muted-foreground mt-1">
                For FIFO queues, add <code>messageGroupId</code> to each entry.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSend} disabled={sending} className="flex-1">
            <Send className="h-4 w-4 mr-2" />
            {sending ? 'Sending...' : 'Send Batch'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CreateFavoriteSheet({
  open,
  onOpenChange,
  onCreated,
  addFavorite,
  initialData,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  addFavorite: (data: {
    messageBody: string
    name: string
    delaySeconds?: number
    messageGroupId?: string
    messageDeduplicationId?: string
    messageAttributes?: Record<string, { stringValue: string; dataType: string }>
    sourceQueue?: string
    originalMessageId?: string
    isBatch?: boolean
  }) => void
  initialData?: {
    name: string
    messageBody: string
    sourceQueue?: string
    originalMessageId?: string
    messageAttributes?: Record<string, { stringValue: string; dataType: string }>
  }
}) {
  const [mode, setMode] = useState<'single' | 'batch'>('single')

  // Single message form state
  const [name, setName] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [messageGroupId, setMessageGroupId] = useState('')
  const [messageDeduplicationId, setMessageDeduplicationId] = useState('')

  // Batch form state
  const [batchName, setBatchName] = useState('')
  const [batchJson, setBatchJson] = useState('')

  const [creating, setCreating] = useState(false)

  // Reset form when opening
  useEffect(() => {
    if (open) {
      if (initialData) {
        // Pre-populate with initial data (saving message as favorite)
        setName(initialData.name)
        // Pretty-print JSON if the body is JSON
        let formattedBody = initialData.messageBody
        try {
          const parsed = JSON.parse(initialData.messageBody)
          if (typeof parsed === 'object' && parsed !== null) {
            formattedBody = JSON.stringify(parsed, null, 2)
          }
        } catch {
          // Not JSON, keep as is
        }
        setMessageBody(formattedBody)
        setDelaySeconds(0)
        setMessageGroupId('')
        setMessageDeduplicationId('')
        setBatchName('')
        setBatchJson('')
        setMode('single')
      } else {
        // Reset to empty state (creating new favorite)
        setName('')
        setMessageBody('')
        setDelaySeconds(0)
        setMessageGroupId('')
        setMessageDeduplicationId('')
        setBatchName('')
        setBatchJson('')
        setMode('single')
      }
    }
  }, [open, initialData])

  // Set default batch template when switching to batch mode
  useEffect(() => {
    if (mode === 'batch' && !batchJson) {
      setBatchJson(JSON.stringify([
        { documentNumber: '123456789', filters: [{ name: 'John Doe', age: '30' }] },
        { documentNumber: '987654321', filters: [{ name: 'Jane Doe', age: '30' }] },
      ], null, 2))
    }
  }, [mode, batchJson])

  const handleCreateSingle = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!messageBody.trim()) {
      toast.error('Message body is required')
      return
    }

    try {
      setCreating(true)
      addFavorite({
        name: name.trim(),
        messageBody,
        delaySeconds: delaySeconds || undefined,
        messageGroupId: messageGroupId || undefined,
        messageDeduplicationId: messageDeduplicationId || undefined,
        sourceQueue: initialData?.sourceQueue,
        originalMessageId: initialData?.originalMessageId,
        messageAttributes: initialData?.messageAttributes,
        isBatch: false,
      })
      toast.success(`Created favorite "${name.trim()}"`)
      setName('')
      setMessageBody('')
      setDelaySeconds(0)
      setMessageGroupId('')
      setMessageDeduplicationId('')
      onCreated()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to create favorite: ${error}`)
    } finally {
      setCreating(false)
    }
  }

  const handleCreateBatch = async () => {
    if (!batchName.trim()) {
      toast.error('Name is required')
      return
    }
    if (!batchJson.trim()) {
      toast.error('Messages JSON is required')
      return
    }

    let entries: unknown
    try {
      entries = JSON.parse(batchJson)
    } catch {
      toast.error('Invalid JSON format')
      return
    }

    if (!Array.isArray(entries)) {
      toast.error('Root must be an array of message objects')
      return
    }

    if (entries.length === 0) {
      toast.error('At least one message is required')
      return
    }

    if (entries.length > 10) {
      toast.error('Maximum 10 messages per batch')
      return
    }

    // Store the entire JSON array as the message body for batch favorites
    try {
      setCreating(true)
      addFavorite({
        name: batchName.trim(),
        messageBody: JSON.stringify(entries, null, 2),
        isBatch: true,
      })
      toast.success(`Created batch favorite "${batchName.trim()}"`)
      setBatchName('')
      setBatchJson('')
      onCreated()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to create favorite: ${error}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            Create Favorite Message
          </SheetTitle>
        </SheetHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'single' | 'batch')} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">Single Message</TabsTrigger>
            <TabsTrigger value="batch">Batch Messages</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="fav-name">Name *</Label>
              <Input
                id="fav-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My favorite message"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fav-message-body">Message Body *</Label>
              <Textarea
                id="fav-message-body"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                className="font-mono text-xs h-48"
                placeholder='{"key": "value"} or plain text'
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fav-delay">Delay Seconds (0-900)</Label>
              <Input
                id="fav-delay"
                type="number"
                min="0"
                max="900"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(Number(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fav-message-group-id">Message Group ID (FIFO queues)</Label>
              <Input
                id="fav-message-group-id"
                value={messageGroupId}
                onChange={(e) => setMessageGroupId(e.target.value)}
                placeholder="Optional: group ID for FIFO queues"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fav-dedup-id">Message Deduplication ID (FIFO queues)</Label>
              <Input
                id="fav-dedup-id"
                value={messageDeduplicationId}
                onChange={(e) => setMessageDeduplicationId(e.target.value)}
                placeholder="Optional: deduplication ID for FIFO queues"
              />
            </div>

            {initialData && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label>Details</Label>
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium text-xs">Source Queue</TableCell>
                        <TableCell className="text-xs font-mono">{initialData.sourceQueue || '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium text-xs">Message ID</TableCell>
                        <TableCell className="text-xs font-mono">{initialData.originalMessageId?.slice(0, 32)}...</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            <div className="flex gap-2">
              <Button onClick={handleCreateSingle} disabled={creating} className="flex-1">
                <Star className="h-4 w-4 mr-2" />
                {creating ? 'Creating...' : 'Create Favorite'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
                Cancel
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="batch" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="batch-fav-name">Name *</Label>
              <Input
                id="batch-fav-name"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder="My batch template"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch-json">Messages JSON (Array) *</Label>
              <p className="text-xs text-muted-foreground">
                Enter an array of message objects. Max 10 messages per batch.
              </p>
              <Textarea
                id="batch-json"
                value={batchJson}
                onChange={(e) => setBatchJson(e.target.value)}
                className="font-mono text-xs h-64"
                placeholder='[{"documentNumber": "123456789"}, {"documentNumber": "987654321"}]'
              />
            </div>

            <div className="rounded-md border p-3 bg-muted/50">
              <p className="text-sm font-medium mb-1">Flexible format:</p>
              <p className="text-xs text-muted-foreground mb-2">
                Paste your JSON array as-is. We'll auto-generate entry IDs and stringify your objects.
              </p>
              <p className="text-xs font-medium mb-1">Example:</p>
              <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
{`[
  {
    "key": "value",
    "filters": [
      { "key": "value", "key2": "value2" }
    ]
  },
  {
    "key": "value",
    "filters": [
      { "key": "value", "key2": "value2" }
    ]
  }
]`}
              </pre>
              <p className="text-xs text-muted-foreground mt-2">
                Your entire object (including any <code>id</code> field) will be preserved in the message body.
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCreateBatch} disabled={creating} className="flex-1">
                <Star className="h-4 w-4 mr-2" />
                {creating ? 'Creating...' : 'Create Batch Favorite'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
                Cancel
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

function FavoriteViewerSheet({
  favorite,
  open,
  onOpenChange,
  onRequestDelete,
  onUpdate,
}: {
  favorite: SQSFavoriteMessage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRequestDelete: (id: string) => void
  onUpdate: (id: string, data: { name: string; messageBody: string }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset form when favorite changes or sheet opens
  useEffect(() => {
    if (favorite && open) {
      setName(favorite.name)
      setMessageBody(favorite.messageBody)
      setEditing(false)
    }
  }, [favorite, open])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  const handleSave = async () => {
    if (!favorite) return

    try {
      setSaving(true)
      onUpdate(favorite.id, { name: name.trim(), messageBody })
      toast.success('Favorite updated successfully')
      setEditing(false)
    } catch (error) {
      toast.error(`Failed to update: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (!favorite) return null

  let parsedBody: unknown = messageBody
  try {
    parsedBody = JSON.parse(messageBody)
  } catch {
    // Not JSON, keep as string
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            {editing ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 max-w-md"
                autoFocus
              />
            ) : (
              favorite.name
            )}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {favorite.isBatch && (
                <Badge variant="secondary">Batch</Badge>
              )}
              {favorite.sourceQueue && (
                <Badge variant="outline">From: {favorite.sourceQueue}</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => { setEditing(false); setName(favorite.name); setMessageBody(favorite.messageBody) }}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleCopy(favorite.messageBody)}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onRequestDelete(favorite.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Message Body</Label>
            {editing ? (
              <Textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                className="font-mono text-xs h-64"
              />
            ) : (
              <div className="rounded-md border p-3 bg-muted/50 max-h-96 overflow-auto">
                {typeof parsedBody === 'object' ? (
                  <JsonViewer data={parsedBody} />
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap">{messageBody}</pre>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Details</Label>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-xs">Created</TableCell>
                  <TableCell className="text-xs">{new Date(favorite.createdAt).toLocaleString()}</TableCell>
                </TableRow>
                {favorite.sourceQueue && (
                  <TableRow>
                    <TableCell className="font-medium text-xs">Source Queue</TableCell>
                    <TableCell className="text-xs font-mono">{favorite.sourceQueue}</TableCell>
                  </TableRow>
                )}
                {favorite.originalMessageId && (
                  <TableRow>
                    <TableCell className="font-medium text-xs">Original Message ID</TableCell>
                    <TableCell className="text-xs font-mono">{favorite.originalMessageId.slice(0, 32)}...</TableCell>
                  </TableRow>
                )}
                {favorite.delaySeconds !== undefined && favorite.delaySeconds > 0 && (
                  <TableRow>
                    <TableCell className="font-medium text-xs">Delay Seconds</TableCell>
                    <TableCell className="text-xs">{favorite.delaySeconds}</TableCell>
                  </TableRow>
                )}
                {favorite.messageGroupId && (
                  <TableRow>
                    <TableCell className="font-medium text-xs">Message Group ID</TableCell>
                    <TableCell className="text-xs font-mono">{favorite.messageGroupId}</TableCell>
                  </TableRow>
                )}
                {favorite.messageDeduplicationId && (
                  <TableRow>
                    <TableCell className="font-medium text-xs">Deduplication ID</TableCell>
                    <TableCell className="text-xs font-mono">{favorite.messageDeduplicationId}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MessageViewerSheet({
  message,
  queueName,
  open,
  onOpenChange,
  onDelete,
}: {
  message: SQSMessage | null
  queueName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!message) return

    if (!confirm('Delete this message? This action cannot be undone.')) {
      return
    }

    try {
      setDeleting(true)
      await deleteSQSMessage(queueName, message.receiptHandle)
      toast.success('Message deleted')
      onDelete()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to delete message: ${error}`)
    } finally {
      setDeleting(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  if (!message) return null

  let parsedBody: unknown = message.body
  try {
    parsedBody = JSON.parse(message.body)
  } catch {
    // Not JSON, keep as string
  }

  const sentTimestamp = message.attributes.SentTimestamp
    ? new Date(Number(message.attributes.SentTimestamp)).toLocaleString()
    : '—'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" />
            Message Detail
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <Badge variant="outline">ID: {message.messageId.slice(0, 16)}...</Badge>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleCopy(message.body)}>
                <Copy className="h-4 w-4 mr-1" />
                Copy Body
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                <Trash2 className="h-4 w-4 mr-1" />
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Message Body</Label>
            <div className="rounded-md border p-3 bg-muted/50 max-h-96 overflow-auto">
              {typeof parsedBody === 'object' ? (
                <JsonViewer data={parsedBody} />
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap">{message.body}</pre>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>System Attributes</Label>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-xs">Sent Timestamp</TableCell>
                  <TableCell className="text-xs">{sentTimestamp}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-xs">Receive Count</TableCell>
                  <TableCell className="text-xs">
                    {message.attributes.ApproximateReceiveCount || '0'}
                  </TableCell>
                </TableRow>
                {message.attributes.MessageGroupId && (
                  <TableRow>
                    <TableCell className="font-medium text-xs">Message Group ID</TableCell>
                    <TableCell className="text-xs font-mono">{message.attributes.MessageGroupId}</TableCell>
                  </TableRow>
                )}
                {message.attributes.MessageDeduplicationId && (
                  <TableRow>
                    <TableCell className="font-medium text-xs">Deduplication ID</TableCell>
                    <TableCell className="text-xs font-mono">
                      {message.attributes.MessageDeduplicationId}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {Object.keys(message.messageAttributes).length > 0 && (
            <div className="space-y-2">
              <Label>Message Attributes</Label>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Key</TableHead>
                    <TableHead className="text-xs">Value</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(message.messageAttributes).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-xs">{key}</TableCell>
                      <TableCell className="font-mono text-xs">{value.StringValue || '(binary)'}</TableCell>
                      <TableCell className="text-xs">{value.DataType}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <details className="rounded-md border p-3">
            <summary className="text-xs font-medium cursor-pointer">Receipt Handle (for debugging)</summary>
            <pre className="text-xs font-mono mt-2 break-all whitespace-pre-wrap">{message.receiptHandle}</pre>
          </details>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PurgeConfirmSheet({
  queueName,
  open,
  onOpenChange,
  onConfirm,
}: {
  queueName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [purging, setPurging] = useState(false)

  const handlePurge = async () => {
    if (confirmText !== queueName) {
      toast.error('Queue name did not match.')
      return
    }
    setPurging(true)
    try {
      await onConfirm()
      setConfirmText('')
      onOpenChange(false)
    } finally {
      setPurging(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Purge Queue
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will delete ALL messages from the queue <code className="font-mono">{queueName}</code>.
            This action cannot be undone and takes up to 60 seconds to complete.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-purge">Type the queue name to confirm</Label>
            <Input
              id="confirm-purge"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={queueName}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handlePurge} disabled={purging || confirmText !== queueName} className="flex-1">
            {purging ? 'Purging...' : 'Purge Queue'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={purging}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DeleteFavoriteConfirmSheet({
  favorite,
  open,
  onOpenChange,
  onConfirm,
}: {
  favorite: SQSFavoriteMessage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (confirmText !== favorite?.name) {
      toast.error('Name did not match.')
      return
    }
    setDeleting(true)
    try {
      await onConfirm()
      setConfirmText('')
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Favorite
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete the favorite <code className="font-mono">{favorite?.name}</code>.
            This action cannot be undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete-fav">Type the favorite name to confirm</Label>
            <Input
              id="confirm-delete-fav"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={favorite?.name}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== favorite?.name} className="flex-1">
            {deleting ? 'Deleting...' : 'Delete Favorite'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DeleteConfirmSheet({
  queueName,
  open,
  onOpenChange,
  onConfirm,
}: {
  queueName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (confirmText !== queueName) {
      toast.error('Queue name did not match.')
      return
    }
    setDeleting(true)
    try {
      await onConfirm()
      setConfirmText('')
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Queue
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete the queue <code className="font-mono">{queueName}</code> and all its messages.
            This action cannot be undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete">Type the queue name to confirm</Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={queueName}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== queueName} className="flex-1">
            {deleting ? 'Deleting...' : 'Delete Queue'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function SQSBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const queuesFetcher = useCallback(() => fetchSQSQueues(activeEndpoint), [activeEndpoint])
  const { data: queuesData, loading: queuesLoading, refresh: refreshQueues } = useFetch<{ queues: SQSQueue[] }>(queuesFetcher, 10000)
  const [refreshing, setRefreshing] = useState(false)

  // Read selected queue from URL params
  const selectedQueue = searchParams.get('queue')

  // Helper to update URL params
  const setSelectedQueue = (queue: string | null) => {
    if (queue === null) {
      setSearchParams({})
    } else {
      setSearchParams({ queue })
    }
  }

  const [queueDetail, setQueueDetail] = useState<SQSQueueDetail | null>(null)
  const [messages, setMessages] = useState<SQSMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [sendSheetOpen, setSendSheetOpen] = useState(false)
  const [selectedMessage, setSelectedMessage] = useState<SQSMessage | null>(null)
  const [messageViewerOpen, setMessageViewerOpen] = useState(false)
  const [selectedFavorite, setSelectedFavorite] = useState<SQSFavoriteMessage | null>(null)
  const [favoriteViewerOpen, setFavoriteViewerOpen] = useState(false)
  const [deleteFavoriteConfirmOpen, setDeleteFavoriteConfirmOpen] = useState(false)
  const [favoriteToDelete, setFavoriteToDelete] = useState<SQSFavoriteMessage | null>(null)
  const [createSheetOpen, setCreateSheetOpen] = useState(false)

  // New state for batch operations and settings
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set())
  const [batchSendSheetOpen, setBatchSendSheetOpen] = useState(false)
  const [editSettingsSheetOpen, setEditSettingsSheetOpen] = useState(false)

  // Confirmation sheets state
  const [purgeConfirmSheetOpen, setPurgeConfirmSheetOpen] = useState(false)
  const [deleteConfirmSheetOpen, setDeleteConfirmSheetOpen] = useState(false)

  // Favorites state
  const { favoriteMessages, addFavorite, addFavorites, removeFavorite, updateFavorite } = useSQSFavoriteMessages()
  const [activeTab, setActiveTab] = useState('messages')
  const [createFavoriteSheetOpen, setCreateFavoriteSheetOpen] = useState(false)
  const [saveFavoriteInitialData, setSaveFavoriteInitialData] = useState<{
    name: string
    messageBody: string
    sourceQueue?: string
    originalMessageId?: string
    messageAttributes?: Record<string, { stringValue: string; dataType: string }>
  } | undefined>(undefined)

  // Favorites state using localStorage
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('sqs-favorites')
    return saved ? new Set(JSON.parse(saved)) : new Set()
  })

  // Toggle favorite status
  const toggleFavorite = (queueName: string) => {
    const newFavorites = new Set(favorites)
    if (newFavorites.has(queueName)) {
      newFavorites.delete(queueName)
      toast.info(`Removed "${queueName}" from favorites`)
    } else {
      newFavorites.add(queueName)
      toast.success(`Added "${queueName}" to favorites`)
    }
    setFavorites(newFavorites)
    localStorage.setItem('sqs-favorites', JSON.stringify([...newFavorites]))
  }

  // Check if a queue is favorited
  const isFavorite = (queueName: string) => favorites.has(queueName)

  useEffect(() => {
    if (!selectedQueue) {
      setQueueDetail(null)
      setMessages([])
      return
    }
    fetchSQSQueueDetail(selectedQueue, activeEndpoint)
      .then(setQueueDetail)
      .catch(() => setQueueDetail(null))
  }, [selectedQueue, activeEndpoint])

  const handleReceiveMessages = async () => {
    if (!selectedQueue) return

    setLoadingMessages(true)
    try {
      const response = await receiveSQSMessages(selectedQueue, 10, 0, activeEndpoint)
      setMessages(response.messages)
      if (response.messages.length === 0) {
        toast.info('No messages available. Queue may be empty or try again.')
      } else {
        toast.success(`Received ${response.messages.length} message(s)`)
      }
    } catch (error) {
      toast.error(`Failed to receive messages: ${error}`)
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }

  const handlePurge = () => {
    if (!selectedQueue) return
    setPurgeConfirmSheetOpen(true)
  }

  const confirmPurge = async () => {
    if (!selectedQueue) return

    try {
      await purgeSQSQueue(selectedQueue, activeEndpoint)
      toast.success('Queue purge initiated (may take up to 60 seconds)')
      setMessages([])
      // Refresh queue detail to see updated counts
      fetchSQSQueueDetail(selectedQueue, activeEndpoint).then(setQueueDetail)
    } catch (error) {
      toast.error(`Failed to purge queue: ${error}`)
      throw error
    }
  }

  const handleDeleteQueue = () => {
    if (!selectedQueue || !queueDetail) return
    setDeleteConfirmSheetOpen(true)
  }

  const confirmDelete = async () => {
    if (!selectedQueue) return

    try {
      await deleteSQSQueue(selectedQueue)
      toast.success(`Queue "${selectedQueue}" deleted successfully`)
      setSelectedQueue(null)
      // Refresh the queue list
      refreshQueues()
    } catch (error) {
      toast.error(`Failed to delete queue: ${error}`)
      throw error
    }
  }

  const handleDeleteSelected = async () => {
    if (!selectedQueue || selectedMessages.size === 0) return

    const confirmText = prompt(
      `Type "DELETE" to confirm deletion of ${selectedMessages.size} message(s). This action cannot be undone.`
    )

    if (confirmText !== 'DELETE') {
      toast.error('Deletion cancelled.')
      return
    }

    try {
      const receiptHandles = messages
        .filter((msg) => selectedMessages.has(msg.messageId))
        .map((msg) => msg.receiptHandle)

      await deleteSQSMessagesBatch(selectedQueue, { receiptHandles })
      toast.success(`Deleted ${selectedMessages.size} message(s)`)
      setSelectedMessages(new Set())
      // Remove deleted messages from the list
      setMessages(messages.filter((msg) => !selectedMessages.has(msg.messageId)))
      // Refresh queue detail
      fetchSQSQueueDetail(selectedQueue).then(setQueueDetail)
    } catch (error) {
      toast.error(`Failed to delete messages: ${error}`)
    }
  }

  const toggleMessageSelection = (messageId: string) => {
    const newSelected = new Set(selectedMessages)
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId)
    } else {
      newSelected.add(messageId)
    }
    setSelectedMessages(newSelected)
  }

  const toggleSelectAll = () => {
    if (selectedMessages.size === messages.length) {
      setSelectedMessages(new Set())
    } else {
      setSelectedMessages(new Set(messages.map((msg) => msg.messageId)))
    }
  }

  // Add single message to favorites - opens the CreateFavoriteSheet with initial data
  const handleAddFavorite = (message: SQSMessage) => {
    setSaveFavoriteInitialData({
      name: `Message from ${selectedQueue || 'queue'}`,
      messageBody: message.body,
      sourceQueue: selectedQueue ?? undefined,
      originalMessageId: message.messageId,
      messageAttributes: Object.fromEntries(
        Object.entries(message.messageAttributes).map(([key, value]) => [
          key,
          { stringValue: value.StringValue || '', dataType: value.DataType }
        ])
      ),
    })
    setCreateFavoriteSheetOpen(true)
  }

  // Add selected messages to favorites
  const handleAddSelectedToFavorites = () => {
    const messagesToSave = messages.filter((m) => selectedMessages.has(m.messageId))
    if (messagesToSave.length === 0) return

    const count = messagesToSave.length
    addFavorites(
      messagesToSave.map((m) => ({
        messageBody: m.body,
        name: `Message from ${selectedQueue}`,
        sourceQueue: selectedQueue ?? undefined,
        originalMessageId: m.messageId,
        messageAttributes: Object.fromEntries(
          Object.entries(m.messageAttributes).map(([key, value]) => [
            key,
            { stringValue: value.StringValue || '', dataType: value.DataType }
          ])
        ),
      }))
    )
    setSelectedMessages(new Set())
    toast.success(`Saved ${count} message(s) to favorites`)
  }

  // Resend favorite message to current queue
  const handleResendFavorite = async (favorite: SQSFavoriteMessage) => {
    if (!selectedQueue) {
      toast.error('Please select a queue first')
      return
    }

    try {
      // Handle batch favorites
      if (favorite.isBatch) {
        let entries: unknown
        try {
          entries = JSON.parse(favorite.messageBody)
        } catch {
          toast.error('Invalid batch format')
          return
        }

        if (!Array.isArray(entries)) {
          toast.error('Batch favorite has invalid format')
          return
        }

        // Transform entries to the format expected by sendSQSMessagesBatch
        const transformedEntries = entries.map((entry, i) => ({
          id: `msg-${i + 1}`,
          messageBody: typeof entry === 'object' && entry !== null && 'messageBody' in entry
            ? String(entry.messageBody)
            : JSON.stringify(entry),
        }))

        const response = await sendSQSMessagesBatch(selectedQueue, { entries: transformedEntries })
        if (response.failed.length > 0) {
          toast.error(`Sent ${response.successful.length}, Failed ${response.failed.length}`)
        } else {
          toast.success(`Sent batch "${favorite.name}" (${response.successful.length} messages) to ${selectedQueue}`)
        }
      } else {
        // Handle single message favorites
        const request: SQSSendMessageRequest = {
          messageBody: favorite.messageBody,
          delaySeconds: favorite.delaySeconds,
          messageGroupId: favorite.messageGroupId,
          messageDeduplicationId: favorite.messageDeduplicationId,
        }
        await sendSQSMessage(selectedQueue, request)
        toast.success(`Sent "${favorite.name}" to ${selectedQueue}`)
      }
      fetchSQSQueueDetail(selectedQueue).then(setQueueDetail)
    } catch (error) {
      toast.error(`Failed to send: ${error}`)
    }
  }

  // Delete favorite message
  const handleDeleteFavorite = (id: string) => {
    const favorite = favoriteMessages.find((f) => f.id === id)
    if (favorite) {
      setFavoriteToDelete(favorite)
      setDeleteFavoriteConfirmOpen(true)
    }
  }

  const confirmDeleteFavorite = () => {
    if (favoriteToDelete) {
      removeFavorite(favoriteToDelete.id)
      toast.success(`Deleted "${favoriteToDelete.name}" from favorites`)
      setFavoriteToDelete(null)
      setFavoriteViewerOpen(false)
    }
  }

  const queues = queuesData?.queues ?? []
  const filteredQueues = queues.filter((q) => q.name.toLowerCase().includes(search.toLowerCase()))

  // Separate favorites and non-favorites
  const favoriteQueues = filteredQueues.filter((q) => favorites.has(q.name))
  const nonFavoriteQueues = filteredQueues.filter((q) => !favorites.has(q.name))

  // Apply pagination only to non-favorites
  const totalPages = Math.ceil(nonFavoriteQueues.length / pageSize)
  const paginatedQueues = nonFavoriteQueues.slice(page * pageSize, (page + 1) * pageSize)

  if (queuesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    )
  }

  if (!queuesData || queues.length === 0) {
    return (
      <div className="space-y-4">
        <Breadcrumb segments={[createHomeSegment(), { label: 'SQS', icon: getServiceIcon('sqs') }]} />
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search queues..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              className="pl-9"
              disabled={true}
            />
          </div>
          <Button onClick={() => setCreateSheetOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Queue
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={async () => { setRefreshing(true); await refreshQueues(); setRefreshing(false) }}
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <EmptyState
          icon={Inbox}
          title="No SQS Queues"
          description="No SQS queues found in this environment."
        />
        <CreateQueueSheet
          open={createSheetOpen}
          onOpenChange={setCreateSheetOpen}
          onSuccess={async () => {
            await refreshQueues()
          }}
        />
      </div>
    )
  }

  if (selectedQueue && queueDetail) {
    const totalMessages =
      queueDetail.approximateNumberOfMessages +
      queueDetail.approximateNumberOfMessagesNotVisible +
      queueDetail.approximateNumberOfMessagesDelayed

    return (
      <div className="space-y-4">
        <Breadcrumb segments={[
          createHomeSegment(),
          { label: 'SQS', href: '/resources/sqs', icon: getServiceIcon('sqs') },
          { label: queueDetail.name },
        ]} />

        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <Inbox className="h-6 w-6" />
              {queueDetail.name}
              <button
                onClick={() => toggleFavorite(queueDetail.name)}
                className="p-1 rounded-md hover:bg-accent transition-colors"
                title={isFavorite(queueDetail.name) ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={`h-5 w-5 ${isFavorite(queueDetail.name) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
              </button>
            </h2>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setSendSheetOpen(true)}>
              <Send className="h-4 w-4 mr-2" />
              Send Message
            </Button>
            <Button onClick={() => setBatchSendSheetOpen(true)} variant="secondary">
              <Send className="h-4 w-4 mr-2" />
              Batch Send
            </Button>
            <Button onClick={() => setEditSettingsSheetOpen(true)} variant="outline">
              <Edit className="h-4 w-4 mr-2" />
              Edit Settings
            </Button>
            <Button variant="destructive" onClick={handlePurge}>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Purge Queue
            </Button>
            <Button variant="destructive" onClick={handleDeleteQueue}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Queue
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <QueueTypeBadge type={queueDetail.type} />
          <QueueDepthBadge count={totalMessages} />
        </div>

        <Tabs defaultValue="messages" className="w-full" value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="favorites">
              <Star className="h-4 w-4 mr-1" />
              Favorites ({favoriteMessages.length})
            </TabsTrigger>
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span>Messages</span>
                  <div className="flex gap-2">
                    {selectedMessages.size > 0 && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAddSelectedToFavorites}
                        >
                          <Star className="h-4 w-4 mr-2" />
                          Save Selected ({selectedMessages.size})
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleDeleteSelected}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Selected ({selectedMessages.size})
                        </Button>
                      </>
                    )}
                    <Button onClick={handleReceiveMessages} disabled={loadingMessages} size="sm">
                      <Eye className="h-4 w-4 mr-2" />
                      {loadingMessages ? 'Loading...' : 'Peek Messages'}
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription className="text-xs">
                  Receive up to 10 messages without consuming them (visibility timeout = 0)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {messages.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title="No Messages"
                    description="Click 'Peek Messages' to receive messages from the queue."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <button
                            onClick={toggleSelectAll}
                            className="flex items-center justify-center w-full"
                            aria-label={selectedMessages.size === messages.length ? 'Deselect all' : 'Select all'}
                          >
                            {selectedMessages.size === messages.length ? (
                              <CheckSquare className="h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </TableHead>
                        <TableHead>Message ID</TableHead>
                        <TableHead>Body Preview</TableHead>
                        <TableHead>Receive Count</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {messages.map((msg) => (
                        <TableRow key={msg.messageId}>
                          <TableCell>
                            <button
                              onClick={() => toggleMessageSelection(msg.messageId)}
                              aria-label={selectedMessages.has(msg.messageId) ? 'Deselect' : 'Select'}
                            >
                              {selectedMessages.has(msg.messageId) ? (
                                <CheckSquare className="h-4 w-4" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{msg.messageId.slice(0, 16)}...</TableCell>
                          <TableCell className="text-xs max-w-xs truncate">{msg.body.slice(0, 100)}</TableCell>
                          <TableCell className="text-xs">{msg.attributes.ApproximateReceiveCount || 0}</TableCell>
                          <TableCell className="text-xs">
                            {msg.attributes.SentTimestamp
                              ? new Date(Number(msg.attributes.SentTimestamp)).toLocaleString()
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleAddFavorite(msg)}
                                title="Save as favorite"
                              >
                                <Star className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedMessage(msg)
                                  setMessageViewerOpen(true)
                                }}
                              >
                                View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="favorites" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                    Favorite Messages ({favoriteMessages.length})
                  </span>
                  <Button size="sm" onClick={() => setCreateFavoriteSheetOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Favorite
                  </Button>
                </CardTitle>
                <CardDescription>
                  Save frequently used message templates for quick reuse
                </CardDescription>
              </CardHeader>
              <CardContent>
                {favoriteMessages.length === 0 ? (
                  <EmptyState
                    icon={Star}
                    title="No Favorites"
                    description="Save messages as favorites to quickly reuse them later."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Message Body Preview</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {favoriteMessages.map((fav) => (
                        <TableRow key={fav.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {fav.name}
                              {fav.isBatch && (
                                <Badge variant="secondary" className="text-xs">Batch</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-xs truncate">
                            {fav.messageBody.slice(0, 100)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fav.sourceQueue || '—'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {new Date(fav.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedFavorite(fav)
                                  setFavoriteViewerOpen(true)
                                }}
                              >
                                View
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleResendFavorite(fav)}
                                title={`Send to ${selectedQueue || 'queue'}`}
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(fav.messageBody)
                                  toast.success('Copied message body to clipboard')
                                }}
                                title="Copy body"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteFavorite(fav.id)}
                                title="Delete favorite"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="config" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Queue Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="text-muted-foreground">ARN</div>
                  <div className="font-mono text-xs break-all">{queueDetail.arn}</div>
                  <div className="text-muted-foreground">URL</div>
                  <div className="font-mono text-xs break-all">{queueDetail.url}</div>
                  <div className="text-muted-foreground">Type</div>
                  <div>{queueDetail.type}</div>
                  <div className="text-muted-foreground">Visibility Timeout</div>
                  <div>{formatDuration(queueDetail.visibilityTimeout)}</div>
                  <div className="text-muted-foreground">Message Retention</div>
                  <div>{formatDuration(queueDetail.messageRetentionPeriod)}</div>
                  <div className="text-muted-foreground">Max Message Size</div>
                  <div>{(queueDetail.maximumMessageSize / 1024).toFixed(0)} KB</div>
                  <div className="text-muted-foreground">Delay</div>
                  <div>{queueDetail.delaySeconds}s</div>
                  <div className="text-muted-foreground">Messages (approx.)</div>
                  <div>
                    {queueDetail.approximateNumberOfMessages} visible, {queueDetail.approximateNumberOfMessagesNotVisible} in-flight,{' '}
                    {queueDetail.approximateNumberOfMessagesDelayed} delayed
                  </div>
                </div>
              </CardContent>
            </Card>

            {queueDetail.redrivePolicy && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Dead-Letter Queue Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-muted-foreground">DLQ ARN</div>
                    <div className="font-mono text-xs break-all">
                      {queueDetail.redrivePolicy.deadLetterTargetArn}
                    </div>
                    <div className="text-muted-foreground">Max Receive Count</div>
                    <div>{queueDetail.redrivePolicy.maxReceiveCount}</div>
                  </div>
                </CardContent>
              </Card>
            )}

            {queueDetail.type === 'FIFO' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">FIFO Settings</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-muted-foreground">Content-Based Deduplication</div>
                    <div>{queueDetail.contentBasedDeduplication ? 'Enabled' : 'Disabled'}</div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="tags" className="space-y-4">
            <TagsSection
              tags={queueDetail.tags}
              onSave={async (newTags) => {
                await updateResourceTags('sqs', 'queues', queueDetail.name, newTags, activeEndpoint)
              }}
            />
          </TabsContent>
        </Tabs>

        <SendMessageSheet
          queue={queueDetail}
          open={sendSheetOpen}
          onOpenChange={setSendSheetOpen}
          onSuccess={() => {
            // Refresh queue detail
            fetchSQSQueueDetail(selectedQueue, activeEndpoint).then(setQueueDetail)
          }}
        />

        <BatchSendSheet
          queue={queueDetail}
          open={batchSendSheetOpen}
          onOpenChange={setBatchSendSheetOpen}
          onSuccess={() => {
            // Refresh queue detail
            fetchSQSQueueDetail(selectedQueue).then(setQueueDetail)
          }}
        />

        <EditSettingsSheet
          queue={queueDetail}
          open={editSettingsSheetOpen}
          onOpenChange={setEditSettingsSheetOpen}
          onSuccess={() => {
            // Refresh queue detail
            fetchSQSQueueDetail(selectedQueue).then(setQueueDetail)
          }}
        />

        <MessageViewerSheet
          message={selectedMessage}
          queueName={selectedQueue}
          open={messageViewerOpen}
          onOpenChange={setMessageViewerOpen}
          onDelete={() => {
            // Remove deleted message from list and refresh queue detail
            setMessages(messages.filter((m) => m.messageId !== selectedMessage?.messageId))
            fetchSQSQueueDetail(selectedQueue, activeEndpoint).then(setQueueDetail)
          }}
        />

        <FavoriteViewerSheet
          favorite={selectedFavorite}
          open={favoriteViewerOpen}
          onOpenChange={setFavoriteViewerOpen}
          onRequestDelete={(id) => {
            handleDeleteFavorite(id)
          }}
          onUpdate={(id, data) => {
            updateFavorite(id, data)
          }}
        />

        <PurgeConfirmSheet
          queueName={selectedQueue}
          open={purgeConfirmSheetOpen}
          onOpenChange={setPurgeConfirmSheetOpen}
          onConfirm={confirmPurge}
        />

        <DeleteConfirmSheet
          queueName={selectedQueue}
          open={deleteConfirmSheetOpen}
          onOpenChange={setDeleteConfirmSheetOpen}
          onConfirm={confirmDelete}
        />

        <DeleteFavoriteConfirmSheet
          favorite={favoriteToDelete}
          open={deleteFavoriteConfirmOpen}
          onOpenChange={setDeleteFavoriteConfirmOpen}
          onConfirm={confirmDeleteFavorite}
        />

        <CreateFavoriteSheet
          open={createFavoriteSheetOpen}
          onOpenChange={(open) => {
            setCreateFavoriteSheetOpen(open)
            if (!open) setSaveFavoriteInitialData(undefined)
          }}
          onCreated={() => {
            // Favorites list updates automatically via hook
          }}
          addFavorite={addFavorite}
          initialData={saveFavoriteInitialData}
        />

      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Breadcrumb segments={[createHomeSegment(), { label: 'SQS', icon: getServiceIcon('sqs') }]} />
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search queues..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>
        {filteredQueues.length > 0 && <ExportDropdown service="sqs" resourceType="queues" data={filteredQueues as unknown as Record<string, unknown>[]} />}
        <Button onClick={() => setCreateSheetOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Queue
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={async () => { setRefreshing(true); await refreshQueues(); setRefreshing(false) }}
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Favorites Section */}
      {favorites.size > 0 && (
        <div className="space-y-3 mt-6">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Favorites</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {favoriteQueues.map((queue) => {
                const totalMessages =
                  queue.approximateNumberOfMessages +
                  queue.approximateNumberOfMessagesNotVisible +
                  queue.approximateNumberOfMessagesDelayed

                return (
                  <Card
                    key={queue.name}
                    className="cursor-pointer hover:bg-accent/50 transition-colors relative group"
                    onClick={() => setSelectedQueue(queue.name)}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(queue.name)
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                      title={isFavorite(queue.name) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Star className={`h-4 w-4 ${isFavorite(queue.name) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                    </button>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Inbox className="h-4 w-4" />
                        {queue.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2">
                        <QueueTypeBadge type={queue.type} />
                        <QueueDepthBadge count={totalMessages} />
                        {queue.redrivePolicy && (
                          <Badge variant="outline" className="text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            DLQ
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Messages</span>
                          <span>~{formatNumber(queue.approximateNumberOfMessages)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Retention</span>
                          <span>{formatDuration(queue.messageRetentionPeriod)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
          </div>
        </div>
      )}

      {/* All Queues Section */}
      {nonFavoriteQueues.length > 0 && (
        <div className={favorites.size > 0 ? "space-y-3 mt-6" : ""}>
          {favorites.size > 0 && (
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">All Queues</h3>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {paginatedQueues
            .filter((queue) => !favorites.has(queue.name))
            .map((queue) => {
          const totalMessages =
            queue.approximateNumberOfMessages +
            queue.approximateNumberOfMessagesNotVisible +
            queue.approximateNumberOfMessagesDelayed

          return (
            <Card
              key={queue.name}
              className="cursor-pointer hover:bg-accent/50 transition-colors relative group"
              onClick={() => setSelectedQueue(queue.name)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFavorite(queue.name)
                }}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                title={isFavorite(queue.name) ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={`h-4 w-4 ${isFavorite(queue.name) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
              </button>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Inbox className="h-4 w-4" />
                  {queue.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <QueueTypeBadge type={queue.type} />
                  <QueueDepthBadge count={totalMessages} />
                  <TagCountBadge count={Object.keys(queue.tags || {}).length} />
                  {queue.redrivePolicy && (
                    <Badge variant="outline" className="text-xs">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      DLQ
                    </Badge>
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Messages</span>
                    <span>~{formatNumber(queue.approximateNumberOfMessages)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">In-Flight</span>
                    <span>~{formatNumber(queue.approximateNumberOfMessagesNotVisible)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Delayed</span>
                    <span>~{formatNumber(queue.approximateNumberOfMessagesDelayed)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Retention</span>
                    <span>{formatDuration(queue.messageRetentionPeriod)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
        </div>

        {totalPages > 1 && (
          <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={filteredQueues.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(0)
          }}
        />
      )}
      </div>
      )}

      <CreateQueueSheet
        open={createSheetOpen}
        onOpenChange={setCreateSheetOpen}
        onSuccess={async () => {
          await refreshQueues()
        }}
      />
    </div>
  )
}
