import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { toast } from 'sonner'
import { Tag as TagIcon, Plus, Trash2, Copy, Save, X } from 'lucide-react'

interface TagsSectionProps {
  tags: Record<string, string>
  onSave?: (tags: Record<string, string>) => Promise<void>
  title?: string
  emptyMessage?: string
}

export function TagsSection({
  tags,
  onSave,
  title = 'Tags',
  emptyMessage = 'No tags found.',
}: TagsSectionProps) {
  const [editing, setEditing] = useState(false)
  const [editedTags, setEditedTags] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)

  const editable = !!onSave
  const entries = Object.entries(editing ? editedTags : tags)

  const startEditing = () => {
    setEditedTags({ ...tags })
    setNewKey('')
    setNewValue('')
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setEditedTags({})
    setNewKey('')
    setNewValue('')
  }

  const handleSave = async () => {
    if (!onSave) return
    try {
      setSaving(true)
      await onSave(editedTags)
      toast.success('Tags updated successfully')
      setEditing(false)
    } catch (error) {
      toast.error(`Failed to update tags: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const addTag = () => {
    const key = newKey.trim()
    const value = newValue.trim()
    if (!key) {
      toast.error('Tag key is required')
      return
    }
    setEditedTags({ ...editedTags, [key]: value })
    setNewKey('')
    setNewValue('')
  }

  const removeTag = (key: string) => {
    const updated = { ...editedTags }
    delete updated[key]
    setEditedTags(updated)
  }

  const updateTagValue = (key: string, value: string) => {
    setEditedTags({ ...editedTags, [key]: value })
  }

  const copyTag = (key: string, value: string) => {
    navigator.clipboard.writeText(`${key}=${value}`)
    toast.success('Copied to clipboard')
  }

  const copyAllTags = () => {
    const text = Object.entries(tags)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    toast.success(`Copied ${Object.keys(tags).length} tag(s) to clipboard`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TagIcon className="h-4 w-4" />
            {title}
            {entries.length > 0 && (
              <Badge variant="secondary" className="text-xs">{entries.length}</Badge>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!editing && entries.length > 0 && (
              <Button variant="ghost" size="sm" onClick={copyAllTags}>
                <Copy className="h-4 w-4 mr-1" />
                Copy All
              </Button>
            )}
            {editable && !editing && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <TagIcon className="h-4 w-4 mr-1" />
                Edit Tags
              </Button>
            )}
            {editing && (
              <>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" />
                  {saving ? 'Saving...' : 'Save Tags'}
                </Button>
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 && !editing ? (
          <EmptyState icon={TagIcon} title="No Tags" description={emptyMessage} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {editing ? (
                      <Input
                        value={value}
                        onChange={(e) => updateTagValue(key, e.target.value)}
                        className="h-7 text-xs font-mono"
                      />
                    ) : (
                      value
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {editing ? (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeTag(key)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyTag(key, value)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {editing && (
                <TableRow>
                  <TableCell>
                    <Input
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="New key"
                      className="h-7 text-xs font-mono"
                      onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="New value"
                      className="h-7 text-xs font-mono"
                      onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={addTag}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function TagCountBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <Badge variant="outline" className="text-xs">
      <TagIcon className="h-3 w-3 mr-1" />
      {count}
    </Badge>
  )
}
