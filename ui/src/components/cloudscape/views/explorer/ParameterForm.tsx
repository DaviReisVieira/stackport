import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Autosuggest from '@cloudscape-design/components/autosuggest'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Multiselect from '@cloudscape-design/components/multiselect'
import Popover from '@cloudscape-design/components/popover'
import Select from '@cloudscape-design/components/select'
import type { SelectProps } from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Textarea from '@cloudscape-design/components/textarea'
import type { ExplorerMember, ExplorerShape, ExplorerShapeGraph, JsonObject, JsonValue } from '@/lib/types'
import {
  constraintText,
  exampleValue,
  fieldKind,
  firstSentence,
  isEmptyValue,
  isObject,
  sameJson,
  shapeOf,
} from './shapes'
import type { StructureShape } from './shapes'

/**
 * Text typed into a field that can't be sent yet, and why. The page keeps it, so
 * it survives the field going away (another tab) and keeps Run blocked.
 */
export interface FieldDraft {
  text: string
  error: string
}

/** Keeps a field's draft, or with null drops it. */
export type ReportDraft = (field: string, draft: FieldDraft | null) => void

type Emit = (value: JsonValue | undefined) => void

type Parsed = { value: JsonValue | undefined } | { error: string }

const NOT_SET: SelectProps.Option = { label: 'Not set', value: '' }

/**
 * Text a field shows while it parses to the value the field sent: someone typing
 * "1." in a number field keeps their dot, and compact JSON stays compact. A value
 * that arrives from elsewhere (the JSON view, a request from history) replaces
 * the text. Values are compared as JSON, since parents copy what fields send.
 */
function useFieldText(value: JsonValue | undefined, format: (value: JsonValue | undefined) => string) {
  const [draft, setDraft] = useState(() => ({ text: format(value), value }))
  let current = draft
  if (!sameJson(draft.value, value)) {
    current = { text: format(value), value }
    setDraft(current)
  }
  const update = useCallback((text: string, next: JsonValue | undefined) => setDraft({ text, value: next }), [])
  return [current.text, update] as const
}

/**
 * A field typed as text: valid text sends its value, invalid text becomes a
 * draft (shown instead of the value) and the last valid value stays.
 */
function useTextField({
  name,
  value,
  draft,
  format,
  parse,
  onChange,
  onDraft,
}: {
  name: string
  value: JsonValue | undefined
  draft: FieldDraft | undefined
  format: (value: JsonValue | undefined) => string
  parse: (text: string) => Parsed
  onChange: Emit
  onDraft: ReportDraft
}) {
  const [text, setText] = useFieldText(value, format)
  const change = (next: string) => {
    const parsed = parse(next)
    if ('error' in parsed) {
      onDraft(name, { text: next, error: parsed.error })
      return
    }
    setText(next, parsed.value)
    onDraft(name, null)
    onChange(parsed.value)
  }
  return [draft?.text ?? text, change] as const
}

