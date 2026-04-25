import { useEffect, useState } from 'react'
import { sendSQSMessagesBatch } from '@/lib/api'
import type { SQSQueueDetail, SQSBatchSendRequest, SQSBatchSendMessageEntry } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Send } from 'lucide-react'

export function BatchSendSheet({
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
    const transformedEntries: SQSBatchSendMessageEntry[] = []

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]

      if (typeof entry !== 'object' || entry === null) {
        toast.error(`Entry ${i + 1} must be an object`)
        return
      }

      const id = `msg-${i + 1}`

      let messageBody: string
      if ('messageBody' in entry && typeof entry.messageBody === 'string') {
        messageBody = entry.messageBody
      } else {
        messageBody = JSON.stringify(entry)
      }

      const batchEntry: SQSBatchSendMessageEntry = { id, messageBody }

      if ('delaySeconds' in entry && typeof entry.delaySeconds === 'number') {
        batchEntry.delaySeconds = entry.delaySeconds
      }
      if ('messageGroupId' in entry && typeof entry.messageGroupId === 'string') {
        batchEntry.messageGroupId = entry.messageGroupId
      }
      if ('messageDeduplicationId' in entry && typeof entry.messageDeduplicationId === 'string') {
        batchEntry.messageDeduplicationId = entry.messageDeduplicationId
      }

      transformedEntries.push(batchEntry)
    }

    try {
      setSending(true)
      const request: SQSBatchSendRequest = { entries: transformedEntries }
      const response = await sendSQSMessagesBatch(queue.name, request, activeEndpoint)

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
