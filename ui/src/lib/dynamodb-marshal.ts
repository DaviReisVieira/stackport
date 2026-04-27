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
