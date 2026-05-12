import { useState } from 'react'
import type { StepFunctionsHistoryEvent } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface TimelineEntry {
  stateName: string
  type: string
  status: 'succeeded' | 'failed' | 'in-progress'
  startTime: string
  endTime?: string
  durationMs: number
  input?: unknown
  output?: unknown
  error?: string
  events: StepFunctionsHistoryEvent[]
}

interface ExecutionTimelineProps {
  events: StepFunctionsHistoryEvent[]
  executionStartTime: string
}

export function ExecutionTimeline({ events, executionStartTime }: ExecutionTimelineProps) {
  const entries = groupEventsIntoTimeline(events)
  const totalDurationMs = entries.length > 0
    ? new Date(entries[entries.length - 1].endTime || entries[entries.length - 1].startTime).getTime() -
      new Date(executionStartTime).getTime()
    : 0

  if (entries.length === 0) {
    return <div className="text-sm text-muted-foreground py-4 text-center">No state transitions recorded.</div>
  }

  return (
    <div className="space-y-1">
      {entries.map((entry, idx) => (
        <TimelineRow key={idx} entry={entry} totalDurationMs={totalDurationMs} executionStart={executionStartTime} />
      ))}
    </div>
  )
}

function TimelineRow({ entry, totalDurationMs, executionStart }: { entry: TimelineEntry; totalDurationMs: number; executionStart: string }) {
  const [expanded, setExpanded] = useState(false)
  const offsetMs = new Date(entry.startTime).getTime() - new Date(executionStart).getTime()
  const barWidth = totalDurationMs > 0 ? Math.max(2, (entry.durationMs / totalDurationMs) * 100) : 100
  const barOffset = totalDurationMs > 0 ? (offsetMs / totalDurationMs) * 100 : 0

  const statusColor = entry.status === 'succeeded' ? 'bg-green-500' :
    entry.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'

  return (
    <div className="border rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> :
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}

        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />

        <span className="text-sm font-medium truncate flex-shrink-0 max-w-[140px]">
          {entry.stateName}
        </span>

        <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
          {entry.type}
        </Badge>

        {/* Duration bar */}
        <div className="flex-1 h-3 bg-muted/50 rounded-full relative mx-2 min-w-[80px]">
          <div
            className={`absolute h-full rounded-full ${statusColor}/70`}
            style={{ left: `${barOffset}%`, width: `${barWidth}%` }}
          />
        </div>

        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
          +{formatRelativeTime(offsetMs)}
        </span>

        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums w-16 text-right">
          {formatDurationMs(entry.durationMs)}
        </span>
      </div>

      {expanded && (
        <div className="border-t px-4 py-2 bg-muted/30 space-y-2 text-xs">
          {entry.input !== undefined && (
            <div>
              <span className="text-muted-foreground font-medium">Input: </span>
              <pre className="inline font-mono text-[11px] whitespace-pre-wrap break-all">
                {typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input, null, 2)}
              </pre>
            </div>
          )}
          {entry.output !== undefined && (
            <div>
              <span className="text-muted-foreground font-medium">Output: </span>
              <pre className="inline font-mono text-[11px] whitespace-pre-wrap break-all">
                {typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.output, null, 2)}
              </pre>
            </div>
          )}
          {entry.error && (
            <div className="text-destructive">
              <span className="font-medium">Error: </span>{entry.error}
            </div>
          )}
          <div className="text-muted-foreground/70">
            {entry.events.length} event{entry.events.length !== 1 ? 's' : ''} •
            Started {new Date(entry.startTime).toLocaleTimeString()}
            {entry.endTime && ` • Ended ${new Date(entry.endTime).toLocaleTimeString()}`}
          </div>
        </div>
      )}
    </div>
  )
}

function groupEventsIntoTimeline(events: StepFunctionsHistoryEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const stateMap = new Map<string, { entered: StepFunctionsHistoryEvent; events: StepFunctionsHistoryEvent[] }>()

  for (const event of events) {
    const type = event.type as string

    if (type.endsWith('StateEntered')) {
      const details = event.stateEnteredEventDetails as { name?: string; input?: string } | undefined
      const name = details?.name || 'Unknown'
      stateMap.set(name, { entered: event, events: [event] })
    } else if (type.endsWith('StateExited')) {
      const details = event.stateExitedEventDetails as { name?: string; output?: string } | undefined
      const name = details?.name || 'Unknown'
      const state = stateMap.get(name)
      if (state) {
        state.events.push(event)
        const enteredDetails = state.entered.stateEnteredEventDetails as { input?: string } | undefined
        const startTime = state.entered.timestamp
        const endTime = event.timestamp
        const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime()
        const stateType = type.replace('StateExited', '').replace(/([A-Z])/g, ' $1').trim()

        let input: unknown = undefined
        try { input = enteredDetails?.input ? JSON.parse(enteredDetails.input) : undefined } catch { input = enteredDetails?.input }

        let output: unknown = undefined
        try { output = details?.output ? JSON.parse(details.output) : undefined } catch { output = details?.output }

        entries.push({
          stateName: name,
          type: stateType,
          status: 'succeeded',
          startTime,
          endTime,
          durationMs,
          input,
          output,
          events: state.events,
        })
        stateMap.delete(name)
      }
    } else {
      // Attach intermediate events (TaskScheduled, etc.) to the current state
      for (const [, state] of stateMap) {
        state.events.push(event)
      }

      // Handle failures
      if (type.includes('Failed') || type.includes('TimedOut')) {
        for (const [name, state] of stateMap) {
          const startTime = state.entered.timestamp
          const durationMs = new Date(event.timestamp).getTime() - new Date(startTime).getTime()
          const enteredDetails = state.entered.stateEnteredEventDetails as { input?: string } | undefined
          let input: unknown = undefined
          try { input = enteredDetails?.input ? JSON.parse(enteredDetails.input) : undefined } catch { input = enteredDetails?.input }

          const errorDetails = event as Record<string, unknown>
          const error = (errorDetails.executionFailedEventDetails as { error?: string })?.error ||
            (errorDetails.taskFailedEventDetails as { error?: string })?.error || type

          entries.push({
            stateName: name,
            type: type.replace(/([A-Z])/g, ' $1').trim(),
            status: 'failed',
            startTime,
            endTime: event.timestamp,
            durationMs,
            input,
            error,
            events: state.events,
          })
          stateMap.delete(name)
        }
      }
    }
  }

  // Any remaining states are in-progress
  for (const [name, state] of stateMap) {
    const startTime = state.entered.timestamp
    const durationMs = Date.now() - new Date(startTime).getTime()
    entries.push({
      stateName: name,
      type: 'In Progress',
      status: 'in-progress',
      startTime,
      durationMs,
      events: state.events,
    })
  }

  return entries
}

function formatRelativeTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatDurationMs(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(1)}m`
}
