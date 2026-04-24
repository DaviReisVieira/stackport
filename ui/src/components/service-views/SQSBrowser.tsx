import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchSQSQueues,
  fetchSQSQueueDetail,
  sendSQSMessage,
  receiveSQSMessages,
  deleteSQSMessagesBatch,
  purgeSQSQueue,
  deleteSQSQueue,
  sendSQSMessagesBatch,
  updateResourceTags
} from '@/lib/api'
import type {
  SQSQueue,
  SQSQueueDetail,
  SQSMessage,
  SQSSendMessageRequest,
  SQSFavoriteMessage,
} from '@/lib/types'
import { useSQSFavoriteMessages } from '@/hooks/useSQSFavoriteMessages'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { TagsSection } from '@/components/TagsSection'
import { Input } from '@/components/ui/input'
import { ExportDropdown } from '@/components/ExportDropdown'
import { toast } from 'sonner'
import {
  Inbox,
  Send,
  Trash2,
  Search,
  AlertTriangle,
  Eye,
  Copy,
  RefreshCw,
  Plus,
  Edit,
  Star,
  CheckSquare,
  Square,
} from 'lucide-react'

// Extracted sub-components
import { formatDuration } from './sqs/utils'
import { QueueTypeBadge, QueueDepthBadge } from './sqs/QueueBadges'
import { PaginationBar } from './sqs/PaginationBar'
import { QueueCard } from './sqs/QueueCard'
import { CreateQueueSheet } from './sqs/CreateQueueSheet'
import { SendMessageSheet } from './sqs/SendMessageSheet'
import { EditSettingsSheet } from './sqs/EditSettingsSheet'
import { BatchSendSheet } from './sqs/BatchSendSheet'
import { CreateFavoriteSheet } from './sqs/CreateFavoriteSheet'
import type { CreateFavoriteInitialData } from './sqs/CreateFavoriteSheet'
import { FavoriteViewerSheet } from './sqs/FavoriteViewerSheet'
import { MessageViewerSheet } from './sqs/MessageViewerSheet'
import {
  PurgeConfirmSheet,
  DeleteFavoriteConfirmSheet,
  DeleteConfirmSheet,
  DeleteMessagesConfirmSheet,
} from './sqs/ConfirmSheets'

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
  const [deleteMessagesConfirmOpen, setDeleteMessagesConfirmOpen] = useState(false)

  // Favorites state
  const { favoriteMessages, addFavorite, addFavorites, removeFavorite, updateFavorite } = useSQSFavoriteMessages()
  const [activeTab, setActiveTab] = useState('messages')
  const [createFavoriteSheetOpen, setCreateFavoriteSheetOpen] = useState(false)
  const [saveFavoriteInitialData, setSaveFavoriteInitialData] = useState<CreateFavoriteInitialData | undefined>(undefined)

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

  const handleDeleteSelected = () => {
    if (!selectedQueue || selectedMessages.size === 0) return
    setDeleteMessagesConfirmOpen(true)
  }

  const confirmDeleteSelected = async () => {
    if (!selectedQueue || selectedMessages.size === 0) return

    try {
      const receiptHandles = messages
        .filter((msg) => selectedMessages.has(msg.messageId))
        .map((msg) => msg.receiptHandle)

      await deleteSQSMessagesBatch(selectedQueue, { receiptHandles })
      toast.success(`Deleted ${selectedMessages.size} message(s)`)
      setSelectedMessages(new Set())
      setMessages(messages.filter((msg) => !selectedMessages.has(msg.messageId)))
      fetchSQSQueueDetail(selectedQueue, activeEndpoint).then(setQueueDetail)
    } catch (error) {
      toast.error(`Failed to delete messages: ${error}`)
      throw error
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

        <DeleteMessagesConfirmSheet
          messageCount={selectedMessages.size}
          open={deleteMessagesConfirmOpen}
          onOpenChange={setDeleteMessagesConfirmOpen}
          onConfirm={confirmDeleteSelected}
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
            {favoriteQueues.map((queue) => (
              <QueueCard
                key={queue.name}
                queue={queue}
                isFavorite={isFavorite(queue.name)}
                onSelect={setSelectedQueue}
                onToggleFavorite={toggleFavorite}
              />
            ))}
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
          {paginatedQueues.map((queue) => (
            <QueueCard
              key={queue.name}
              queue={queue}
              isFavorite={isFavorite(queue.name)}
              onSelect={setSelectedQueue}
              onToggleFavorite={toggleFavorite}
              showExtendedStats
            />
          ))}
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
