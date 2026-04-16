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
} from '@/lib/api'
import type { SQSQueue, SQSQueueDetail, SQSMessage, SQSSendMessageRequest } from '@/lib/types'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ExportDropdown } from '@/components/ExportDropdown'
import { toast } from 'sonner'
import {
  Inbox,
  Send,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Tag as TagIcon,
  AlertTriangle,
  Eye,
  Copy,
  RefreshCw,
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

      const response = await sendSQSMessage(queue.name, request)
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

export function SQSBrowser() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queuesFetcher = useCallback(() => fetchSQSQueues(), [])
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

  useEffect(() => {
    if (!selectedQueue) {
      setQueueDetail(null)
      setMessages([])
      return
    }
    fetchSQSQueueDetail(selectedQueue)
      .then(setQueueDetail)
      .catch(() => setQueueDetail(null))
  }, [selectedQueue])

  const handleReceiveMessages = async () => {
    if (!selectedQueue) return

    setLoadingMessages(true)
    try {
      const response = await receiveSQSMessages(selectedQueue, 10, 0)
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

  const handlePurge = async () => {
    if (!selectedQueue) return

    const confirmText = prompt(
      `Type the queue name "${selectedQueue}" to confirm purge. This will delete ALL messages and takes up to 60 seconds.`
    )

    if (confirmText !== selectedQueue) {
      toast.error('Queue name did not match. Purge cancelled.')
      return
    }

    try {
      await purgeSQSQueue(selectedQueue)
      toast.success('Queue purge initiated (may take up to 60 seconds)')
      setMessages([])
      // Refresh queue detail to see updated counts
      fetchSQSQueueDetail(selectedQueue).then(setQueueDetail)
    } catch (error) {
      toast.error(`Failed to purge queue: ${error}`)
    }
  }

  const queues = queuesData?.queues ?? []
  const filteredQueues = queues.filter((q) => q.name.toLowerCase().includes(search.toLowerCase()))
  const totalPages = Math.ceil(filteredQueues.length / pageSize)
  const paginatedQueues = filteredQueues.slice(page * pageSize, (page + 1) * pageSize)

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
      <EmptyState
        icon={Inbox}
        title="No SQS Queues"
        description="No SQS queues found in this environment."
      />
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
            </h2>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setSendSheetOpen(true)}>
              <Send className="h-4 w-4 mr-2" />
              Send Message
            </Button>
            <Button variant="destructive" onClick={handlePurge}>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Purge Queue
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <QueueTypeBadge type={queueDetail.type} />
          <QueueDepthBadge count={totalMessages} />
        </div>

        <Tabs defaultValue="messages" className="w-full">
          <TabsList>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span>Messages</span>
                  <Button onClick={handleReceiveMessages} disabled={loadingMessages} size="sm">
                    <Eye className="h-4 w-4 mr-2" />
                    {loadingMessages ? 'Loading...' : 'Peek Messages'}
                  </Button>
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
                          <TableCell className="font-mono text-xs">{msg.messageId.slice(0, 16)}...</TableCell>
                          <TableCell className="text-xs max-w-xs truncate">{msg.body.slice(0, 100)}</TableCell>
                          <TableCell className="text-xs">{msg.attributes.ApproximateReceiveCount || 0}</TableCell>
                          <TableCell className="text-xs">
                            {msg.attributes.SentTimestamp
                              ? new Date(Number(msg.attributes.SentTimestamp)).toLocaleString()
                              : '—'}
                          </TableCell>
                          <TableCell>
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
            {Object.keys(queueDetail.tags).length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Tags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(queueDetail.tags).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="text-xs">
                        <TagIcon className="h-3 w-3 mr-1" />
                        {key}: {value}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <EmptyState icon={TagIcon} title="No Tags" description="This queue has no tags." />
            )}
          </TabsContent>
        </Tabs>

        <SendMessageSheet
          queue={queueDetail}
          open={sendSheetOpen}
          onOpenChange={setSendSheetOpen}
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
            fetchSQSQueueDetail(selectedQueue).then(setQueueDetail)
          }}
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {paginatedQueues.map((queue) => {
          const totalMessages =
            queue.approximateNumberOfMessages +
            queue.approximateNumberOfMessagesNotVisible +
            queue.approximateNumberOfMessagesDelayed

          return (
            <Card
              key={queue.name}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => setSelectedQueue(queue.name)}
            >
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
  )
}
