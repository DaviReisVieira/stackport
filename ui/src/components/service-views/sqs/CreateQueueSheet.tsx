import { useState } from 'react'
import { createSQSQueue } from '@/lib/api'
import type { SQSCreateQueueRequest } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
  Plus,
  Settings,
  Tag as TagIcon,
} from 'lucide-react'

export function CreateQueueSheet({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { activeEndpoint } = useEndpoint()
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

      const response = await createSQSQueue(request, activeEndpoint)
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
