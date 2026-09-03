import type { AslEdge } from './asl-parser'

interface Point {
  x: number
  y: number
}

interface EdgePathProps {
  edge: AslEdge
  points: Point[]
  highlighted?: boolean
}

interface StrokeStyle {
  stroke: string
  strokeWidth: number
  opacity: number
}

export function EdgePath({ edge, points, highlighted }: EdgePathProps) {
  if (points.length < 2) return null

  const pathData = buildSmoothPath(points)
  const lastTwo = points.slice(-2)
  const arrowAngle = Math.atan2(
    lastTwo[1].y - lastTwo[0].y,
    lastTwo[1].x - lastTwo[0].x
  )

  const style = getStrokeStyle(edge.type, highlighted)
  const dashArray = edge.type === 'catch' ? '4 3' : edge.type === 'default' ? '2 2' : undefined

  const midIdx = Math.floor(points.length / 2)
  const labelPos = points[midIdx]

  return (
    <g>
      <path
        d={pathData}
        fill="none"
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        opacity={style.opacity}
        strokeDasharray={dashArray}
      />
      <polygon
        points={arrowPoints(lastTwo[1], arrowAngle)}
        fill={style.stroke}
        opacity={style.opacity}
      />
      {edge.label && labelPos && (
        <g>
          <rect
            x={labelPos.x - (edge.label.length * 3 + 12)}
            y={labelPos.y - 18}
            width={edge.label.length * 6 + 24}
            height={18}
            rx={4}
            fill="#18181b"
            fillOpacity={0.92}
            stroke={edge.type === 'catch' ? '#f8717140' : edge.type === 'choice' ? '#fbbf2440' : '#3f3f46'}
            strokeWidth={0.75}
          />
          <text
            x={labelPos.x}
            y={labelPos.y - 6}
            textAnchor="middle"
            fontSize={11}
            fontFamily="monospace"
            fill={edge.type === 'catch' ? '#f87171' : edge.type === 'choice' ? '#fbbf24' : '#a1a1aa'}
          >
            {edge.label}
          </text>
        </g>
      )}
    </g>
  )
}

function getStrokeStyle(type: AslEdge['type'], highlighted?: boolean): StrokeStyle {
  if (highlighted) return { stroke: '#22c55e', strokeWidth: 2.5, opacity: 1 }
  switch (type) {
    case 'catch': return { stroke: '#f87171', strokeWidth: 1.5, opacity: 0.8 }
    case 'choice': return { stroke: '#fbbf24', strokeWidth: 1.5, opacity: 0.8 }
    case 'default': return { stroke: '#a1a1aa', strokeWidth: 1.5, opacity: 0.6 }
    default: return { stroke: '#a1a1aa', strokeWidth: 1.5, opacity: 0.7 }
  }
}

function buildSmoothPath(points: Point[]): string {
  if (points.length < 2) return ''

  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`
  }
  return d
}

function arrowPoints(tip: Point, angle: number): string {
  const size = 6
  const p1x = tip.x - size * Math.cos(angle - Math.PI / 6)
  const p1y = tip.y - size * Math.sin(angle - Math.PI / 6)
  const p2x = tip.x - size * Math.cos(angle + Math.PI / 6)
  const p2y = tip.y - size * Math.sin(angle + Math.PI / 6)
  return `${tip.x},${tip.y} ${p1x},${p1y} ${p2x},${p2y}`
}