function formatJson(value: JsonValue | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

const EXPECTED_JSON: Partial<Record<ExplorerShape['type'], [check: (value: JsonValue) => boolean, message: string]>> = {
  structure: [isObject, 'Enter a JSON object, such as {"Name": "value"}.'],
  map: [isObject, 'Enter a JSON object, such as {"key": "value"}.'],
  list: [Array.isArray, 'Enter a JSON list, such as ["value"].'],
}

/** A JSON text area for a value of any shape, or for a whole request. */
export function JsonField({
  name,
  shape,
  graph,
  shapeName,
  value,
  draft,
  emptyValue,
  rows = 6,
  onChange,
  onDraft,
}: {
  name: string
  shape: ExplorerShape
  graph: ExplorerShapeGraph
  shapeName: string
  value: JsonValue | undefined
  draft: FieldDraft | undefined
  /** What an empty text area means: unset for a parameter, an empty request for the whole request */
  emptyValue?: JsonValue
  rows?: number
  onChange: Emit
  onDraft: ReportDraft
}) {
  const parse = (text: string): Parsed => {
    if (!text.trim()) return { value: emptyValue }
    let parsed: JsonValue
    try {
      parsed = JSON.parse(text) as JsonValue
    } catch (error) {
      return { error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
    }
    const expected = EXPECTED_JSON[shape.type]
    return expected && !expected[0](parsed) ? { error: expected[1] } : { value: parsed }
  }
  // An empty request shows as an empty text area, so "Insert example" is there to start from
  const format = (shown: JsonValue | undefined) => (sameJson(shown, emptyValue) ? '' : formatJson(shown))
  const [text, change] = useTextField({ name, value, draft, format, parse, onChange, onDraft })

  return (
    <SpaceBetween size="xs">
      <div className="[&_textarea]:!font-mono [&_textarea]:!text-xs">
        <Textarea value={text} rows={rows} spellcheck={false} ariaLabel={name} onChange={({ detail }) => change(detail.value)} />
      </div>
      {!text.trim() && (
        <Button variant="inline-link" onClick={() => change(JSON.stringify(exampleValue(graph, shapeName), null, 2))}>
          Insert example
        </Button>
      )}
    </SpaceBetween>
  )
}

function enumOptions(values: string[]): SelectProps.Option[] {
  return values.map((value) => ({ label: value, value }))
}

function isStringList(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isScalarList(value: JsonValue | undefined): value is (string | number | boolean)[] {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item !== 'object')
}

function isStringMap(value: JsonValue | undefined): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((item) => typeof item === 'string')
}

interface DraftFieldProps<T> {
  name: string
  value: T | undefined
  draft: FieldDraft | undefined
  onChange: Emit
  onDraft: ReportDraft
}

function NumberInput({ integer, ...field }: DraftFieldProps<number> & { integer: boolean }) {
  const [text, change] = useTextField({
    ...field,
    format: (v) => (v === undefined ? '' : String(v)),
    parse: (raw) => {
      const trimmed = raw.trim()
      if (trimmed === '') return { value: undefined }
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed) && (!integer || Number.isInteger(parsed))) return { value: parsed }
      return { error: integer ? 'Enter a whole number.' : 'Enter a number.' }
    },
  })
  return (
    <Input
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      ariaLabel={field.name}
      onChange={({ detail }) => change(detail.value)}
    />
  )
}

function LinesInput({ numbers, ...field }: DraftFieldProps<JsonValue[]> & { numbers: boolean }) {
  const [text, change] = useTextField({
    ...field,
    format: (v) => (Array.isArray(v) ? v.map(String).join('\n') : ''),
    parse: (raw) => {
      const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
      const items = numbers ? lines.map(Number) : lines
      if (numbers && !items.every((item) => Number.isFinite(item))) return { error: 'Enter one number per line.' }
      return { value: items.length > 0 ? items : undefined }
    },
  })
  return <Textarea value={text} rows={3} ariaLabel={field.name} onChange={({ detail }) => change(detail.value)} />
}

interface MapRow {
  key: string
  value: string
}

function rowsOf(value: JsonValue | undefined): MapRow[] {
  return isObject(value) ? Object.entries(value).map(([key, item]) => ({ key, value: String(item) })) : []
}

function StringMapEditor({ name, keyShape, value, onChange }: { name: string; keyShape: ExplorerShape; value: JsonValue | undefined; onChange: Emit }) {
  // Rows can hold an empty or repeated key while someone types, which an object can't
  const [draft, setDraft] = useState(() => ({ rows: rowsOf(value), value }))
  let rows = draft.rows
  if (draft.value !== value) {
    rows = rowsOf(value)
    setDraft({ rows, value })
  }
  const update = (next: MapRow[]) => {
    const entries = next.filter((row) => row.key.trim())
    const object = entries.length > 0 ? Object.fromEntries(entries.map((row) => [row.key.trim(), row.value])) : undefined
    setDraft({ rows: next, value: object })
    onChange(object)
  }
  const keyOptions = keyShape.type === 'string' && keyShape.enum ? enumOptions(keyShape.enum) : []

  return (
    <AttributeEditor
      items={rows}
      addButtonText="Add entry"
      removeButtonText="Remove"
      empty="No entries"
      onAddButtonClick={() => update([...rows, { key: '', value: '' }])}
      onRemoveButtonClick={({ detail }) => update(rows.filter((_, index) => index !== detail.itemIndex))}
      definition={[
        {
          label: 'Key',
          control: (row, index) => (
            <Autosuggest
              value={row.key}
              options={keyOptions}
              ariaLabel={`${name} key ${index + 1}`}
              enteredTextLabel={(text) => `Use "${text}"`}
              empty="No suggestions"
              onChange={({ detail }) => update(rows.map((r, i) => (i === index ? { ...r, key: detail.value } : r)))}
            />
          ),
        },
        {
          label: 'Value',
          control: (row, index) => (
            <Input
              value={row.value}
              ariaLabel={`${name} value ${index + 1}`}
              onChange={({ detail }) => update(rows.map((r, i) => (i === index ? { ...r, value: detail.value } : r)))}
            />
          ),
        },
      ]}
    />
  )
}

