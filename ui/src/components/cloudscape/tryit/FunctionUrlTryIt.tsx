import { useCallback, useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import FormField from '@cloudscape-design/components/form-field'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { fetchTryItFunctionUrls } from '@/lib/api'
import type { TryItFunctionUrlTarget, TryItTargets } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { TryItForm } from './TryItForm'

const UNQUALIFIED = '$function'

function label(target: TryItFunctionUrlTarget): string {
  return target.qualifier ? `Alias ${target.qualifier}` : 'Function'
}

/** A function's URLs (its own and its aliases'), and Try it for the one picked. */
export function FunctionUrlTryIt({ functionName }: { functionName: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchTryItFunctionUrls(functionName, activeEndpoint), [functionName, activeEndpoint])
  const { data, loading, error } = useFetch<TryItTargets<TryItFunctionUrlTarget>>(fetcher)
  const [picked, setPicked] = useState<string | null>(null)

  if (loading && !data) return <StatusIndicator type="loading">Loading function URLs</StatusIndicator>
  if (error && !data) return <Alert type="error">{error}</Alert>
  if (!data) return null
  if (data.targets.length === 0) return <Box color="text-body-secondary">This function has no function URL.</Box>

  const key = (target: TryItFunctionUrlTarget) => target.qualifier ?? UNQUALIFIED
  const current = data.targets.find((target) => key(target) === picked) ?? data.targets[0]
  return (
    <SpaceBetween size="m">
      {data.targets.length > 1 && (
        <FormField label="Function URL">
          <Select
            selectedOption={{ value: key(current), label: label(current) }}
            onChange={({ detail }) => setPicked(detail.selectedOption.value ?? null)}
            options={data.targets.map((target) => ({ value: key(target), label: label(target) }))}
          />
        </FormField>
      )}
      <KeyValuePairs
        columns={2}
        items={[
          { label: 'Function URL', value: <span className="break-all">{current.functionUrl}</span> },
          { label: 'Auth type', value: current.authType ?? '-' },
        ]}
      />
      {current.authType === 'AWS_IAM' && (
        <Alert type="info">
          This URL takes requests signed with AWS credentials. StackPort sends them unsigned, so an endpoint that
          checks signatures answers 403.
        </Alert>
      )}
      {data.problem && <Alert type="info">{data.problem}</Alert>}
      {current.url && (
        <TryItForm
          target={{ kind: 'function-url', functionName, qualifier: current.qualifier }}
          url={current.url}
          realAws={data.realAws}
        />
      )}
    </SpaceBetween>
  )
}
