import type { DateRangePickerProps } from '@cloudscape-design/components/date-range-picker'
import type { ActivityEvent, ActivityLookup, ActivityQuery, LookupAttributeKey } from '@/lib/types'

/**
 * The Activity page's filters, kept in its URL so a view can be linked to:
 * `range=15m` (the last 15 minutes) or `start=...&end=...`, `attribute=EventSource&value=sqs.amazonaws.com`
 * (`attribute=none` for every event), and `filter=` for the text searched in the loaded events.
 */

export type RelativeUnit = 'minute' | 'hour' | 'day' | 'week'

export type TimeRange =
  | { type: 'relative'; amount: number; unit: RelativeUnit }
  | { type: 'absolute'; startDate: string; endDate: string }

const UNIT_SUFFIX: Record<RelativeUnit, string> = { minute: 'm', hour: 'h', day: 'd', week: 'w' }
const UNIT_MS: Record<RelativeUnit, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }
const SUFFIX_UNIT = Object.fromEntries(Object.entries(UNIT_SUFFIX).map(([unit, suffix]) => [suffix, unit])) as Record<string, RelativeUnit>

export const RELATIVE_UNITS: RelativeUnit[] = ['minute', 'hour', 'day', 'week']

export const DEFAULT_RANGE: TimeRange = { type: 'relative', amount: 1, unit: 'hour' }

/** Write calls only, until someone asks for more: reads, StackPort's own included, would bury them. */
export const DEFAULT_LOOKUP: ActivityLookup = { attribute: 'ReadOnly', value: 'false' }

export const NO_LOOKUP = 'none'

export const LOOKUP_ATTRIBUTES: { value: LookupAttributeKey; label: string }[] = [
  { value: 'ReadOnly', label: 'Read-only' },
  { value: 'EventName', label: 'Event name' },
  { value: 'EventSource', label: 'Event source' },
  { value: 'Username', label: 'User name' },
  { value: 'ResourceName', label: 'Resource name' },
  { value: 'ResourceType', label: 'Resource type' },
  { value: 'AccessKeyId', label: 'AWS access key' },
  { value: 'EventId', label: 'Event ID' },
]

const ATTRIBUTE_LABELS = Object.fromEntries(LOOKUP_ATTRIBUTES.map(({ value, label }) => [value, label])) as Record<LookupAttributeKey, string>

function isAttribute(value: string): value is LookupAttributeKey {
  return LOOKUP_ATTRIBUTES.some((attribute) => attribute.value === value)
}

function isInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value))
}

function relativeKey(amount: number, unit: RelativeUnit): string {
  return `${amount}${UNIT_SUFFIX[unit]}`
}

export function parseRange(range: string | null, start: string | null, end: string | null): TimeRange {
  if (start && end && isInstant(start) && isInstant(end) && Date.parse(start) <= Date.parse(end)) {
    return { type: 'absolute', startDate: start, endDate: end }
  }
  const match = /^([1-9]\d{0,3})([mhdw])$/.exec(range ?? '')
  return match ? { type: 'relative', amount: Number(match[1]), unit: SUFFIX_UNIT[match[2]] } : DEFAULT_RANGE
}

export function rangeParams(range: TimeRange): Record<'range' | 'start' | 'end', string | null> {
  return range.type === 'relative'
    ? { range: relativeKey(range.amount, range.unit), start: null, end: null }
    : { range: null, start: range.startDate, end: range.endDate }
}

/** An unknown attribute, or one without a value, falls back to the default lookup. */
export function parseLookup(attribute: string | null, value: string | null): ActivityLookup | null {
  if (attribute === NO_LOOKUP) return null
  const trimmed = value?.trim()
  if (!attribute || !isAttribute(attribute) || !trimmed) return DEFAULT_LOOKUP
  if (attribute === 'ReadOnly' && trimmed !== 'true' && trimmed !== 'false') return DEFAULT_LOOKUP
  return { attribute, value: trimmed }
}

