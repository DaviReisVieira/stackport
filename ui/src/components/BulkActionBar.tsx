import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'
import { bulkTag, bulkDelete } from '@/lib/api'
import type { BulkOperationResponse } from '@/lib/types'
import { toast } from 'sonner'
import { Tag, Trash2, Plus, X } from 'lucide-react'

export interface BulkResource {
  service: string
  type: string
  id: string
}

interface BulkActionBarProps {
  selected: BulkResource[]
  onClear: () => void
  onComplete: () => void
  supportsDelete?: boolean
}

export function BulkActionBar({
  selected,
  onClear,
  onComplete,
  supportsDelete = true,
}: BulkActionBarProps) {
  const [tagSheetOpen, setTagSheetOpen] = useState(false)
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false)
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const [tagEntries, setTagEntries] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
  const [loading, setLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  if (selected.length === 0) return null

  const addTagEntry = () => {
    setTagEntries([...tagEntries, { key: '', value: '' }])
  }

  const removeTagEntry = (index: number) => {
    setTagEntries(tagEntries.filter((_, i) => i !== index))
  }

  const updateTagEntry = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...tagEntries]
    updated[index] = { ...updated[index], [field]: val }
    setTagEntries(updated)
  }

  const handleBulkTag = async () => {
    const tags: Record<string, string> = {}
    for (const entry of tagEntries) {
      const k = entry.key.trim()
      if (k) tags[k] = entry.value.trim()
    }
    if (Object.keys(tags).length === 0) {
      toast.error('At least one tag key is required')
      return
    }

    setLoading(true)
    try {
      const result: BulkOperationResponse = await bulkTag({
        action,
        tags,
        resources: selected,
      })
      if (result.failed === 0) {
        toast.success(`${action === 'add' ? 'Added' : 'Removed'} tags on ${result.succeeded} resource(s)`)
      } else {
        toast.warning(`${result.succeeded} succeeded, ${result.failed} failed`)
      }
      setTagSheetOpen(false)
      setTagEntries([{ key: '', value: '' }])
      onComplete()
    } catch (err) {
      toast.error(`Bulk tag failed: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (confirmText !== 'DELETE') return

    setLoading(true)
    try {
      const result: BulkOperationResponse = await bulkDelete({
        resources: selected,
      })
      if (result.failed === 0) {
        toast.success(`Deleted ${result.succeeded} resource(s)`)
      } else {
        toast.warning(`${result.succeeded} deleted, ${result.failed} failed`)
      }
      setDeleteSheetOpen(false)
      setConfirmText('')
      onComplete()
    } catch (err) {
      toast.error(`Bulk delete failed: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 p-3 bg-primary/10 border rounded-lg">
        <Badge variant="secondary">{selected.length} selected</Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAction('add')
            setTagSheetOpen(true)
          }}
        >
          <Tag className="h-4 w-4 mr-1" />
          Add Tags
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAction('remove')
            setTagSheetOpen(true)
          }}
        >
          <Tag className="h-4 w-4 mr-1" />
          Remove Tags
        </Button>
        {supportsDelete && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteSheetOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>

      <Sheet open={tagSheetOpen} onOpenChange={setTagSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{action === 'add' ? 'Add' : 'Remove'} Tags</SheetTitle>
            <SheetDescription>
              {action === 'add'
                ? `Add tags to ${selected.length} resource(s)`
                : `Remove tags from ${selected.length} resource(s)`}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            {tagEntries.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Key</Label>
                  <Input
                    value={entry.key}
                    onChange={(e) => updateTagEntry(i, 'key', e.target.value)}
                    placeholder="Tag key"
                    className="h-8 text-sm"
                  />
                </div>
                {action === 'add' && (
                  <div className="flex-1">
                    <Label className="text-xs">Value</Label>
                    <Input
                      value={entry.value}
                      onChange={(e) => updateTagEntry(i, 'value', e.target.value)}
                      placeholder="Tag value"
                      className="h-8 text-sm"
                    />
                  </div>
                )}
                {tagEntries.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 mt-5"
                    onClick={() => removeTagEntry(i)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addTagEntry}>
              <Plus className="h-4 w-4 mr-1" />
              Add Another Tag
            </Button>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setTagSheetOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleBulkTag} disabled={loading}>
                {loading ? 'Processing...' : `${action === 'add' ? 'Add' : 'Remove'} Tags`}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={deleteSheetOpen} onOpenChange={setDeleteSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Delete Resources</SheetTitle>
            <SheetDescription>
              This will permanently delete {selected.length} resource(s). This action cannot be undone.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2 max-h-48 overflow-auto border rounded p-2">
              {selected.map((r, i) => (
                <div key={i} className="text-sm font-mono">
                  {r.service}/{r.type}/{r.id}
                </div>
              ))}
            </div>
            <div>
              <Label>Type DELETE to confirm</Label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteSheetOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={loading || confirmText !== 'DELETE'}
              >
                {loading ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
