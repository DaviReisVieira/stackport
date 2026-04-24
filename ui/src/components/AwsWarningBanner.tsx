import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const DISMISS_KEY = 'stackport:aws-warning-dismissed'

interface AwsWarningBannerProps {
  connectionType: 'local' | 'aws'
  region: string
  writesEnabled: boolean
}

export function AwsWarningBanner({ connectionType, region, writesEnabled }: AwsWarningBannerProps) {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1')

  if (connectionType !== 'aws' || dismissed) return null

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-200 text-sm">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400" />
      <span className="flex-1">
        Connected to <strong>real AWS ({region})</strong>. API calls may incur costs.
        {writesEnabled && <> <strong>Writes are enabled</strong> — use caution.</>}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-amber-400 hover:text-amber-200 hover:bg-amber-500/20"
        onClick={dismiss}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
