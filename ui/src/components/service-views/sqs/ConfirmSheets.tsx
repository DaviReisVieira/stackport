import { useState } from 'react'
import type { SQSFavoriteMessage } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { AlertTriangle, Trash2 } from 'lucide-react'

export function PurgeConfirmSheet({
  queueName,
  open,
  onOpenChange,
  onConfirm,
}: {
  queueName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [purging, setPurging] = useState(false)

  const handlePurge = async () => {
    if (confirmText !== queueName) {
      toast.error('Queue name did not match.')
      return
    }
    setPurging(true)
    try {
      await onConfirm()
      setConfirmText('')
      onOpenChange(false)
    } finally {
      setPurging(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Purge Queue
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will delete ALL messages from the queue <code className="font-mono">{queueName}</code>.
            This action cannot be undone and takes up to 60 seconds to complete.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-purge">Type the queue name to confirm</Label>
            <Input
              id="confirm-purge"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={queueName}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handlePurge} disabled={purging || confirmText !== queueName} className="flex-1">
            {purging ? 'Purging...' : 'Purge Queue'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={purging}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DeleteFavoriteConfirmSheet({
  favorite,
  open,
  onOpenChange,
  onConfirm,
}: {
  favorite: SQSFavoriteMessage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (confirmText !== favorite?.name) {
      toast.error('Name did not match.')
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
            Delete Favorite
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete the favorite <code className="font-mono">{favorite?.name}</code>.
            This action cannot be undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete-fav">Type the favorite name to confirm</Label>
            <Input
              id="confirm-delete-fav"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={favorite?.name}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== favorite?.name} className="flex-1">
            {deleting ? 'Deleting...' : 'Delete Favorite'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DeleteConfirmSheet({
  queueName,
  open,
  onOpenChange,
  onConfirm,
}: {
  queueName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (confirmText !== queueName) {
      toast.error('Queue name did not match.')
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
            Delete Queue
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete the queue <code className="font-mono">{queueName}</code> and all its messages.
            This action cannot be undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete">Type the queue name to confirm</Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={queueName}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== queueName} className="flex-1">
            {deleting ? 'Deleting...' : 'Delete Queue'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DeleteMessagesConfirmSheet({
  messageCount,
  open,
  onOpenChange,
  onConfirm,
}: {
  messageCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') {
      toast.error('Type DELETE to confirm.')
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
            Delete {messageCount} Message{messageCount !== 1 ? 's' : ''}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This will permanently delete {messageCount} selected message{messageCount !== 1 ? 's' : ''}.
            This action cannot be undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete-msgs">Type DELETE to confirm</Label>
            <Input
              id="confirm-delete-msgs"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="font-mono"
              autoFocus
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== 'DELETE'} className="flex-1">
            {deleting ? 'Deleting...' : `Delete ${messageCount} Message${messageCount !== 1 ? 's' : ''}`}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
