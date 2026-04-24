import { useState } from 'react'
import { deleteSQSMessage } from '@/lib/api'
import type { SQSMessage } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { JsonViewer } from '@/components/JsonViewer'
import { toast } from 'sonner'
import { Inbox, Trash2, Copy } from 'lucide-react'

export function MessageViewerSheet({
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const { activeEndpoint } = useEndpoint()

  const handleDelete = async () => {
    if (!message) return

    try {
      setDeleting(true)
      await deleteSQSMessage(queueName, message.receiptHandle, activeEndpoint)
      toast.success('Message deleted')
      onDelete()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to delete message: ${error}`)
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
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
              {showDeleteConfirm ? (
                <>
                  <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Deleting...' : 'Confirm Delete'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
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
