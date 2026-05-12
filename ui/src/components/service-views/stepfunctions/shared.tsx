/* eslint-disable react-refresh/only-export-components */
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function calculateDuration(startDate: string, stopDate?: string): string {
  const start = new Date(startDate).getTime()
  const end = stopDate ? new Date(stopDate).getTime() : Date.now()
  const ms = end - start
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds < 1 ? '<1' : seconds}s`
}

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'RUNNING':
      return (
        <Badge variant="secondary" className="bg-blue-500 text-white">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />Running
        </Badge>
      )
    case 'SUCCEEDED':
      return (
        <Badge variant="secondary" className="bg-green-500 text-white">
          <CheckCircle2 className="h-3 w-3 mr-1" />Succeeded
        </Badge>
      )
    case 'FAILED':
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />Failed
        </Badge>
      )
    case 'TIMED_OUT':
      return (
        <Badge variant="secondary" className="bg-yellow-500 text-white">
          <Clock className="h-3 w-3 mr-1" />Timed Out
        </Badge>
      )
    case 'ABORTED':
      return (
        <Badge variant="outline">
          <AlertCircle className="h-3 w-3 mr-1" />Aborted
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={type === 'EXPRESS' ? 'secondary' : 'outline'} className={type === 'EXPRESS' ? 'bg-purple-500 text-white' : ''}>
      {type}
    </Badge>
  )
}

export function PaginationBar({
  page, totalPages, totalItems, pageSize, onPageChange, onPageSizeChange,
}: {
  page: number; totalPages: number; totalItems: number; pageSize: number
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void
}) {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, totalItems)
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{start}–{end} of {totalItems}</span>
        <Separator orientation="vertical" className="h-4" />
        <span>Rows:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
