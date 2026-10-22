import type { DynamoDBItem, DynamoDBWriteResponse } from '@/lib/types'

/** Map plain JSON (JavaScript values) to DynamoDB attribute-value form (browser-side, mirrors boto TypeSerializer for common types). */
export function plainItemToDynamoMap(obj: Record<string, unknown>): DynamoDBItem {
  const out: DynamoDBItem = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = plainToAttr(v) as unknown
  }
  return out
}

function plainToAttr(v: unknown): unknown {
  if (v === null) return { NULL: true }
  if (v === undefined) return { NULL: true }
  if (typeof v === 'string') return { S: v }
  if (typeof v === 'number' && Number.isFinite(v)) return { N: String(v) }
  if (typeof v === 'boolean') return { BOOL: v }
  if (Array.isArray(v)) return { L: v.map((x) => plainToAttr(x)) }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const m: Record<string, unknown> = {}
    for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
      m[ik] = plainToAttr(iv)
    }
    return { M: m }
  }
  throw new Error(`Unsupported value for DynamoDB (type ${typeof v})`)
}

/** DynamoDB attribute -> plain JS value. */
export function dynamoItemToPlainMap(item: DynamoDBItem): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item)) {
    o[k] = attrToPlain(v)
  }
  return o
}

function attrToPlain(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object' || Array.isArray(v)) return v
  const o = v as Record<string, unknown>
  if ('S' in o) return o.S
  if ('N' in o) {
    const n = String(o.N)
    if (/^[+-]?\d+$/.test(n)) return parseInt(n, 10)
    return parseFloat(n)
  }
  if ('BOOL' in o) return o.BOOL
  if ('NULL' in o && o.NULL) return null
  if ('B' in o) return o.B
  if ('L' in o && Array.isArray((o as { L: unknown[] }).L)) {
    return (o as { L: unknown[] }).L.map((x) => attrToPlain(x))
  }
  if ('M' in o && o.M && typeof o.M === 'object') {
    return dynamoItemToPlainMap(o.M as DynamoDBItem)
  }
  if ('SS' in o && Array.isArray((o as { SS: string[] }).SS)) return [...(o as { SS: string[] }).SS]
  if ('NS' in o && Array.isArray((o as { NS: string[] }).NS)) {
    return (o as { NS: string[] }).NS.map((x) => (x.includes('.') ? parseFloat(x) : parseInt(x, 10)))
  }
  if ('BS' in o) return o.BS
  return v
}

export function buildDefaultPlainItem(
  partitionKey: string,
  sortKey: string | null,
  partitionType: string | null,
  sortType: string | null
): Record<string, unknown> {
  const o: Record<string, unknown> = { [partitionKey]: defaultValueForType(partitionType) }
  if (sortKey) o[sortKey] = defaultValueForType(sortType)
  return o
}

function defaultValueForType(t: string | null): unknown {
  if (t === 'N') return 0
  if (t === 'BOOL') return false
  if (t === 'B') return ''
  return ''
}

/** Extract only primary-key attributes in DynamoDB form. */
export function extractKeyDynamo(
  item: DynamoDBItem,
  partitionKey: string,
  sortKey: string | null
): DynamoDBItem {
  const k: DynamoDBItem = { [partitionKey]: item[partitionKey] as unknown }
  if (sortKey) k[sortKey] = item[sortKey] as unknown
  return k
}

export function countUnprocessed(resp: DynamoDBWriteResponse, table: string): number {
  const u = resp.unprocessed
  if (!u || typeof u !== 'object') return 0
  const arr = (u as Record<string, unknown>)[table]
  return Array.isArray(arr) ? arr.length : 0
}

/**
 * Checks whether a DynamoDB item contains any attribute type that cannot survive
 * a round-trip through Plain JSON without silent data loss.
 *
 * Plain JSON has no representation for DynamoDB sets (`SS`, `NS`, `BS`) or binary
 * (`B`) — they get flattened to plain arrays/strings and lose their type on save.
 * Large integers (`N`) outside JavaScript's safe integer range also lose precision
 * the moment they're parsed into a JS `number`.
 *
 * @param item - The DynamoDB-typed item to check (as returned by the API).
 * @returns `true` if the item has at least one unsafe attribute, anywhere in its
 *          structure (including nested inside `L` lists or `M` maps).
 */
export function hasUnsafePlainTypes(item: DynamoDBItem): boolean {
  return Object.values(item).some(attrHasUnsafeType)
}

/**
 * Recursively checks a single DynamoDB attribute value for an unsafe type.
 *
 * Recurses into `L` (list) and `M` (map) attributes so that unsafe types nested
 * arbitrarily deep in the item are still detected, not just top-level attributes.
 *
 * @param v - A single DynamoDB attribute value, e.g. `{ S: "hello" }` or `{ N: "42" }`.
 * @returns `true` if this attribute (or anything nested inside it) is unsafe.
 */
function attrHasUnsafeType(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if ('SS' in o || 'NS' in o || 'BS' in o || 'B' in o) return true
  if ('N' in o) {
    const n = Number(o.N)
    return Number.isInteger(n) && !Number.isSafeInteger(n)
  }
  if ('L' in o && Array.isArray((o as { L: unknown[] }).L)) {
    return (o as { L: unknown[] }).L.some(attrHasUnsafeType)
  }
  if ('M' in o && o.M && typeof o.M === 'object') {
    return Object.values(o.M as Record<string, unknown>).some(attrHasUnsafeType)
  }
  return false
}