/**
 * Hotspot ids a lesson step may point at.
 *
 * A hotspot is an anchor rendered next to a real control; the tutorial popover
 * attaches to it. Ids must be unique across the whole application, because
 * Cloudscape's AnnotationContext resolves them first-occurrence-wins, so a
 * duplicate makes every later step that uses it unreachable. That also rules
 * out anchoring inside a table cell or anything else rendered per item.
 *
 * Mirrored in backend/learn/hotspots.py, which validates trail content against
 * the same list. A test reads both files and fails if they drift.
 */
export const LEARN_HOTSPOTS = {
  /** Always mounted in the shell, so a step with no anchor still gets a popover. */
  panelAnchor: 'learn-panel-anchor',
  navResources: 'nav-resources',

  s3BucketsCreate: 's3-buckets-create',
  s3BucketsTable: 's3-buckets-table',
  s3Upload: 's3-upload',
  s3ObjectsTable: 's3-objects-table',

  dynamodbTablesCreate: 'dynamodb-tables-create',
  dynamodbTablesTable: 'dynamodb-tables-table',
} as const

export type LearnHotspotId = (typeof LEARN_HOTSPOTS)[keyof typeof LEARN_HOTSPOTS]

export const KNOWN_HOTSPOT_IDS: ReadonlySet<string> = new Set(Object.values(LEARN_HOTSPOTS))

export const FALLBACK_HOTSPOT_ID: string = LEARN_HOTSPOTS.panelAnchor

/**
 * Resolve a hotspot id from trail content. An unknown id would strand the
 * tutorial with no popover and Next disabled forever, so it falls back to the
 * anchor in the shell, which is always mounted.
 */
export function resolveHotspotId(hotspotId: string | undefined): string {
  if (hotspotId && KNOWN_HOTSPOT_IDS.has(hotspotId)) return hotspotId
  if (hotspotId) {
    console.warn(`[learn] unknown hotspot "${hotspotId}"; falling back to the panel anchor`)
  }
  return FALLBACK_HOTSPOT_ID
}
