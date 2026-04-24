import { useState } from 'react'
import { sendSQSMessage } from '@/lib/api'
import type { SQSQueueDetail, SQSSendMessageRequest } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Send } from 'lucide-react'

export function SendMessageSheet({
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
