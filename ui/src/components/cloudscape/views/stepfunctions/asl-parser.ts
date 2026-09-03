export type AslStateType = 'Pass' | 'Task' | 'Choice' | 'Wait' | 'Succeed' | 'Fail' | 'Parallel' | 'Map' | 'Join'

export interface AslNode {
  id: string
  label: string
  stateName: string
  type: AslStateType
  isTerminal: boolean
  metadata?: Record<string, unknown>
}

export interface AslEdge {
  source: string
  target: string
  label?: string
  type: 'next' | 'choice' | 'catch' | 'default'
}

export interface ParallelGroup {
  parentId: string
  joinId: string
  type: 'Parallel' | 'Map'
  label: string
  childNodeIds: string[]
}

export interface AslGraph {
  nodes: AslNode[]
  edges: AslEdge[]
  startAt: string
  groups: ParallelGroup[]
}

export function parseAslDefinition(definition: Record<string, unknown> | string): AslGraph {
  const def = typeof definition === 'string' ? JSON.parse(definition) : definition
  const startAt = (def.StartAt as string) || ''
  const states = (def.States as Record<string, Record<string, unknown>>) || {}
  const nodes: AslNode[] = []
  const edges: AslEdge[] = []
  const groups: ParallelGroup[] = []

  parseStates(states, startAt, '', nodes, edges, groups)

  return { nodes, edges, startAt: prefixId('', startAt), groups }
}

function parseStates(
  states: Record<string, Record<string, unknown>>,
  startAt: string,
  pathPrefix: string,
  nodes: AslNode[],
  edges: AslEdge[],
  groups: ParallelGroup[]
): { entryId: string; terminalIds: string[] } {
  const terminalIds: string[] = []
  const entryId = prefixId(pathPrefix, startAt)

  for (const [name, state] of Object.entries(states)) {
    const id = prefixId(pathPrefix, name)
    const type = (state.Type as AslStateType) || 'Pass'

    if (type === 'Parallel' || type === 'Map') {
      nodes.push({ id, label: name, stateName: name, type, isTerminal: false, metadata: state })
      handleBranchState(id, name, state, type, pathPrefix, nodes, edges, terminalIds, groups)
    } else {
      const isTerminal = type === 'Succeed' || type === 'Fail' || state.End === true
      nodes.push({ id, label: name, stateName: name, type, isTerminal, metadata: state })

      if (isTerminal) terminalIds.push(id)

      if (state.Next && typeof state.Next === 'string') {
        edges.push({ source: id, target: prefixId(pathPrefix, state.Next as string), type: 'next' })
      }

      if (type === 'Choice' && Array.isArray(state.Choices)) {
        for (const choice of state.Choices as Record<string, unknown>[]) {
          if (choice.Next && typeof choice.Next === 'string') {
            const label = extractChoiceLabel(choice)
            edges.push({ source: id, target: prefixId(pathPrefix, choice.Next as string), label, type: 'choice' })
          }
        }
        if (state.Default && typeof state.Default === 'string') {
          edges.push({ source: id, target: prefixId(pathPrefix, state.Default as string), label: 'Default', type: 'default' })
        }
      }

      if (Array.isArray(state.Catch)) {
        for (const catcher of state.Catch as Record<string, unknown>[]) {
          if (catcher.Next && typeof catcher.Next === 'string') {
            const errorTypes = Array.isArray(catcher.ErrorEquals)
              ? (catcher.ErrorEquals as string[]).join(', ')
              : 'Error'
            edges.push({ source: id, target: prefixId(pathPrefix, catcher.Next as string), label: errorTypes, type: 'catch' })
          }
        }
      }
    }
  }

  return { entryId, terminalIds }
}

function handleBranchState(
  id: string,
  name: string,
  state: Record<string, unknown>,
  type: 'Parallel' | 'Map',
  parentPrefix: string,
  nodes: AslNode[],
  edges: AslEdge[],
  parentTerminalIds: string[],
  groups: ParallelGroup[]
) {
  const branches: Record<string, unknown>[] = []

  if (type === 'Parallel' && Array.isArray(state.Branches)) {
    branches.push(...(state.Branches as Record<string, unknown>[]))
  } else if (type === 'Map') {
    const iterator = (state.Iterator || state.ItemProcessor) as Record<string, unknown> | undefined
    if (iterator) branches.push(iterator)
  }

  if (branches.length === 0) {
    // No branches to expand — treat as terminal or wire Next
    if (state.End === true) parentTerminalIds.push(id)
    if (state.Next && typeof state.Next === 'string') {
      edges.push({ source: id, target: prefixId(parentPrefix, state.Next as string), type: 'next' })
    }
    return
  }

  const joinId = `${id}/__join`
  const childStartIndex = nodes.length
  nodes.push({ id: joinId, label: '∎', stateName: `${name}/__join`, type: 'Join', isTerminal: false })

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i]
    const branchStartAt = (branch.StartAt as string) || ''
    const branchStates = (branch.States as Record<string, Record<string, unknown>>) || {}
    const branchPrefix = `${id}/branch[${i}]/`

    const result = parseStates(branchStates, branchStartAt, branchPrefix, nodes, edges, groups)
    edges.push({ source: id, target: result.entryId, type: 'next' })
    for (const tid of result.terminalIds) {
      edges.push({ source: tid, target: joinId, type: 'next' })
    }
  }

  const childNodeIds = nodes.slice(childStartIndex).map(n => n.id)
  groups.push({ parentId: id, joinId, type, label: name, childNodeIds })

  // Wire join node outward
  if (state.Next && typeof state.Next === 'string') {
    edges.push({ source: joinId, target: prefixId(parentPrefix, state.Next as string), type: 'next' })
  } else if (state.End === true) {
    parentTerminalIds.push(joinId)
  }

  // Catch on the Parallel/Map state itself — edge from join node
  if (Array.isArray(state.Catch)) {
    for (const catcher of state.Catch as Record<string, unknown>[]) {
      if (catcher.Next && typeof catcher.Next === 'string') {
        const errorTypes = Array.isArray(catcher.ErrorEquals)
          ? (catcher.ErrorEquals as string[]).join(', ')
          : 'Error'
        edges.push({ source: joinId, target: prefixId(parentPrefix, catcher.Next as string), label: errorTypes, type: 'catch' })
      }
    }
  }
}

function prefixId(prefix: string, name: string): string {
  return prefix ? `${prefix}${name}` : name
}

function extractChoiceLabel(choice: Record<string, unknown>): string {
  const variable = choice.Variable as string | undefined
  const varShort = variable ? variable.replace('$.', '') : ''

  const comparisons = [
    'StringEquals', 'StringEqualsPath', 'StringLessThan', 'StringGreaterThan',
    'StringMatches', 'NumericEquals', 'NumericLessThan', 'NumericGreaterThan',
    'NumericLessThanEquals', 'NumericGreaterThanEquals', 'BooleanEquals',
    'TimestampEquals', 'TimestampLessThan', 'TimestampGreaterThan',
    'IsPresent', 'IsNull', 'IsString', 'IsNumeric', 'IsBoolean', 'IsTimestamp',
  ]

  for (const op of comparisons) {
    if (op in choice) {
      const val = choice[op]
      const shortOp = op.replace('StringEquals', '==').replace('NumericEquals', '==')
        .replace('NumericLessThan', '<').replace('NumericGreaterThan', '>')
        .replace('BooleanEquals', '==')
      if (shortOp !== op) return `${varShort} ${shortOp} ${val}`
      return `${varShort} ${op}`
    }
  }

  return varShort || '?'
}
