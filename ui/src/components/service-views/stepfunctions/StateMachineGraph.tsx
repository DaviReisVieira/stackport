import { useMemo, useRef, useState, useCallback } from 'react'
import dagre from '@dagrejs/dagre'
import { parseAslDefinition, type AslGraph } from './asl-parser'
import { type ExecutionTrace } from './execution-trace'
import { StateNode, NODE_WIDTH, NODE_HEIGHT } from './StateNode'
import { EdgePath } from './EdgePath'
import { Badge } from '@/components/ui/badge'

interface StateMachineGraphProps {
  definition: Record<string, unknown> | string
  trace?: ExecutionTrace
  onNodeClick?: (stateName: string) => void
}

interface LayoutResult {
  graph: AslGraph
  nodePositions: Map<string, { x: number; y: number }>
  edgePoints: Map<string, { x: number; y: number }[]>
  width: number
  height: number
}

function computeLayout(graph: AslGraph): LayoutResult {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 90, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT + 20 })
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const nodePositions = new Map<string, { x: number; y: number }>()
  for (const node of graph.nodes) {
    const pos = g.node(node.id)
    if (pos) nodePositions.set(node.id, { x: pos.x, y: pos.y })
  }

  const edgePoints = new Map<string, { x: number; y: number }[]>()
  for (const edge of graph.edges) {
    const key = `${edge.source}->${edge.target}`
    const dagreEdge = g.edge(edge.source, edge.target)
    if (dagreEdge?.points) {
      edgePoints.set(key, dagreEdge.points)
    }
  }

  const graphInfo = g.graph()
  const width = (graphInfo?.width || 400) + 80
  const height = (graphInfo?.height || 300) + 80

  return { graph, nodePositions, edgePoints, width, height }
}

export default function StateMachineGraph({ definition, trace, onNodeClick }: StateMachineGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const layout = useMemo(() => {
    const graph = parseAslDefinition(definition)
    return computeLayout(graph)
  }, [definition])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
    }
  }, [dragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  const visitedEdges = useMemo(() => {
    if (!trace) return new Set<string>()
    const set = new Set<string>()
    const visited = Array.from(trace.visitedStates.keys())
    for (let i = 0; i < visited.length - 1; i++) {
      set.add(`${visited[i]}->${visited[i + 1]}`)
    }
    return set
  }, [trace])

  const hasTrace = trace && trace.visitedStates.size > 0

  return (
    <div className="relative w-full h-full min-h-[400px] border rounded-md bg-background/50 overflow-hidden select-none">
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {layout.graph.edges.map((edge) => {
            const key = `${edge.source}->${edge.target}`
            const points = layout.edgePoints.get(key)
            if (!points) return null
            return (
              <EdgePath
                key={key}
                edge={edge}
                points={points}
                highlighted={hasTrace ? visitedEdges.has(key) : undefined}
              />
            )
          })}

          {/* Nodes */}
          {layout.graph.nodes.map((node) => {
            const pos = layout.nodePositions.get(node.id)
            if (!pos) return null
            return (
              <g key={node.id} onClick={() => onNodeClick?.(node.id)} className={onNodeClick ? 'cursor-pointer' : ''}>
                <StateNode
                  node={node}
                  x={pos.x}
                  y={pos.y}
                  isStart={node.id === layout.graph.startAt}
                  traceStatus={hasTrace ? trace.visitedStates.get(node.id) : undefined}
                />
              </g>
            )
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-blue-500 mr-1" />Task
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-amber-500 mr-1" />Choice
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-green-500 mr-1" />Succeed
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-red-500 mr-1" />Fail
        </Badge>
      </div>

      {/* Zoom controls */}
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          className="w-6 h-6 rounded border bg-background/80 text-xs flex items-center justify-center hover:bg-accent"
          onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
        >+</button>
        <button
          className="w-6 h-6 rounded border bg-background/80 text-xs flex items-center justify-center hover:bg-accent"
          onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}
        >−</button>
        <button
          className="w-6 h-6 rounded border bg-background/80 text-xs flex items-center justify-center hover:bg-accent"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
        >⟲</button>
      </div>
    </div>
  )
}
