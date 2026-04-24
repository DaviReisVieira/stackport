import { Lock, LockOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ReadOnlyBadgeProps {
  writesEnabled: boolean
  compact?: boolean
}

export function ReadOnlyBadge({ writesEnabled, compact }: ReadOnlyBadgeProps) {
  const Icon = writesEnabled ? LockOpen : Lock
  const label = writesEnabled ? 'Writes enabled' : 'Read-only'
  const colorClass = writesEnabled
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : 'bg-muted text-muted-foreground border-border'

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
