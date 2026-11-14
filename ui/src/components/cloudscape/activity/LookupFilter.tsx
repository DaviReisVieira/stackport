import { useState } from 'react'
import Button from '@cloudscape-design/components/button'
import Input from '@cloudscape-design/components/input'
import Select from '@cloudscape-design/components/select'
import type { SelectProps } from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import { LOOKUP_ATTRIBUTES, NO_LOOKUP } from '@/components/cloudscape/activity/activity'
import type { ActivityLookup, LookupAttributeKey } from '@/lib/types'

const ATTRIBUTE_OPTIONS: SelectProps.Option[] = [
  { value: NO_LOOKUP, label: 'All events', description: 'No lookup attribute' },
  ...LOOKUP_ATTRIBUTES,
]

const READ_ONLY_OPTIONS: SelectProps.Option[] = [
  { value: 'false', label: 'false', description: 'Calls that change something' },
  { value: 'true', label: 'true', description: 'Calls that only read' },
]

const PLACEHOLDERS: Record<Exclude<LookupAttributeKey, 'ReadOnly'>, string> = {
  EventName: 'For example, CreateBucket',
  EventSource: 'For example, sqs.amazonaws.com',
  Username: 'A user or role session name',
  ResourceName: 'A resource name or ARN',
  ResourceType: 'For example, AWS::S3::Bucket',
  AccessKeyId: 'An access key ID',
  EventId: 'An event ID',
}

function attributeFor(value: string | undefined): LookupAttributeKey | null {
  return LOOKUP_ATTRIBUTES.find((option) => option.value === value)?.value ?? null
}

/**
 * The lookup attribute and its value. CloudTrail looks up one attribute at a
 * time, so this is one choice rather than a set of filters. A typed value only
 * runs a lookup on Enter or Apply: on AWS, lookups are rate limited.
 *
 * The page renders it with the applied lookup as its `key`, so a value being
 * typed starts over when the lookup changes some other way (a link, Back).
 */
export function LookupFilter({ lookup, onApply }: { lookup: ActivityLookup | null; onApply: (lookup: ActivityLookup | null) => void }) {
  const [attribute, setAttribute] = useState<LookupAttributeKey | null>(lookup?.attribute ?? null)
  const [draft, setDraft] = useState(lookup?.value ?? '')
  const label = LOOKUP_ATTRIBUTES.find((option) => option.value === attribute)?.label ?? ''

  const chooseAttribute = (value: string | undefined) => {
    const chosen = attributeFor(value)
    setAttribute(chosen)
    setDraft('')
    if (chosen === null) onApply(null)
    else if (chosen === 'ReadOnly') onApply({ attribute: chosen, value: 'false' })
  }

  const apply = () => {
    const value = draft.trim()
    if (attribute && value) onApply({ attribute, value })
  }

  return (
    <SpaceBetween direction="horizontal" size="xs">
      <Select
        selectedOption={ATTRIBUTE_OPTIONS.find((option) => option.value === (attribute ?? NO_LOOKUP)) ?? null}
        options={ATTRIBUTE_OPTIONS}
        onChange={({ detail }) => chooseAttribute(detail.selectedOption.value)}
        ariaLabel="Lookup attribute"
      />
      {attribute === 'ReadOnly' && (
        <Select
          selectedOption={READ_ONLY_OPTIONS.find((option) => option.value === lookup?.value) ?? READ_ONLY_OPTIONS[0]}
          options={READ_ONLY_OPTIONS}
          onChange={({ detail }) => onApply({ attribute: 'ReadOnly', value: detail.selectedOption.value ?? 'false' })}
          ariaLabel="Read-only"
        />
      )}
      {attribute !== null && attribute !== 'ReadOnly' && (
        <>
          <Input
            type="search"
            value={draft}
            onChange={({ detail }) => setDraft(detail.value)}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') apply()
            }}
            placeholder={PLACEHOLDERS[attribute]}
            ariaLabel={label}
          />
          <Button onClick={apply} disabled={!draft.trim()}>
            Apply
          </Button>
        </>
      )}
    </SpaceBetween>
  )
}
