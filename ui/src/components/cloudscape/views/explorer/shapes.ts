import type { ExplorerShape, ExplorerShapeGraph, JsonObject, JsonValue } from '@/lib/types'

/** How bytes that aren't text travel as JSON, both ways (the backend decodes it for blob parameters). */
export const BASE64_KEY = '$base64'

export type StructureShape = Extract<ExplorerShape, { type: 'structure' }>

/** The form control a parameter gets. Anything without one is edited as JSON. */
export type FieldKind =
  | 'enum'
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'blob'
  | 'enumList'
  | 'scalarList'
  | 'stringMap'
  | 'json'

// Strings this long (policies, templates, state machine definitions) get a text area
const LONG_STRING = 2048

const NUMBER_TYPES: ReadonlySet<ExplorerShape['type']> = new Set(['integer', 'long', 'float', 'double'])

export function shapeOf(graph: ExplorerShapeGraph, name: string): ExplorerShape {
  return graph.shapes[name]
}

export function rootStructure(graph: ExplorerShapeGraph | null): StructureShape | null {
  if (!graph) return null
  const root = shapeOf(graph, graph.root)
  return root.type === 'structure' ? root : null
}

export function isNumberShape(shape: ExplorerShape): boolean {
  return NUMBER_TYPES.has(shape.type)
}

export function fieldKind(shape: ExplorerShape, graph: ExplorerShapeGraph): FieldKind {
  switch (shape.type) {
    case 'string':
      if (shape.enum) return 'enum'
      return shape.max !== undefined && shape.max >= LONG_STRING ? 'text' : 'string'
    case 'boolean':
    case 'timestamp':
    case 'blob':
      return shape.type
    case 'list': {
      const member = shapeOf(graph, shape.member)
      if (member.type === 'string') return member.enum ? 'enumList' : 'scalarList'
      return isNumberShape(member) ? 'scalarList' : 'json'
    }
    case 'map': {
      const key = shapeOf(graph, shape.key)
      const value = shapeOf(graph, shape.value)
      return key.type === 'string' && value.type === 'string' ? 'stringMap' : 'json'
    }
    default:
      return isNumberShape(shape) ? 'number' : 'json'
  }
}

/** Unset as far as a request is concerned: absent, an empty string, list or object. */
export function isEmptyValue(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}

/** Required top-level parameters with no value. Nested ones are left to botocore's validation. */
export function missingRequired(graph: ExplorerShapeGraph | null, params: JsonObject): string[] {
  return (rootStructure(graph)?.required ?? []).filter((name) => isEmptyValue(params[name]))
}

const EXAMPLE_DEPTH = 4

/**
 * A value of the right shape to start editing from, like the AWS CLI's
 * --generate-cli-skeleton: every member, with an empty or first-choice value.
 * Recursive shapes stop at their first repeat.
 */
export function exampleValue(graph: ExplorerShapeGraph, name: string, seen: readonly string[] = []): JsonValue {
  const shape = shapeOf(graph, name)
  switch (shape.type) {
    case 'structure':
      if (seen.includes(name) || seen.length >= EXAMPLE_DEPTH) return {}
      return Object.fromEntries(shape.members.map((m) => [m.name, exampleValue(graph, m.shape, [...seen, name])]))
    case 'list':
      return [exampleValue(graph, shape.member, seen)]
    case 'map': {
      const key = shapeOf(graph, shape.key)
      const keyName = key.type === 'string' && key.enum ? key.enum[0] : 'key'
      return { [keyName]: exampleValue(graph, shape.value, seen) }
    }
    case 'string':
      return shape.enum ? shape.enum[0] : ''
    case 'boolean':
      return false
    case 'timestamp':
      return new Date(0).toISOString()
    case 'blob':
      return ''
    case 'document':
      return {}
    default:
      return 0
  }
}

/** `value` without anything a sensitive shape holds (secrets, passwords, keys), for keeping it around. */
export function withoutSensitive(graph: ExplorerShapeGraph, name: string, value: JsonValue): JsonValue | undefined {
  const shape = shapeOf(graph, name)
  if (shape.sensitive) return undefined
  if (shape.type === 'structure' && isObject(value)) {
    const kept: JsonObject = {}
    for (const member of shape.members) {
      if (!(member.name in value)) continue
      const item = withoutSensitive(graph, member.shape, value[member.name])
      if (item !== undefined) kept[member.name] = item
    }
    return kept
  }
  if (shape.type === 'list' && Array.isArray(value)) {
    return value.flatMap((item) => {
      const kept = withoutSensitive(graph, shape.member, item)
      return kept === undefined ? [] : [kept]
    })
  }
  if (shape.type === 'map' && isObject(value)) {
    const kept: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      const entry = withoutSensitive(graph, shape.value, item)
      if (entry !== undefined) kept[key] = entry
    }
    return kept
  }
  return value
}

/** The same JSON, whether or not it's the same object. */
export function sameJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The first sentence of plain-text documentation, for a field description. */
export function firstSentence(text: string): string {
  // The first line: a list can follow the opening sentence ("The filters.\n- affinity ...")
  const paragraph = text.split('\n', 1)[0]
  return paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/, 1)[0]
}

/** A short line describing the shape's type and limits, under a form field. */
export function constraintText(shape: ExplorerShape, graph: ExplorerShapeGraph): string {
  const parts: (string | null)[] = []
  switch (shape.type) {
    case 'string':
      parts.push('String', shape.enum ? null : limits(shape, 'characters'))
      break
    case 'timestamp':
      parts.push('Timestamp, such as 2026-01-31T09:30:00Z')
      break
    case 'blob':
      parts.push(`Text${shape.streaming ? ', sent as the body' : ''}. For other bytes use the JSON view: {"${BASE64_KEY}": "..."}`)
      break
    case 'list': {
      const member = shapeOf(graph, shape.member)
      const perLine = fieldKind(shape, graph) === 'scalarList'
      parts.push(perLine ? `One ${member.type} per line` : `List of ${member.type}`, limits(shape, 'items'))
      break
    }
    case 'map':
      parts.push('Map', limits(shape, 'entries'))
      break
    case 'structure':
      parts.push(shape.union ? 'Object with exactly one of its members set' : 'Object')
      break
    case 'document':
      parts.push('Any JSON value')
      break
    default:
      parts.push(shape.type[0].toUpperCase() + shape.type.slice(1), limits(shape))
  }
  return parts.filter(Boolean).join(', ')
}

function limits(shape: ExplorerShape, unit?: string): string | null {
  const suffix = unit ? ` ${unit}` : ''
  if (shape.min !== undefined && shape.max !== undefined) return `${shape.min} to ${shape.max}${suffix}`
  if (shape.min !== undefined) return `at least ${shape.min}${suffix}`
  if (shape.max !== undefined) return `at most ${shape.max}${suffix}`
  return null
}
