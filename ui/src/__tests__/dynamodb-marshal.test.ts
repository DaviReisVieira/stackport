import { describe, expect, it } from 'vitest'
import {
  buildDefaultPlainItem,
  countUnprocessed,
  dynamoItemToPlainMap,
  extractKeyDynamo,
  hasUnsafePlainTypes,
  plainItemToDynamoMap,
} from '@/lib/dynamodb-marshal'
import type { DynamoDBWriteResponse } from '@/lib/types'

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

  describe('countUnprocessed', () => {
    const mk = (unprocessed: unknown): DynamoDBWriteResponse => ({
      ok: true,
      table: 't1',
      unprocessed,
    })

    it('returns 0 when unprocessed is undefined', () => {
      expect(countUnprocessed({ ok: true, table: 't1' }, 't1')).toBe(0)
    })

    it('returns 0 when unprocessed is empty object', () => {
      expect(countUnprocessed(mk({}), 't1')).toBe(0)
    })

    it('returns 0 when unprocessed has entries for a different table', () => {
      expect(countUnprocessed(mk({ other: [{ PutRequest: {} }] }), 't1')).toBe(0)
    })

    it('returns array length for the matching table', () => {
      const unprocessed = {
        t1: [{ PutRequest: { Item: { pk: { S: '1' } } } }, { DeleteRequest: { Key: { pk: { S: '2' } } } }],
      }
      expect(countUnprocessed(mk(unprocessed), 't1')).toBe(2)
    })

    it('returns 0 for non-object unprocessed values', () => {
      expect(countUnprocessed(mk(null), 't1')).toBe(0)
      expect(countUnprocessed(mk('oops' as unknown), 't1')).toBe(0)
    })
  })
  
  describe("hasUnsafePlainTypes", () => {
    it("detects a set, binary, and an unsafely large number together", () => {
      const item = {
        key: { S: "Hello" },
        tags: { SS: ["a", "b"] },
        bin: { B: "aGVsbG8=" },
        big: { N: "12345678901234567890" },
      };
      expect(hasUnsafePlainTypes(item)).toBe(true);
    });

    it("is false for a plain-safe item", () => {
      const item = { key: { S: "Hello" }, count: { N: "42" } };
      expect(hasUnsafePlainTypes(item)).toBe(false);
    });

    it("catches unsafe types nested inside a map", () => {
      const item = { key: { S: "Hello" }, meta: { M: { tags: { SS: ["a"] } } } };
      expect(hasUnsafePlainTypes(item)).toBe(true);
    });

    it("catches unsafe types nested inside a list", () => {
      const item = {
        key: { S: "Hello" },
        items: { L: [{ N: "99999999999999999999" }] },
      };
      expect(hasUnsafePlainTypes(item)).toBe(true);
    });

    it("treats a safe integer N as fine", () => {
      const item = { key: { S: "Hello" }, count: { N: "9007199254740991" } };
      expect(hasUnsafePlainTypes(item)).toBe(false);
    });
  });
})
