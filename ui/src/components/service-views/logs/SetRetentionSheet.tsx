import { useState } from 'react'
import { setLogGroupRetention } from '@/lib/api'
import { useEndpoint } from '@/hooks/useEndpoint'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Settings } from 'lucide-react'
import { VALID_RETENTION_DAYS } from './CreateLogGroupSheet'

export function SetRetentionSheet({
  logGroupName,
  currentRetention,
  open,
  onOpenChange,
  onSuccess,
}: {
  logGroupName: string | null
  currentRetention: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [retention, setRetention] = useState<string>(currentRetention ? String(currentRetention) : 'never')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!logGroupName) return
    try {
      setSaving(true)
      const retentionInDays = retention === 'never' ? null : Number(retention)
      await setLogGroupRetention(logGroupName, retentionInDays, activeEndpoint)
      toast.success(`Retention updated for ${logGroupName}`)
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to update retention: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setRetention(currentRetention ? String(currentRetention) : 'never')
        onOpenChange(next)
      }}
    >
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Set Retention
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Set the retention period for <code className="font-mono">{logGroupName}</code>.
          </p>

          <div className="space-y-2">
            <Label htmlFor="retention-select">Retention</Label>
            <Select value={retention} onValueChange={setRetention}>
              <SelectTrigger id="retention-select">
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
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
