import { useMemo, useRef, useState, useCallback } from 'react'
import dagre from '@dagrejs/dagre'
import { parseAslDefinition, type AslGraph, type AslNode, type ParallelGroup } from './asl-parser'
import { type ExecutionTrace } from './execution-trace'
import { StateNode, NODE_WIDTH, NODE_HEIGHT, JOIN_WIDTH, JOIN_HEIGHT } from './StateNode'
import { EdgePath } from './EdgePath'

interface StateMachineGraphProps {
  definition: Record<string, unknown> | string
  trace?: ExecutionTrace
  onNodeClick?: (stateName: string) => void
}

interface GroupBox {
  group: ParallelGroup
  x: number
  y: number
  width: number
  height: number
}

interface LayoutResult {
  graph: AslGraph
  nodePositions: Map<string, { x: number; y: number }>
  edgePoints: Map<string, { x: number; y: number }[]>
  groupBoxes: GroupBox[]
  width: number
  height: number
}

function computeLayout(graph: AslGraph): LayoutResult {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 90, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of graph.nodes) {
    if (node.type === 'Join') {
      g.setNode(node.id, { width: JOIN_WIDTH, height: JOIN_HEIGHT + 10 })
    } else {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT + 20 })
    }
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

  const groupBoxes = computeGroupBoxes(graph.groups, graph.nodes, nodePositions)

  return { graph, nodePositions, edgePoints, groupBoxes, width, height }
}

const GROUP_PADDING = 24

function computeGroupBoxes(
  groups: ParallelGroup[],
  nodes: AslNode[],
  nodePositions: Map<string, { x: number; y: number }>
): GroupBox[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const sorted = [...groups].sort((a, b) => b.childNodeIds.length - a.childNodeIds.length)

  return sorted.map((group) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const nodeId of group.childNodeIds) {
      const pos = nodePositions.get(nodeId)
      if (!pos) continue
      const node = nodeMap.get(nodeId)
      const halfW = (node?.type === 'Join' ? JOIN_WIDTH : NODE_WIDTH) / 2
      const halfH = (node?.type === 'Join' ? JOIN_HEIGHT : NODE_HEIGHT) / 2

      minX = Math.min(minX, pos.x - halfW)
      maxX = Math.max(maxX, pos.x + halfW)
      minY = Math.min(minY, pos.y - halfH)
      maxY = Math.max(maxY, pos.y + halfH)
    }

    return {
      group,
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING,
      width: (maxX - minX) + GROUP_PADDING * 2,
      height: (maxY - minY) + GROUP_PADDING * 2,
    }
  })
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
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const factor = e.deltaY > 0 ? 0.9 : 1.1

    setZoom((prevZoom) => {
      const newZoom = Math.max(0.3, Math.min(3, prevZoom * factor))
      const scale = newZoom / prevZoom
      setPan((prevPan) => ({
        x: mouseX - (mouseX - prevPan.x) * scale,
        y: mouseY - (mouseY - prevPan.y) * scale,
      }))
      return newZoom
    })
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
          {/* Group bounding boxes */}
          {layout.groupBoxes.map((box) => {
            const isMap = box.group.type === 'Map'
            return (
              <g key={`group-${box.group.parentId}`}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx={12}
                  fill={isMap ? 'rgba(99, 102, 241, 0.05)' : 'rgba(168, 85, 247, 0.05)'}
                  stroke={isMap ? '#6366f1' : '#a855f7'}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  opacity={0.7}
                />
                <text
                  x={box.x + 10}
                  y={box.y + 14}
                  fontSize={10}
                  fontWeight={500}
                  fill={isMap ? '#6366f1' : '#a855f7'}
                  opacity={0.85}
                >
                  {box.group.label}
                </text>
              </g>
            )
          })}

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
              <g key={node.id} onClick={() => onNodeClick?.(node.stateName)} className={onNodeClick ? 'cursor-pointer' : ''}>
                <StateNode
                  node={node}
                  x={pos.x}
                  y={pos.y}
                  isStart={node.id === layout.graph.startAt}
                  traceStatus={hasTrace ? trace.visitedStates.get(node.stateName) : undefined}
                />
              </g>
            )
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
        <span className="inline-flex items-center rounded border px-1.5 py-0 text-[10px] bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-blue-500 mr-1" />Task
        </span>
        <span className="inline-flex items-center rounded border px-1.5 py-0 text-[10px] bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-amber-500 mr-1" />Choice
        </span>
        <span className="inline-flex items-center rounded border px-1.5 py-0 text-[10px] bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-green-500 mr-1" />Succeed
        </span>
        <span className="inline-flex items-center rounded border px-1.5 py-0 text-[10px] bg-background/80">
          <div className="w-2 h-2 rounded-sm bg-red-500 mr-1" />Fail
        </span>
        <span className="inline-flex items-center rounded border px-1.5 py-0 text-[10px] bg-background/80">
          <div className="w-2 h-2 rounded-sm border border-dashed border-purple-500 mr-1" />Parallel
        </span>
        <span className="inline-flex items-center rounded border px-1.5 py-0 text-[10px] bg-background/80">
          <div className="w-2 h-2 rounded-sm border border-dashed border-indigo-500 mr-1" />Map
        </span>
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
