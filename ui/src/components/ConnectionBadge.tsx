import { Cloud, Monitor } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ConnectionBadgeProps {
  connectionType: 'local' | 'aws'
  region: string
  endpointUrl: string | null
  compact?: boolean
}

function extractHost(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host
  } catch {
    return url
  }
}

export function ConnectionBadge({ connectionType, region, endpointUrl, compact }: ConnectionBadgeProps) {
  const isLocal = connectionType === 'local'
  const Icon = isLocal ? Monitor : Cloud
  const label = isLocal
    ? `Local (${endpointUrl ? extractHost(endpointUrl) : 'emulator'})`
    : `AWS (${region})`
  const colorClass = isLocal
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center justify-center h-8 w-8 rounded-md border ${colorClass}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Badge variant="outline" className={`gap-1.5 text-[11px] font-normal ${colorClass}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  )
}
