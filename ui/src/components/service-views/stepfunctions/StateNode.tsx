import type { AslNode, AslStateType } from './asl-parser'
import type { StateStatus } from './execution-trace'
import { Clock, GitBranch, Repeat, CheckCircle2, XCircle } from 'lucide-react'

const NODE_WIDTH = 160
const NODE_HEIGHT = 48

export { NODE_WIDTH, NODE_HEIGHT }

const TYPE_STYLES: Record<AslStateType, { bg: string; border: string; text: string }> = {
  Task: { bg: 'fill-blue-500/10', border: 'stroke-blue-500', text: 'text-blue-400' },
  Pass: { bg: 'fill-muted/50', border: 'stroke-muted-foreground/50', text: 'text-muted-foreground' },
  Choice: { bg: 'fill-amber-500/10', border: 'stroke-amber-500', text: 'text-amber-400' },
  Wait: { bg: 'fill-secondary/50', border: 'stroke-secondary-foreground/50', text: 'text-secondary-foreground' },
  Parallel: { bg: 'fill-purple-500/10', border: 'stroke-purple-500', text: 'text-purple-400' },
  Map: { bg: 'fill-indigo-500/10', border: 'stroke-indigo-500', text: 'text-indigo-400' },
  Succeed: { bg: 'fill-green-500/10', border: 'stroke-green-500', text: 'text-green-400' },
  Fail: { bg: 'fill-red-500/10', border: 'stroke-red-500', text: 'text-red-400' },
}

const TYPE_ICONS: Partial<Record<AslStateType, React.ComponentType<{ className?: string }>>> = {
  Choice: GitBranch,
  Wait: Clock,
  Map: Repeat,
  Succeed: CheckCircle2,
  Fail: XCircle,
}

function getTraceStyle(status?: StateStatus) {
  switch (status) {
    case 'succeeded': return 'stroke-green-500 stroke-[3]'
    case 'failed': return 'stroke-red-500 stroke-[3]'
    case 'in-progress': return 'stroke-blue-500 stroke-[3] animate-pulse'
    default: return ''
  }
}

interface StateNodeProps {
  node: AslNode
  x: number
  y: number
  traceStatus?: StateStatus
  isStart?: boolean
}

export function StateNode({ node, x, y, traceStatus, isStart }: StateNodeProps) {
  const style = TYPE_STYLES[node.type]
  const Icon = TYPE_ICONS[node.type]
  const traceStroke = getTraceStyle(traceStatus)
  const dimmed = traceStatus === undefined && traceStroke === '' ? '' : (!traceStatus ? 'opacity-40' : '')

  const rx = node.type === 'Succeed' || node.type === 'Fail' ? NODE_HEIGHT / 2 : 8

  return (
    <g transform={`translate(${x - NODE_WIDTH / 2}, ${y - NODE_HEIGHT / 2})`} className={dimmed}>
      {isStart && (
        <circle
          cx={-12}
          cy={NODE_HEIGHT / 2}
          r={5}
          className="fill-green-500"
        />
      )}
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={rx}
        className={`${style.bg} ${traceStroke || style.border} stroke-[1.5]`}
        strokeDasharray={node.type === 'Pass' ? '4 2' : undefined}
      />
      <foreignObject width={NODE_WIDTH} height={NODE_HEIGHT}>
        <div className="flex items-center justify-center gap-1.5 h-full px-2">
          {Icon && <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${style.text}`} />}
          <span className={`text-xs font-medium truncate ${style.text}`}>
            {node.id}
          </span>
        </div>
      </foreignObject>
      <text
        x={NODE_WIDTH / 2}
        y={NODE_HEIGHT + 14}
        textAnchor="middle"
        fontSize={10}
        className="fill-zinc-400 opacity-60"
      >
        {node.type}
      </text>
    </g>
  )
}
