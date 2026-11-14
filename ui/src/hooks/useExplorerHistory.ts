import { useCallback, useEffect, useState } from 'react'
import type { JsonObject } from '@/lib/types'

const STORAGE_KEY = 'stackport:explorer-history'
const LIMIT = 15

/** A request run from the API Explorer. Sensitive values are left out before it gets here. */
export interface ExplorerHistoryEntry {
  service: string
  operation: string
  params: JsonObject
  /** The HTTP status StackPort answered with; null when it couldn't be reached */
  status: number | null
  at: string
}

function isEntry(value: unknown): value is ExplorerHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.service === 'string' &&
    typeof entry.operation === 'string' &&
    typeof entry.at === 'string' &&
    (typeof entry.status === 'number' || entry.status === null) &&
    !!entry.params &&
    typeof entry.params === 'object' &&
    !Array.isArray(entry.params)
  )
}

function load(): ExplorerHistoryEntry[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(isEntry).slice(0, LIMIT) : []
  } catch {
    return []
  }
}

/** Keep as many of the newest entries as storage takes: one large request mustn't stop the rest being saved. */
function save(entries: ExplorerHistoryEntry[]) {
  for (let count = entries.length; count >= 0; count--) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, count)))
      return
    } catch {
      // Storage full, or blocked: try with fewer, and the history still works for this visit
    }
  }
}

/** The last requests run from the API Explorer, newest first, kept in this browser. */
export function useExplorerHistory() {
  const [entries, setEntries] = useState<ExplorerHistoryEntry[]>(load)

  useEffect(() => save(entries), [entries])

  const record = useCallback((entry: ExplorerHistoryEntry) => {
    setEntries((current) => {
      const same = (other: ExplorerHistoryEntry) =>
        other.service === entry.service &&
        other.operation === entry.operation &&
        JSON.stringify(other.params) === JSON.stringify(entry.params)
      return [entry, ...current.filter((other) => !same(other))].slice(0, LIMIT)
    })
  }, [])

  const clear = useCallback(() => setEntries([]), [])

  return { entries, record, clear }
}
