import { useState } from 'react'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import SpaceBetween from '@cloudscape-design/components/space-between'
import { useLearn } from '@/hooks/useLearn'
import type { LearnLesson, LearnVariableSpec } from '@/lib/types'

/**
 * Lets the learner name the resources the lesson will create.
 *
 * It matters because verification looks for the exact name: without this, a
 * learner who improvises a bucket name gets a step that will never go green,
 * with nothing on screen explaining why.
 */
export function LearnVariableEditor({ lesson }: { lesson: LearnLesson }) {
  const specs = lesson.variables ?? []
  if (specs.length === 0) return null

  return (
    <ExpandableSection
      headerText="Names used in this lesson"
      variant="footer"
      headerDescription="Change these if you prefer your own"
    >
      <SpaceBetween size="m">
        {specs.map((spec) => (
          <VariableField key={spec.name} lesson={lesson} spec={spec} />
        ))}
      </SpaceBetween>
    </ExpandableSection>
  )
}

function VariableField({ lesson, spec }: { lesson: LearnLesson; spec: LearnVariableSpec }) {
  const { variables, setVariable } = useLearn()
  const current = variables[lesson.id]?.[spec.name] ?? ''
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = draft !== current && draft.trim().length > 0

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await setVariable(lesson.id, spec.name, draft.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that name')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormField label={spec.label} description={spec.description} errorText={error}>
      <SpaceBetween size="xs" direction="horizontal">
        <Input
          value={dirty ? draft : current}
          onChange={({ detail }) => setDraft(detail.value)}
          placeholder={spec.default}
          ariaLabel={spec.label}
        />
        <Button disabled={!dirty} loading={saving} onClick={save} data-testid={`learn-save-${spec.name}`}>
          Use this
        </Button>
      </SpaceBetween>
      {!dirty && (
        <Box variant="small" color="text-body-secondary" padding={{ top: 'xxs' }}>
          Every command in the lesson already uses this name.
        </Box>
      )}
    </FormField>
  )
}
