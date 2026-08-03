import { useState } from 'react'
import { createLogGroup } from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

export const VALID_RETENTION_DAYS = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653]

export function CreateLogGroupSheet({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [retention, setRetention] = useState<string>('never')
  const [tags, setTags] = useState<Record<string, string>>({})
  const [tagKey, setTagKey] = useState('')
  const [tagValue, setTagValue] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Log group name is required')
      return
    }

    try {
      setCreating(true)
      const retentionInDays = retention === 'never' ? null : Number(retention)
      const response = await createLogGroup(name.trim(), retentionInDays, tags, activeEndpoint)
      toast.success(`Log group created: ${response.name}`)

      setName('')
      setRetention('never')
      setTags({})
      setTagKey('')
      setTagValue('')

      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to create log group: ${error}`)
    } finally {
      setCreating(false)
    }
  }

  const addTag = () => {
    if (tagKey.trim() && tagValue.trim()) {
      setTags({ ...tags, [tagKey.trim()]: tagValue.trim() })
      setTagKey('')
      setTagValue('')
    }
  }

  const removeTag = (key: string) => {
    const newTags = { ...tags }
    delete newTags[key]
    setTags(newTags)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create Log Group
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="log-group-name">Log Group Name *</Label>
            <Input
              id="log-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="/aws/lambda/my-function"
              className="font-mono"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="log-group-retention">Retention</Label>
            <Select value={retention} onValueChange={setRetention}>
              <SelectTrigger id="log-group-retention">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never expire</SelectItem>
                {VALID_RETENTION_DAYS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} day{days !== 1 ? 's' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-3">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Key"
                value={tagKey}
                onChange={(e) => setTagKey(e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Value"
                value={tagValue}
                onChange={(e) => setTagValue(e.target.value)}
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={addTag}>
                Add
              </Button>
            </div>
            {Object.keys(tags).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(tags).map(([key, value]) => (
                  <Badge key={key} variant="secondary" className="text-xs">
                    {key}: {value}
                    <button
                      type="button"
                      onClick={() => removeTag(key)}
                      className="ml-1 hover:text-destructive"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <Button onClick={handleCreate} disabled={creating} className="flex-1">
            <Plus className="h-4 w-4 mr-2" />
            {creating ? 'Creating...' : 'Create Log Group'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
