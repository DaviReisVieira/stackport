import type { SQSQueue } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { TagCountBadge } from '@/components/TagsSection'
import { QueueTypeBadge } from './QueueBadges'
import { formatNumber, formatDuration } from './utils'
import {
  Inbox,
  AlertTriangle,
  Star,
  ChevronRight,
} from 'lucide-react'

export function QueueCard({
  queue,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: {
  queue: SQSQueue
  isFavorite: boolean
  onSelect: (queueName: string) => void
  onToggleFavorite: (queueName: string) => void
}) {
  const totalMessages =
    queue.approximateNumberOfMessages +
    queue.approximateNumberOfMessagesNotVisible +
    queue.approximateNumberOfMessagesDelayed

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelect(queue.name)}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite(queue.name)
              }}
              className="flex-shrink-0 p-0.5 rounded hover:bg-accent transition-colors"
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={`h-4 w-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
            </button>
            <Inbox className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{queue.name}</div>
              <div className="flex items-center gap-2 mt-1">
                <QueueTypeBadge type={queue.type} />
                {queue.redrivePolicy && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3 w-3" />
                    DLQ
                  </span>
                )}
                <TagCountBadge count={Object.keys(queue.tags || {}).length} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-6">
              <div className="text-right">
                <div className="text-sm font-medium">{formatNumber(totalMessages)}</div>
                <div className="text-xs text-muted-foreground">messages</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{formatNumber(queue.approximateNumberOfMessagesNotVisible)}</div>
                <div className="text-xs text-muted-foreground">in-flight</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{formatDuration(queue.messageRetentionPeriod)}</div>
                <div className="text-xs text-muted-foreground">retention</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