export function lookupParams(lookup: ActivityLookup | null): Record<'attribute' | 'value', string | null> {
  return lookup ? { attribute: lookup.attribute, value: lookup.value } : { attribute: NO_LOOKUP, value: null }
}

export function describeLookup(lookup: ActivityLookup): string {
  return `${ATTRIBUTE_LABELS[lookup.attribute]} is ${lookup.value}`
}

/** The first page's window. A relative range ends now, so each refresh moves it forward. */
export function firstPageQuery(range: TimeRange, lookup: ActivityLookup | null, now: number): ActivityQuery {
  if (range.type === 'absolute') return { startTime: range.startDate, endTime: range.endDate, lookup }
  return { startTime: new Date(now - range.amount * UNIT_MS[range.unit]).toISOString(), endTime: null, lookup }
}

export function pickerValue(range: TimeRange): DateRangePickerProps.Value {
  return range.type === 'relative'
    ? { type: 'relative', amount: range.amount, unit: range.unit, key: relativeKey(range.amount, range.unit) }
    : range
}

export function rangeFromPicker(value: DateRangePickerProps.Value | null): TimeRange {
  if (value?.type === 'absolute') return { type: 'absolute', startDate: value.startDate, endDate: value.endDate }
  if (value?.type === 'relative' && (RELATIVE_UNITS as string[]).includes(value.unit)) {
    return { type: 'relative', amount: value.amount, unit: value.unit as RelativeUnit }
  }
  return DEFAULT_RANGE
}

export const RELATIVE_OPTIONS: DateRangePickerProps.RelativeOption[] = (
  [
    [15, 'minute'],
    [1, 'hour'],
    [3, 'hour'],
    [12, 'hour'],
    [1, 'day'],
    [7, 'day'],
    [30, 'day'],
    [90, 'day'],
  ] as const
).map(([amount, unit]) => ({ key: relativeKey(amount, unit), amount, unit, type: 'relative' }))

export const validateRange: DateRangePickerProps.ValidationFunction = (value) => {
  if (value?.type === 'absolute') {
    if (!value.startDate || !value.endDate) return { valid: false, errorMessage: 'Choose a start and an end.' }
    if (Date.parse(value.startDate) > Date.parse(value.endDate)) {
      return { valid: false, errorMessage: 'The start has to be before the end.' }
    }
  }
  if (value?.type === 'relative' && !(value.amount > 0)) return { valid: false, errorMessage: 'Choose a duration.' }
  return { valid: true }
}

/** Everything the text filter looks through: the columns and the whole record, so a queue named only in the request parameters is found too. */
function searchText(event: ActivityEvent): string {
  return [
    event.eventName,
    event.eventSource,
    event.username,
    event.accessKeyId,
    event.errorCode,
    event.errorMessage,
    event.sourceIpAddress,
    event.userAgent,
    event.eventId,
    event.awsRegion,
    ...event.resources.flatMap((resource) => [resource.type, resource.name]),
    event.record ? JSON.stringify(event.record) : event.rawRecord,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

const searchTexts = new WeakMap<ActivityEvent, string>()

export function matchesText(event: ActivityEvent, text: string): boolean {
  let haystack = searchTexts.get(event)
  if (haystack === undefined) {
    haystack = searchText(event)
    searchTexts.set(event, haystack)
  }
  return haystack.includes(text.trim().toLowerCase())
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
}

export function formatEventTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, TIME_FORMAT) : '-'
}

export function resourceNames(event: ActivityEvent): string {
  return event.resources.map((resource) => resource.name ?? resource.type).filter(Boolean).join(', ')
}

/** A row of the CSV export: the table's columns, without the record. */
export function csvRow(event: ActivityEvent): Record<string, unknown> {
  return {
    eventTime: event.eventTime,
    eventName: event.eventName,
    eventSource: event.eventSource,
    username: event.username,
    resources: resourceNames(event),
    readOnly: event.readOnly,
    errorCode: event.errorCode,
    sourceIpAddress: event.sourceIpAddress,
    userAgent: event.userAgent,
    accessKeyId: event.accessKeyId,
    awsRegion: event.awsRegion,
    eventId: event.eventId,
  }
}
