import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { AlertCircle, Plus, Trash2, X } from 'lucide-react'
import type { LambdaUpdateConfigRequest } from '@/lib/types'

interface LambdaConfig {
  Description?: string
  Handler?: string
  Runtime?: string
  MemorySize: number
  Timeout: number
  Environment?: {
    Variables?: Record<string, string>
  }
  Layers?: Array<{ Arn: string; CodeSize: number }>
}

interface ConfigurationEditorProps {
  config: LambdaConfig
  onSave: (updates: LambdaUpdateConfigRequest) => Promise<void>
  onCancel: () => void
}

const SUPPORTED_RUNTIMES = [
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'nodejs22.x',
  'nodejs20.x',
  'nodejs18.x',
  'java21',
  'java17',
  'java11',
  'java8.al2',
  'dotnet8',
  'dotnet6',
  'go1.x',
  'ruby3.3',
  'ruby3.2',
  'provided.al2023',
  'provided.al2',
]

interface EnvVar {
  key: string
  value: string
}

export function ConfigurationEditor({ config, onSave, onCancel }: ConfigurationEditorProps) {
  const [description, setDescription] = useState(config.Description ?? '')
  const [handler, setHandler] = useState(config.Handler ?? '')
  const [runtime, setRuntime] = useState(config.Runtime ?? '')
  const [memorySize, setMemorySize] = useState(config.MemorySize.toString())
  const [timeout, setTimeout] = useState(config.Timeout.toString())
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    const vars = config.Environment?.Variables ?? {}
    return Object.entries(vars).map(([key, value]) => ({ key, value }))
  })
  const [isSaving, setIsSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    // Validate inputs
    const mem = parseInt(memorySize, 10)
    const timeoutVal = parseInt(timeout, 10)

    if (isNaN(mem) || mem < 128 || mem > 10240) {
      setValidationError('Memory must be between 128 and 10240 MB')
      return
    }

    if (isNaN(timeoutVal) || timeoutVal < 1 || timeoutVal > 900) {
      setValidationError('Timeout must be between 1 and 900 seconds')
      return
    }

    // Check for duplicate or empty env var keys
    const keys = envVars.map(e => e.key.trim()).filter(k => k)
    const uniqueKeys = new Set(keys)
    if (keys.length !== uniqueKeys.size) {
      setValidationError('Environment variable keys must be unique')
      return
    }

    setValidationError(null)
  }, [memorySize, timeout, envVars])

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }])
  }

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
  }

  const updateEnvVar = (index: number, field: 'key' | 'value', newValue: string) => {
    const updated = [...envVars]
    updated[index][field] = newValue
    setEnvVars(updated)
  }

  const handleSave = async () => {
    if (validationError) return

    setIsSaving(true)
    try {
      const updates: LambdaUpdateConfigRequest = {}

      // Only include changed fields
      if (description !== (config.Description ?? '')) {
        updates.description = description
      }

      if (handler !== (config.Handler ?? '')) {
        updates.handler = handler
      }

      if (runtime !== (config.Runtime ?? '')) {
        updates.runtime = runtime
      }

      const mem = parseInt(memorySize, 10)
      if (mem !== config.MemorySize) {
        updates.memorySize = mem
      }

      const timeoutVal = parseInt(timeout, 10)
      if (timeoutVal !== config.Timeout) {
        updates.timeout = timeoutVal
      }

      // Build env vars object from array
      const newEnvVars: Record<string, string> = {}
      envVars.forEach(({ key, value }) => {
        const k = key.trim()
        if (k) newEnvVars[k] = value
      })

      const currentEnvVars = config.Environment?.Variables ?? {}
      const envChanged = JSON.stringify(newEnvVars) !== JSON.stringify(currentEnvVars)
      if (envChanged) {
        updates.environment = newEnvVars
      }

      // If no changes, just close
      if (Object.keys(updates).length === 0) {
        onCancel()
        return
      }

      await onSave(updates)
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges = () => {
    if (description !== (config.Description ?? '')) return true
    if (handler !== (config.Handler ?? '')) return true
    if (runtime !== (config.Runtime ?? '')) return true
    if (parseInt(memorySize, 10) !== config.MemorySize) return true
    if (parseInt(timeout, 10) !== config.Timeout) return true

    const newEnvVars: Record<string, string> = {}
    envVars.forEach(({ key, value }) => {
      const k = key.trim()
      if (k) newEnvVars[k] = value
    })
    const currentEnvVars = config.Environment?.Variables ?? {}
    if (JSON.stringify(newEnvVars) !== JSON.stringify(currentEnvVars)) return true

    return false
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Edit Configuration</h3>
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Function description"
            rows={2}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="handler">Handler</Label>
          <Input
            id="handler"
            value={handler}
            onChange={(e) => setHandler(e.target.value)}
            placeholder="index.handler"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="runtime">Runtime</Label>
          <Select value={runtime} onValueChange={setRuntime}>
            <SelectTrigger id="runtime">
              <SelectValue placeholder="Select runtime" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_RUNTIMES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="memory">Memory (MB)</Label>
            <Input
              id="memory"
              type="number"
              min="128"
              max="10240"
              step="1"
              value={memorySize}
              onChange={(e) => setMemorySize(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">128 - 10240 MB</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeout">Timeout (seconds)</Label>
            <Input
              id="timeout"
              type="number"
              min="1"
              max="900"
              step="1"
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">1 - 900 seconds</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Environment Variables</Label>
            <Button variant="outline" size="sm" onClick={addEnvVar}>
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>

          {envVars.length === 0 ? (
            <p className="text-sm text-muted-foreground">No environment variables</p>
          ) : (
            <div className="space-y-2">
              {envVars.map((envVar, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <Input
                    placeholder="KEY"
                    value={envVar.key}
                    onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Input
                    placeholder="value"
                    value={envVar.value}
                    onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeEnvVar(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {config.Layers && config.Layers.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>Layers (read-only)</Label>
              <div className="space-y-1 text-sm">
                {config.Layers.map((layer, idx) => (
                  <div key={idx} className="font-mono text-xs text-muted-foreground">
                    {layer.Arn}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {validationError && (
        <Card className="border-destructive">
          <CardContent className="pt-4 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{validationError}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!!validationError || !hasChanges() || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
