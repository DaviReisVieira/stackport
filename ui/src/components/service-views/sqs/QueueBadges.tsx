import { Badge } from '@/components/ui/badge'
import { formatNumber } from './utils'

export function QueueTypeBadge({ type }: { type: 'Standard' | 'FIFO' }) {
  const color = type === 'FIFO' ? 'bg-purple-500' : 'bg-blue-500'
  return (
    <Badge variant="secondary" className={`${color} text-white`}>
      {type}
    </Badge>
  )
}

export function QueueDepthBadge({ count }: { count: number }) {
  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'secondary'
  let label = 'Empty'

  if (count === 0) {
    variant = 'outline'
    label = 'Empty'
  } else if (count < 10) {
    variant = 'secondary'
    label = 'Low'
  } else if (count < 100) {
    variant = 'default'
    label = 'Medium'
  } else {
    variant = 'destructive'
    label = 'High'
  }

  return (
    <Badge variant={variant}>
      ~{formatNumber(count)} {label}
    </Badge>
  )
}
