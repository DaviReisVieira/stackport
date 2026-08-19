import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

export function DeleteLogGroupConfirmSheet({
  logGroupName,
  open,
  onOpenChange,
  onConfirm,
}: {
  logGroupName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (confirmText !== logGroupName) {
      toast.error('Log group name did not match.')
      return
    }
    setDeleting(true)
    try {
      await onConfirm()
      setConfirmText('')
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Log Group
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete the log group <code className="font-mono">{logGroupName}</code> and all its log streams and events.
            This action cannot be undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete-group">Type the log group name to confirm</Label>
            <Input
              id="confirm-delete-group"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={logGroupName ?? ''}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== logGroupName} className="flex-1">
            {deleting ? 'Deleting...' : 'Delete Log Group'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DeleteLogStreamConfirmSheet({
  logStreamName,
  open,
  onOpenChange,
  onConfirm,
}: {
  logStreamName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (confirmText !== logStreamName) {
      toast.error('Log stream name did not match.')
      return
    }
    setDeleting(true)
    try {
      await onConfirm()
      setConfirmText('')
      onOpenChange(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Log Stream
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete the log stream <code className="font-mono">{logStreamName}</code> and all its events.
            This action cannot be undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete-stream">Type the log stream name to confirm</Label>
            <Input
              id="confirm-delete-stream"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={logStreamName ?? ''}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== logStreamName} className="flex-1">
            {deleting ? 'Deleting...' : 'Delete Log Stream'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
