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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  Star,
  MoreHorizontal,
  Settings,
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
  const { favoriteMessages: allFavoriteMessages, addFavorite, addFavorites, removeFavorite, updateFavorite } = useSQSFavoriteMessages()
  const favoriteMessages = selectedQueue
    ? allFavoriteMessages.filter((f) => f.sourceQueue === selectedQueue)
    : allFavoriteMessages
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
      setSelectedMessages(new Set())
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
      await deleteSQSQueue(selectedQueue, activeEndpoint)
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

      await deleteSQSMessagesBatch(selectedQueue, { receiptHandles }, activeEndpoint)
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

        const response = await sendSQSMessagesBatch(selectedQueue, { entries: transformedEntries }, activeEndpoint)
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
        await sendSQSMessage(selectedQueue, request, activeEndpoint)
        toast.success(`Sent "${favorite.name}" to ${selectedQueue}`)
      }
      fetchSQSQueueDetail(selectedQueue, activeEndpoint).then(setQueueDetail)
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
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px]" />
          ))}
        </div>
      </div>
    )
  }

  if (!queuesData || queues.length === 0) {
    return (
      <div className="space-y-6 p-6">
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
      <div className="space-y-6 p-6">
        <Breadcrumb segments={[
          createHomeSegment(),
          { label: 'SQS', href: '/resources/sqs', icon: getServiceIcon('sqs') },
          { label: queueDetail.name },
        ]} />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Inbox className="h-6 w-6 flex-shrink-0" />
            <h2 className="text-2xl font-bold truncate">{queueDetail.name}</h2>
            <button
              onClick={() => toggleFavorite(queueDetail.name)}
              className="p-1 rounded-md hover:bg-accent transition-colors flex-shrink-0"
              title={isFavorite(queueDetail.name) ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={`h-5 w-5 ${isFavorite(queueDetail.name) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
            </button>
            <QueueTypeBadge type={queueDetail.type} />
            <QueueDepthBadge count={totalMessages} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" className="h-8" onClick={() => setSendSheetOpen(true)}>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Send
            </Button>
            <Button size="sm" variant="secondary" className="h-8" onClick={() => setBatchSendSheetOpen(true)}>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Batch
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditSettingsSheetOpen(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Edit Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handlePurge} className="text-destructive focus:text-destructive">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Purge Queue
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDeleteQueue} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Queue
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
                  <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectedMessages.size === messages.length}
                            onCheckedChange={toggleSelectAll}
                            aria-label={selectedMessages.size === messages.length ? 'Deselect all' : 'Select all'}
                          />
                        </TableHead>
                        <TableHead className="text-muted-foreground">Message ID</TableHead>
                        <TableHead className="text-muted-foreground">Body Preview</TableHead>
                        <TableHead className="text-muted-foreground">Receive Count</TableHead>
                        <TableHead className="text-muted-foreground">Sent</TableHead>
                        <TableHead className="text-muted-foreground">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {messages.map((msg) => (
                        <TableRow key={msg.messageId} className="hover:bg-accent/50">
                          <TableCell>
                            <Checkbox
                              checked={selectedMessages.has(msg.messageId)}
                              onCheckedChange={() => toggleMessageSelection(msg.messageId)}
                              aria-label={selectedMessages.has(msg.messageId) ? 'Deselect' : 'Select'}
                            />
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
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleAddFavorite(msg)}
                                  >
                                    <Star className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Save as favorite</TooltipContent>
                              </Tooltip>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8"
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
                  </div>
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
                  <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-muted-foreground">Name</TableHead>
                        <TableHead className="text-muted-foreground">Body Preview</TableHead>
                        <TableHead className="text-muted-foreground">Source</TableHead>
                        <TableHead className="text-muted-foreground">Created</TableHead>
                        <TableHead className="text-muted-foreground">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {favoriteMessages.map((fav) => (
                        <TableRow key={fav.id} className="hover:bg-accent/50">
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
                                className="h-8"
                                onClick={() => {
                                  setSelectedFavorite(fav)
                                  setFavoriteViewerOpen(true)
                                }}
                              >
                                View
                              </Button>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleResendFavorite(fav)}
                                  >
                                    <Send className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Send to {selectedQueue}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => {
                                      navigator.clipboard.writeText(fav.messageBody)
                                      toast.success('Copied message body to clipboard')
                                    }}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy body</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleDeleteFavorite(fav.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete favorite</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="config" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Queue Configuration</CardTitle>
              </CardHeader>
              <CardContent className="text-sm p-0">
                <div className="divide-y divide-border/50">
                  {[
                    ['ARN', <span key="arn" className="font-mono text-xs break-all">{queueDetail.arn}</span>],
                    ['URL', <span key="url" className="font-mono text-xs break-all">{queueDetail.url}</span>],
                    ['Type', queueDetail.type],
                    ['Visibility Timeout', formatDuration(queueDetail.visibilityTimeout)],
                    ['Message Retention', formatDuration(queueDetail.messageRetentionPeriod)],
                    ['Max Message Size', `${(queueDetail.maximumMessageSize / 1024).toFixed(0)} KB`],
                    ['Delay', `${queueDetail.delaySeconds}s`],
                    ['Messages', `${queueDetail.approximateNumberOfMessages} visible, ${queueDetail.approximateNumberOfMessagesNotVisible} in-flight, ${queueDetail.approximateNumberOfMessagesDelayed} delayed`],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex items-baseline justify-between gap-4 px-6 py-3">
                      <span className="text-muted-foreground text-sm flex-shrink-0">{label}</span>
                      <span className="text-sm text-right">{value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {queueDetail.redrivePolicy && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Dead-Letter Queue Configuration</CardTitle>
                </CardHeader>
                <CardContent className="text-sm p-0">
                  <div className="divide-y divide-border/50">
                    <div className="flex items-baseline justify-between gap-4 px-6 py-3">
                      <span className="text-muted-foreground text-sm flex-shrink-0">DLQ ARN</span>
                      <span className="font-mono text-xs text-right break-all">{queueDetail.redrivePolicy.deadLetterTargetArn}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 px-6 py-3">
                      <span className="text-muted-foreground text-sm flex-shrink-0">Max Receive Count</span>
                      <span className="text-sm">{queueDetail.redrivePolicy.maxReceiveCount}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {queueDetail.type === 'FIFO' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">FIFO Settings</CardTitle>
                </CardHeader>
                <CardContent className="text-sm p-0">
                  <div className="flex items-baseline justify-between gap-4 px-6 py-3">
                    <span className="text-muted-foreground text-sm">Content-Based Deduplication</span>
                    <span className="text-sm">{queueDetail.contentBasedDeduplication ? 'Enabled' : 'Disabled'}</span>
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
            fetchSQSQueueDetail(selectedQueue, activeEndpoint).then(setQueueDetail)
          }}
        />

        <EditSettingsSheet
          queue={queueDetail}
          open={editSettingsSheetOpen}
          onOpenChange={setEditSettingsSheetOpen}
          onSuccess={() => {
            fetchSQSQueueDetail(selectedQueue, activeEndpoint).then(setQueueDetail)
          }}
        />

        <MessageViewerSheet
          message={selectedMessage}
          queueName={selectedQueue}
          open={messageViewerOpen}
          onOpenChange={setMessageViewerOpen}
          onDelete={() => {
            if (selectedMessage) {
              setMessages(messages.filter((m) => m.messageId !== selectedMessage.messageId))
              const newSelected = new Set(selectedMessages)
              newSelected.delete(selectedMessage.messageId)
              setSelectedMessages(newSelected)
            }
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
          queueName={selectedQueue}
        />

      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
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
          <div className="grid gap-3">
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
          <div className="grid gap-3">
          {paginatedQueues.map((queue) => (
            <QueueCard
              key={queue.name}
              queue={queue}
              isFavorite={isFavorite(queue.name)}
              onSelect={setSelectedQueue}
              onToggleFavorite={toggleFavorite}
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