function Control({
  member,
  graph,
  value,
  draft,
  onChange,
  onDraft,
}: {
  member: ExplorerMember
  graph: ExplorerShapeGraph
  value: JsonValue | undefined
  draft: FieldDraft | undefined
  onChange: Emit
  onDraft: ReportDraft
}) {
  const shape = shapeOf(graph, member.shape)
  const kind = fieldKind(shape, graph)
  const field = { name: member.name, draft, onChange, onDraft }
  const json = <JsonField {...field} shape={shape} graph={graph} shapeName={member.shape} value={value} />
  // Only the JSON field, numbers and lists keep drafts: a draft anywhere else came from the JSON field
  if (draft && kind !== 'number' && kind !== 'scalarList') return json
  const text = value === undefined || typeof value === 'string'
  const stringValue = typeof value === 'string' ? value : ''
  const setText = (next: string) => onChange(next === '' ? undefined : next)

  switch (kind) {
    case 'string':
    case 'timestamp':
      if (!text) return json
      return (
        <Input
          value={stringValue}
          ariaLabel={member.name}
          placeholder={kind === 'timestamp' ? '2026-01-31T09:30:00Z' : undefined}
          onChange={({ detail }) => setText(detail.value)}
        />
      )
    case 'text':
    case 'blob':
      if (!text) return json
      return <Textarea value={stringValue} rows={kind === 'text' ? 6 : 3} ariaLabel={member.name} onChange={({ detail }) => setText(detail.value)} />
    case 'enum': {
      if (!text || shape.type !== 'string' || !shape.enum) return json
      const options = [NOT_SET, ...enumOptions(shape.enum)]
      return (
        <Select
          selectedOption={options.find((option) => option.value === stringValue) ?? (stringValue ? { label: stringValue, value: stringValue } : NOT_SET)}
          options={options}
          filteringType={shape.enum.length > 10 ? 'auto' : 'none'}
          ariaLabel={member.name}
          onChange={({ detail }) => setText(detail.selectedOption.value ?? '')}
        />
      )
    }
    case 'boolean': {
      if (value !== undefined && typeof value !== 'boolean') return json
      const options = [NOT_SET, { label: 'true', value: 'true' }, { label: 'false', value: 'false' }]
      return (
        <Select
          selectedOption={options.find((option) => option.value === (value === undefined ? '' : String(value))) ?? NOT_SET}
          options={options}
          ariaLabel={member.name}
          onChange={({ detail }) => onChange(detail.selectedOption.value === '' ? undefined : detail.selectedOption.value === 'true')}
        />
      )
    }
    case 'number':
      if (value !== undefined && typeof value !== 'number') return json
      return <NumberInput {...field} integer={shape.type === 'integer' || shape.type === 'long'} value={value} />
    case 'enumList': {
      const item = shape.type === 'list' ? shapeOf(graph, shape.member) : null
      if (item?.type !== 'string' || !item.enum) return json
      if (value !== undefined && !isStringList(value)) return json
      return (
        <Multiselect
          selectedOptions={(value ?? []).map((selected) => ({ label: selected, value: selected }))}
          options={enumOptions(item.enum)}
          filteringType={item.enum.length > 10 ? 'auto' : 'none'}
          placeholder="Choose values"
          ariaLabel={member.name}
          onChange={({ detail }) => {
            const values = detail.selectedOptions.map((option) => option.value ?? '').filter(Boolean)
            onChange(values.length > 0 ? values : undefined)
          }}
        />
      )
    }
    case 'scalarList': {
      if (value !== undefined && !isScalarList(value)) return json
      const numbers = shape.type === 'list' && shapeOf(graph, shape.member).type !== 'string'
      return <LinesInput {...field} numbers={numbers} value={value} />
    }
    case 'stringMap':
      if (shape.type !== 'map' || (value !== undefined && !isStringMap(value))) return json
      return <StringMapEditor name={member.name} keyShape={shapeOf(graph, shape.key)} value={value} onChange={onChange} />
    default:
      return json
  }
}

