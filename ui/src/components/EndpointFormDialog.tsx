import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { testEndpointConnection, fetchProfiles } from '@/lib/api'
import { toast } from 'sonner'
import type { AuthType } from '@/lib/types'

interface AuthConfig {
  auth_type: AuthType
  auth_profile: string | null
  auth_access_key_id: string | null
  auth_secret_access_key: string | null
}

interface EndpointFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  initialName?: string
  initialUrl?: string | null
  initialRegion?: string | null
  initialAuthType?: AuthType
  initialAuthProfile?: string | null
  source?: 'env' | 'user'
  onSubmit: (name: string, url: string | null, region: string | null, auth: AuthConfig) => Promise<void>
}

export function EndpointFormDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  initialUrl = '',
  initialRegion = '',
  initialAuthType = 'default',
  initialAuthProfile = null,
  source,
  onSubmit,
}: EndpointFormDialogProps) {
  const [name, setName] = useState(initialName)
  const [url, setUrl] = useState(initialUrl || '')
  const [region, setRegion] = useState(initialRegion || '')
  const [isRealAWS, setIsRealAWS] = useState(false)
  const [authType, setAuthType] = useState<AuthType>(initialAuthType)
  const [authProfile, setAuthProfile] = useState(initialAuthProfile || '')
  const [authAccessKeyId, setAuthAccessKeyId] = useState('')
  const [authSecretAccessKey, setAuthSecretAccessKey] = useState('')
  const [profiles, setProfiles] = useState<string[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ health: string; error?: string } | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setUrl(initialUrl || '')
      setRegion(initialRegion || '')
      setIsRealAWS(initialUrl === null || initialUrl === '')
      setAuthType(initialAuthType)
      setAuthProfile(initialAuthProfile || '')
      setAuthAccessKeyId('')
      setAuthSecretAccessKey('')
      setTestResult(null)
      loadProfiles()
    }
  }, [open, initialName, initialUrl, initialRegion, initialAuthType, initialAuthProfile])

  const loadProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const { profiles: p } = await fetchProfiles()
      setProfiles(p)
    } catch {
      setProfiles([])
    } finally {
      setLoadingProfiles(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const isEnvEdit = mode === 'edit' && source === 'env'
      const testUrl = isEnvEdit ? (initialUrl ?? null) : (isRealAWS ? null : url.trim() || null)
      const result = await testEndpointConnection({
        name: name.trim() || 'test',
        url: testUrl,
        region: region.trim() || null,
        auth_type: authType,
        auth_profile: authType === 'profile' ? authProfile.trim() || null : null,
        auth_access_key_id: authType === 'credentials' ? authAccessKeyId.trim() || null : null,
        auth_secret_access_key: authType === 'credentials' ? authSecretAccessKey.trim() || null : null,
      })
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Name is required')
      return
    }

    const isEnvEdit = mode === 'edit' && source === 'env'
    if (!isEnvEdit && !isRealAWS && !url.trim()) {
      toast.error('URL is required for local endpoints')
      return
    }

    if (authType === 'profile' && !authProfile.trim()) {
      toast.error('Profile name is required')
      return
    }

    if (authType === 'credentials' && (!authAccessKeyId.trim() || !authSecretAccessKey.trim())) {
      toast.error('Both Access Key ID and Secret Access Key are required')
      return
    }

    setSubmitting(true)
    try {
      const submitUrl = isEnvEdit ? (initialUrl ?? null) : (isRealAWS ? null : url.trim())
      const auth: AuthConfig = {
        auth_type: authType,
        auth_profile: authType === 'profile' ? authProfile.trim() : null,
        auth_access_key_id: authType === 'credentials' ? authAccessKeyId.trim() : null,
        auth_secret_access_key: authType === 'credentials' ? authSecretAccessKey.trim() : null,
      }
      await onSubmit(name.trim(), submitUrl, region.trim() || null, auth)
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
                : 'Update the endpoint configuration'}
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
              {mode === 'edit' && source === 'env' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted p-3 rounded-md">
                  <Badge variant="secondary">ENV</Badge>
                  <span>URL is set by environment variable</span>
                </div>
              ) : (
                <>
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
                      <span>Will use configured authentication</span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="region">Region</Label>
              <Input
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g., us-east-1 (defaults to global)"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use the global region setting
              </p>
            </div>

            {/* Authentication */}
            <div className="grid gap-2">
              <Label>Authentication</Label>
              <Select
                value={authType}
                onValueChange={(v) => setAuthType(v as AuthType)}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default (env vars / instance role)</SelectItem>
                  <SelectItem value="profile">AWS Profile (~/.aws/config)</SelectItem>
                  <SelectItem value="credentials">Static Credentials</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {authType === 'profile' && (
              <div className="grid gap-2">
                <Label htmlFor="profile">Profile</Label>
                {loadingProfiles ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading profiles...
                  </div>
                ) : profiles.length > 0 ? (
                  <Select
                    value={authProfile}
                    onValueChange={setAuthProfile}
                    disabled={submitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="profile"
                    value={authProfile}
                    onChange={(e) => setAuthProfile(e.target.value)}
                    placeholder="e.g., prod, nprod"
                    disabled={submitting}
                    required
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  Supports SSO, AssumeRole, and static credentials configured in ~/.aws/config
                </p>
              </div>
            )}

            {authType === 'credentials' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="access-key">Access Key ID</Label>
                  <Input
                    id="access-key"
                    value={authAccessKeyId}
                    onChange={(e) => setAuthAccessKeyId(e.target.value)}
                    placeholder="AKIA..."
                    disabled={submitting}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="secret-key">Secret Access Key</Label>
                  <Input
                    id="secret-key"
                    type="password"
                    value={authSecretAccessKey}
                    onChange={(e) => setAuthSecretAccessKey(e.target.value)}
                    placeholder="••••••••"
                    disabled={submitting}
                    required
                  />
                </div>
                <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 p-2 rounded-md">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Credentials are stored locally in ~/.stackport/endpoints.json. Use AWS profiles for better security.
                  </span>
                </div>
              </>
            )}

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
