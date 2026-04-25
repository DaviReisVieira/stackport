import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Star } from 'lucide-react'

// Re-export the type used by addFavorite so callers don't need to construct it
export type AddFavoriteData = {
  messageBody: string
  name: string
  delaySeconds?: number
  messageGroupId?: string
  messageDeduplicationId?: string
  messageAttributes?: Record<string, { stringValue: string; dataType: string }>
  sourceQueue?: string
  originalMessageId?: string
  isBatch?: boolean
}

export type CreateFavoriteInitialData = {
  name: string
  messageBody: string
  sourceQueue?: string
  originalMessageId?: string
  messageAttributes?: Record<string, { stringValue: string; dataType: string }>
}

export function CreateFavoriteSheet({
  open,
  onOpenChange,
  onCreated,
  addFavorite,
  initialData,
  queueName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  addFavorite: (data: AddFavoriteData) => void
  initialData?: CreateFavoriteInitialData
  queueName?: string | null
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
        sourceQueue: initialData?.sourceQueue || queueName || undefined,
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
        sourceQueue: queueName || undefined,
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
