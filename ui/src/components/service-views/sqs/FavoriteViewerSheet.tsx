import { useEffect, useState } from 'react'
import type { SQSFavoriteMessage } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { JsonViewer } from '@/components/JsonViewer'
import { toast } from 'sonner'
import { Star, Edit, Copy, Trash2 } from 'lucide-react'

export function FavoriteViewerSheet({
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
