import { useCallback, useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import FormField from '@cloudscape-design/components/form-field'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { fetchTryItStages } from '@/lib/api'
import type { TryItStageTarget, TryItTargets } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { TryItForm } from './TryItForm'

function StageTryIt({ kind, apiId }: { kind: 'rest-stage' | 'http-stage'; apiId: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchTryItStages(kind, apiId, activeEndpoint), [kind, apiId, activeEndpoint])
  const { data, loading, error } = useFetch<TryItTargets<TryItStageTarget>>(fetcher)
  const [picked, setPicked] = useState<string | null>(null)

  if (loading && !data) return <StatusIndicator type="loading">Loading stages</StatusIndicator>
  if (error && !data) return <Alert type="error">{error}</Alert>
  if (!data) return null
  if (data.targets.length === 0) {
    return <Box color="text-body-secondary">This API has no stages yet. Deploy it to a stage to send requests to it.</Box>
  }

  const current = data.targets.find((target) => target.stage === picked) ?? data.targets[0]
  return (
    <SpaceBetween size="m">
      <FormField label="Stage">
        <Select
          selectedOption={{ value: current.stage, label: current.stage }}
          onChange={({ detail }) => setPicked(detail.selectedOption.value ?? null)}
          options={data.targets.map((target) => ({ value: target.stage, label: target.stage }))}
        />
      </FormField>
      {data.problem && <Alert type="info">{data.problem}</Alert>}
      {current.url && (
        <TryItForm target={{ kind, apiId, stage: current.stage }} url={current.url} realAws={data.realAws} />
      )}
    </SpaceBetween>
  )
}

/** Try it for a REST API, in the generic detail of `apigateway/rest_apis`. */
export function RestApiTryIt({ resourceId }: { resourceId: string }) {
  return <StageTryIt kind="rest-stage" apiId={resourceId} />
}

/** Try it for an HTTP API, in the generic detail of `apigateway/apis`. */
export function HttpApiTryIt({ resourceId }: { resourceId: string }) {
  return <StageTryIt kind="http-stage" apiId={resourceId} />
}
