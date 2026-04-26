import { describe, expect, it } from 'vitest'
import {
  buildDefaultPlainItem,
  dynamoItemToPlainMap,
  extractKeyDynamo,
  plainItemToDynamoMap,
} from '@/lib/dynamodb-marshal'

describe('dynamodb-marshal', () => {
  it('buildDefaultPlainItem includes partition and sort keys with types', () => {
    const o = buildDefaultPlainItem('pk', 'sk', 'S', 'N')
    expect(o).toEqual({ pk: '', sk: 0 })
  })

  it('round-trips plain to dynamo and back for simple map', () => {
    const plain = { a: 'x', n: 3, f: 1.5, b: true, o: { x: 1 } }
    const d = plainItemToDynamoMap(plain)
    const back = dynamoItemToPlainMap(d)
    expect(back.a).toBe('x')
    expect(back.n).toBe(3)
    expect(back.f).toBe(1.5)
    expect(back.b).toBe(true)
    expect(back.o).toEqual({ x: 1 })
  })

  it('extractKeyDynamo copies only key attributes', () => {
    const item = { pk: { S: '1' }, sk: { S: '2' }, x: { S: 'y' } }
    const k = extractKeyDynamo(item, 'pk', 'sk')
    expect(Object.keys(k).sort()).toEqual(['pk', 'sk'])
  })
})
