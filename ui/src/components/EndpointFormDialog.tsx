import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { checkEndpointHealth } from '@/lib/api'
import { toast } from 'sonner'

interface EndpointFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  initialName?: string
  initialUrl?: string | null
  onSubmit: (name: string, url: string | null) => Promise<void>
}

export function EndpointFormDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  initialUrl = '',
  onSubmit,
}: EndpointFormDialogProps) {
  const [name, setName] = useState(initialName)
  const [url, setUrl] = useState(initialUrl || '')
  const [isRealAWS, setIsRealAWS] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ health: string; error?: string } | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setUrl(initialUrl || '')
      setIsRealAWS(initialUrl === null || initialUrl === '')
      setTestResult(null)
    }
  }, [open, initialName, initialUrl])

  const handleTestConnection = async () => {
    if (mode === 'edit' && initialName) {
      setTesting(true)
      setTestResult(null)
      try {
        const result = await checkEndpointHealth(initialName)
        setTestResult({ health: result.health, error: result.error || undefined })
        if (result.health === 'healthy') {
          toast.success('Connection successful')
        } else {
          toast.error('Connection failed')
        }
      } catch (error) {
        setTestResult({ health: 'unhealthy', error: String(error) })
        toast.error('Failed to test connection')
      } finally {
        setTesting(false)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Name is required')
      return
    }

    if (!isRealAWS && !url.trim()) {
      toast.error('URL is required for local endpoints')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(name.trim(), isRealAWS ? null : url.trim())
      onOpenChange(false)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      toast.error(errorMsg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{mode === 'add' ? 'Add Endpoint' : 'Edit Endpoint'}</DialogTitle>
            <DialogDescription>
              {mode === 'add'
                ? 'Add a new AWS endpoint to connect to'
                : 'Update the endpoint URL'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., local, ministack, prod"
                disabled={mode === 'edit' || submitting}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="url">Endpoint URL</Label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRealAWS}
                    onChange={(e) => setIsRealAWS(e.target.checked)}
                    disabled={submitting}
                    className="rounded border-input"
                  />
                  <span>Real AWS</span>
                </label>
              </div>
              {!isRealAWS && (
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:4566"
                  disabled={submitting}
                  required={!isRealAWS}
                />
              )}
              {isRealAWS && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted p-3 rounded-md">
                  <Badge variant="outline" className="text-orange-500 border-orange-500">AWS</Badge>
                  <span>Will use default AWS credentials and endpoints</span>
                </div>
              )}
            </div>
            {mode === 'edit' && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testing || submitting}
                >
                  {testing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </Button>
                {testResult && (
                  <div className="flex items-center gap-1.5 text-sm">
                    {testResult.health === 'healthy' ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-emerald-500">Connected</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-red-500">Failed</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {testResult?.error && (
              <div className="text-xs text-muted-foreground bg-muted p-2 rounded-md">
                {testResult.error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === 'add' ? 'Adding...' : 'Updating...'}
                </>
              ) : (
                mode === 'add' ? 'Add Endpoint' : 'Update Endpoint'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
