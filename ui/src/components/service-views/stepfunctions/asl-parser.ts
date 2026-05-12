export type AslStateType = 'Pass' | 'Task' | 'Choice' | 'Wait' | 'Succeed' | 'Fail' | 'Parallel' | 'Map'

export interface AslNode {
  id: string
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

export interface AslGraph {
  nodes: AslNode[]
  edges: AslEdge[]
  startAt: string
}

export function parseAslDefinition(definition: Record<string, unknown> | string): AslGraph {
  const def = typeof definition === 'string' ? JSON.parse(definition) : definition
  const startAt = (def.StartAt as string) || ''
  const states = (def.States as Record<string, Record<string, unknown>>) || {}
  const nodes: AslNode[] = []
  const edges: AslEdge[] = []

  for (const [name, state] of Object.entries(states)) {
    const type = (state.Type as AslStateType) || 'Pass'
    const isTerminal = type === 'Succeed' || type === 'Fail' || state.End === true

    nodes.push({ id: name, type, isTerminal, metadata: state })

    if (state.Next && typeof state.Next === 'string') {
      edges.push({ source: name, target: state.Next, type: 'next' })
    }

    if (type === 'Choice' && Array.isArray(state.Choices)) {
      for (const choice of state.Choices as Record<string, unknown>[]) {
        if (choice.Next && typeof choice.Next === 'string') {
          const label = extractChoiceLabel(choice)
          edges.push({ source: name, target: choice.Next, label, type: 'choice' })
        }
      }
      if (state.Default && typeof state.Default === 'string') {
        edges.push({ source: name, target: state.Default, label: 'Default', type: 'default' })
      }
    }

    if (Array.isArray(state.Catch)) {
      for (const catcher of state.Catch as Record<string, unknown>[]) {
        if (catcher.Next && typeof catcher.Next === 'string') {
          const errorTypes = Array.isArray(catcher.ErrorEquals)
            ? (catcher.ErrorEquals as string[]).join(', ')
            : 'Error'
          edges.push({ source: name, target: catcher.Next, label: errorTypes, type: 'catch' })
        }
      }
    }
  }

  return { nodes, edges, startAt }
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
