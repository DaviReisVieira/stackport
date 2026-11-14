import type { ExplorerOperation, ExplorerShapeGraph, JsonObject, JsonValue } from '@/lib/types'
import { BASE64_KEY, isObject, shapeOf } from './shapes'

/** Where the copied command sends its request: the active endpoint (null on real AWS) and region. */
export interface SnippetTarget {
  endpointUrl: string | null
  region: string
}

export interface SnippetRequest {
  operation: ExplorerOperation
  params: JsonObject
  paginate: boolean
}

// What the AWS CLI calls the file it saves a streamed response to
const CLI_OUTFILE = 'response.out'

/** A blob parameter's bytes in base64, given as text or as {"$base64": ...}. */
function blobBase64(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    let binary = ''
    for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  if (isObject(value) && typeof value[BASE64_KEY] === 'string') return value[BASE64_KEY]
  return value
}

/** A JSON value in which some blobs were replaced by something else. */
type WithBlobs<T> = T | JsonValue | WithBlobs<T>[] | { [key: string]: WithBlobs<T> }

/** Walk a value along its shape, replacing each blob with what `blob` makes of it. */
function mapBlobs<T>(
  graph: ExplorerShapeGraph,
  name: string,
  value: JsonValue,
  blob: (value: JsonValue) => T | JsonValue,
): WithBlobs<T> {
  const shape = shapeOf(graph, name)
  if (shape.type === 'blob') return blob(value)
  if (shape.type === 'structure' && isObject(value)) {
    const members = new Map(shape.members.map((m) => [m.name, m.shape]))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const member = members.get(key)
        return [key, member ? mapBlobs(graph, member, item, blob) : item]
      }),
    )
  }
  if (shape.type === 'list' && Array.isArray(value)) return value.map((item) => mapBlobs(graph, shape.member, item, blob))
  if (shape.type === 'map' && isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapBlobs(graph, shape.value, item, blob)]))
  }
  return value
}

function inputWith<T>(operation: ExplorerOperation, params: JsonObject, blob: (value: JsonValue) => T | JsonValue) {
  if (!operation.input) return {}
  return mapBlobs(operation.input, operation.input.root, params, blob) as { [key: string]: WithBlobs<T> }
}

/** Quote for a POSIX shell, only when needed. */
function shellWord(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * The AWS CLI (v2) command for the request. Parameters go in --cli-input-json,
 * except for operations that save their response to a file, which only take
 * options. Blobs are base64, as CLI v2 expects them.
 */
export function awsCliCommand({ operation, params, paginate }: SnippetRequest, target: SnippetTarget): string {
  const words = ['aws', ...operation.cliCommand.split(' ')]
  const values = inputWith<never>(operation, params, blobBase64) as JsonObject
  if (operation.streamingOutput) {
    for (const [name, value] of Object.entries(values)) {
      const option = operation.cliOptions[name] ?? name
      if (typeof value === 'boolean') words.push(value ? option : option.replace(/^--/, '--no-'))
      else if (typeof value === 'string') words.push(option, shellWord(value))
      else if (typeof value === 'number') words.push(option, String(value))
      else words.push(option, shellWord(JSON.stringify(value)))
    }
  } else if (Object.keys(values).length > 0) {
    words.push('--cli-input-json', shellWord(JSON.stringify(values)))
  }
  // The CLI follows every page unless told not to
  if (operation.pagination && !paginate) words.push('--no-paginate')
  if (target.endpointUrl) words.push('--endpoint-url', shellWord(target.endpointUrl))
  words.push('--region', shellWord(target.region))
  if (operation.streamingOutput) words.push(CLI_OUTFILE)
  return words.join(' ')
}

const PY_INDENT = '    '
// Collections longer than this on one line are split over several
const PY_LINE = 72

/** Python code to put in a literal as is. */
class PyExpression {
  readonly code: string

  constructor(code: string) {
    this.code = code
  }
}

type PyValue = WithBlobs<PyExpression>

/** A Python literal for a JSON value, split over lines when long. */
function pyLiteral(value: PyValue, indent: string): string {
  if (value instanceof PyExpression) return value.code
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  // JSON string escapes are valid in Python string literals
  if (typeof value === 'string') return JSON.stringify(value)
  const inner = indent + PY_INDENT
  const items = Array.isArray(value)
    ? value.map((item) => pyLiteral(item, inner))
    : Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${pyLiteral(item, inner)}`)
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  const flat = `${open}${items.join(', ')}${close}`
  if (items.length === 0 || (flat.length <= PY_LINE && !flat.includes('\n'))) return flat
  return `${open}\n${items.map((item) => `${inner}${item},`).join('\n')}\n${indent}${close}`
}

/** The boto3 code for the request. */
export function boto3Snippet({ operation, params, paginate }: SnippetRequest, target: SnippetTarget): string {
  let usesBase64 = false
  const values = inputWith<PyExpression>(operation, params, (value) => {
    if (!isObject(value) || typeof value[BASE64_KEY] !== 'string') return value
    usesBase64 = true
    return new PyExpression(`base64.b64decode(${JSON.stringify(value[BASE64_KEY])})`)
  })

  const clientArgs = [JSON.stringify(operation.service)]
  if (target.endpointUrl) clientArgs.push(`endpoint_url=${JSON.stringify(target.endpointUrl)}`)
  clientArgs.push(`region_name=${JSON.stringify(target.region)}`)

  const kwargs = Object.entries(values).map(([name, value]) => `${name}=${pyLiteral(value, PY_INDENT)}`)
  const call = (fn: string) =>
    kwargs.length === 0 ? `${fn}()` : `${fn}(\n${kwargs.map((kwarg) => `${PY_INDENT}${kwarg},`).join('\n')}\n)`

  const lines = [...(usesBase64 ? ['import base64', ''] : []), 'import boto3', '', `client = boto3.client(${clientArgs.join(', ')})`, '']
  if (paginate && operation.pagination) {
    lines.push(`paginator = client.get_paginator(${JSON.stringify(operation.methodName)})`)
    lines.push(`for page in ${call('paginator.paginate')}:`, `${PY_INDENT}print(page)`)
  } else {
    lines.push(`response = ${call(`client.${operation.methodName}`)}`, 'print(response)')
  }
  return lines.join('\n')
}
