import type { SQSQueue } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TagCountBadge } from '@/components/TagsSection'
import { QueueTypeBadge, QueueDepthBadge } from './QueueBadges'
import { formatNumber, formatDuration } from './utils'
import {
  Inbox,
  AlertTriangle,
  Star,
} from 'lucide-react'

export function QueueCard({
  queue,
  isFavorite,
  onSelect,
  onToggleFavorite,
  showExtendedStats = false,
}: {
  queue: SQSQueue
  isFavorite: boolean
  onSelect: (queueName: string) => void
  onToggleFavorite: (queueName: string) => void
  showExtendedStats?: boolean
}) {
  const totalMessages =
    queue.approximateNumberOfMessages +
    queue.approximateNumberOfMessagesNotVisible +
    queue.approximateNumberOfMessagesDelayed

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors relative group"
      onClick={() => onSelect(queue.name)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite(queue.name)
        }}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className={`h-4 w-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
      </button>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          {queue.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <QueueTypeBadge type={queue.type} />
          <QueueDepthBadge count={totalMessages} />
          {showExtendedStats && <TagCountBadge count={Object.keys(queue.tags || {}).length} />}
          {queue.redrivePolicy && (
            <Badge variant="outline" className="text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              DLQ
            </Badge>
          )}
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Messages</span>
            <span>~{formatNumber(queue.approximateNumberOfMessages)}</span>
          </div>
          {showExtendedStats && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">In-Flight</span>
                <span>~{formatNumber(queue.approximateNumberOfMessagesNotVisible)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Delayed</span>
                <span>~{formatNumber(queue.approximateNumberOfMessagesDelayed)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Retention</span>
            <span>{formatDuration(queue.messageRetentionPeriod)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
