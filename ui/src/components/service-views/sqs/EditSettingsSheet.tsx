import { useEffect, useState } from 'react'
import { updateSQSQueueAttributes, updateSQSRedrivePolicy } from '@/lib/api'
import type { SQSQueueDetail, SQSUpdateAttributesRequest } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Settings, Edit } from 'lucide-react'

export function EditSettingsSheet({
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
  const [visibilityTimeout, setVisibilityTimeout] = useState(30)
  const [messageRetentionPeriod, setMessageRetentionPeriod] = useState(345600)
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [maximumMessageSize, setMaximumMessageSize] = useState(262144)
  const [receiveMessageWaitTime, setReceiveMessageWaitTime] = useState(0)

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
      await updateSQSQueueAttributes(queue.name, attrsRequest, activeEndpoint)

      // Update DLQ only if it was changed
      if (dlqEnabled && dlqTargetArn) {
        await updateSQSRedrivePolicy(queue.name, {
          deadLetterTargetArn: dlqTargetArn,
          maxReceiveCount: maxReceiveCount,
        }, activeEndpoint)
      }

      toast.success('Queue settings updated successfully')
      onSuccess()
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