function DocumentationPopover({ name, text }: { name: string; text: string }) {
  return (
    <Popover header={name} size="large" triggerType="custom" content={<Box variant="p"><span className="whitespace-pre-line">{text}</span></Box>}>
      <Link variant="info" ariaLabel={`About ${name}`}>
        Info
      </Link>
    </Popover>
  )
}

function ParameterField({
  member,
  required,
  graph,
  value,
  draft,
  showRequired,
  onChange,
  onDraft,
}: {
  member: ExplorerMember
  required: boolean
  graph: ExplorerShapeGraph
  value: JsonValue | undefined
  draft: FieldDraft | undefined
  showRequired: boolean
  onChange: (name: string, value: JsonValue | undefined) => void
  onDraft: ReportDraft
}) {
  const shape = shapeOf(graph, member.shape)
  const documentation = member.documentation ?? ''
  const description = firstSentence(documentation)
  const constraint = [constraintText(shape, graph), member.idempotencyToken ? 'Filled in for you when left empty' : null]
    .filter(Boolean)
    .join('. ')
  const label: ReactNode = required ? member.name : (
    <>
      {member.name} <i>- optional</i>
    </>
  )
  const emit = useCallback((next: JsonValue | undefined) => onChange(member.name, next), [member.name, onChange])

  return (
    <FormField
      label={label}
      description={description || undefined}
      info={documentation && documentation !== description ? <DocumentationPopover name={member.name} text={documentation} /> : undefined}
      constraintText={constraint}
      errorText={draft?.error ?? (showRequired && required && isEmptyValue(value) ? `${member.name} is required.` : undefined)}
      stretch
    >
      <Control member={member} graph={graph} value={value} draft={draft} onChange={emit} onDraft={onDraft} />
    </FormField>
  )
}

/**
 * A form for an operation's input: one field per top-level parameter, with a
 * control that fits its shape, and JSON for nested ones. Required parameters
 * come first; the rest sit in a section that opens once one of them has a value.
 */
export function ParameterForm({
  graph,
  root,
  params,
  drafts,
  showRequired,
  onChange,
  onDraft,
}: {
  graph: ExplorerShapeGraph
  root: StructureShape
  params: JsonObject
  drafts: Record<string, FieldDraft>
  showRequired: boolean
  onChange: (params: JsonObject) => void
  onDraft: ReportDraft
}) {
  const required = root.members.filter((member) => root.required.includes(member.name))
  const optional = root.members.filter((member) => !root.required.includes(member.name))
  const optionalSet = optional.some((member) => !isEmptyValue(params[member.name]) || member.name in drafts)

  const [expanded, setExpanded] = useState(required.length === 0 || optionalSet)
  const [sawOptional, setSawOptional] = useState(optionalSet)
  if (sawOptional !== optionalSet) {
    setSawOptional(optionalSet)
    if (optionalSet) setExpanded(true)
  }

  const setParam = useCallback(
    (name: string, value: JsonValue | undefined) => {
      const next = { ...params }
      if (value === undefined) delete next[name]
      else next[name] = value
      onChange(next)
    },
    [params, onChange],
  )

  if (root.members.length === 0) {
    return <Box color="text-body-secondary">This operation takes no parameters.</Box>
  }

  const field = (member: ExplorerMember) => (
    <ParameterField
      key={member.name}
      member={member}
      required={root.required.includes(member.name)}
      graph={graph}
      value={params[member.name]}
      draft={drafts[member.name]}
      showRequired={showRequired}
      onChange={setParam}
      onDraft={onDraft}
    />
  )

  return (
    <SpaceBetween size="l">
      {required.map(field)}
      {optional.length > 0 && (
        <ExpandableSection
          headerText={`Optional parameters (${optional.length})`}
          expanded={expanded}
          onChange={({ detail }) => setExpanded(detail.expanded)}
        >
          <SpaceBetween size="l">{optional.map(field)}</SpaceBetween>
        </ExpandableSection>
      )}
    </SpaceBetween>
  )
}
