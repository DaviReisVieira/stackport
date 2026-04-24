import { Cloud, Monitor, Server } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEndpoint } from '@/hooks/useEndpoint'

interface EndpointSelectorProps {
  compact?: boolean
}

function HealthDot({ health }: { health: string }) {
  const color =
    health === 'healthy'
      ? 'bg-emerald-400'
      : health === 'unhealthy'
        ? 'bg-red-400'
        : 'bg-yellow-400'
  return <span className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} />
}

export function EndpointSelector({ compact }: EndpointSelectorProps) {
  const { activeEndpoint, endpoints, setActiveEndpoint } = useEndpoint()

  if (endpoints.length <= 1) {
    return null
  }

  const active = endpoints.find((e) => e.name === activeEndpoint)
  const Icon = active?.connection_type === 'aws' ? Cloud : Monitor

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            onClick={() => {
              const idx = endpoints.findIndex((e) => e.name === activeEndpoint)
              const next = endpoints[(idx + 1) % endpoints.length]
              setActiveEndpoint(next.name)
            }}
          >
            <Server className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Endpoint: {activeEndpoint}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Select value={activeEndpoint ?? undefined} onValueChange={setActiveEndpoint}>
      <SelectTrigger className="h-8 text-[11px] bg-background/50">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 flex-shrink-0" />
          <SelectValue placeholder="Select endpoint" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {endpoints.map((ep) => (
          <SelectItem key={ep.name} value={ep.name}>
            <div className="flex items-center gap-2">
              <HealthDot health={ep.health} />
              <span>{ep.name}</span>
              <span className="text-muted-foreground text-[10px] ml-1">
                {ep.connection_type === 'aws' ? 'AWS' : ep.url ?? 'local'}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
