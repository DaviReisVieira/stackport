import { useState } from 'react'
import type { ReactNode } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Container from '@cloudscape-design/components/container'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import type { KeyValuePairsProps } from '@cloudscape-design/components/key-value-pairs'
import Modal from '@cloudscape-design/components/modal'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { toast } from 'sonner'
import { EmulatorDocsLink, EmulatorLimitList } from '@/components/cloudscape/EmulatorProfile'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useHealth } from '@/hooks/useHealth'
import { ApiError, resetEndpointEmulator } from '@/lib/api'
import type { EmulatorInfo } from '@/lib/types'
import { emulatorLabel } from '@/lib/utils'

function ResetEmulatorModal({
  endpointName,
  url,
  emulator,
  onClose,
}: {
  endpointName: string
  url: string | null
  emulator: EmulatorInfo
  onClose: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [failure, setFailure] = useState<{ message: string; hint: string | null } | null>(null)

  const reset = async () => {
    setResetting(true)
    setFailure(null)
    try {
      const result = await resetEndpointEmulator(endpointName)
      toast.success(`${result.emulator.name} at ${endpointName} was reset`)
      onClose()
    } catch (error) {
      const hint = error instanceof ApiError ? (error.classified?.hint ?? null) : null
      setFailure({ message: error instanceof Error ? error.message : String(error), hint })
    } finally {
      setResetting(false)
    }
  }

  return (
    <Modal
      visible
      onDismiss={onClose}
      header={`Reset ${emulator.name}`}
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={resetting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void reset()}
              loading={resetting}
              disabled={confirmText !== endpointName}
              data-testid="confirm-reset-emulator"
            >
              Reset
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Alert type="warning">
          This deletes everything {emulator.name} holds at {url ?? 'this endpoint'}, in every service, and cannot be
          undone. StackPort sends {emulator.name}&apos;s own reset request; the endpoint&apos;s settings stay as they
          are.
        </Alert>
        <FormField label={`Type the endpoint name, ${endpointName}, to confirm`}>
          <Input
            value={confirmText}
            onChange={({ detail }) => setConfirmText(detail.value)}
            placeholder={endpointName}
            ariaLabel="Endpoint name"
            disabled={resetting}
          />
        </FormField>
        {failure && (
          <Alert type="error" header={`Couldn't reset ${emulator.name}`}>
            <SpaceBetween size="xxs">
              <Box>{failure.message}</Box>
              {failure.hint && <Box color="text-body-secondary">{failure.hint}</Box>}
            </SpaceBetween>
          </Alert>
        )}
      </SpaceBetween>
    </Modal>
  )
}

/**
 * What StackPort knows about the emulator behind the endpoint being browsed:
 * its documentation, its known limits, and a reset when it has one.
 */
export function EmulatorPanel() {
  const { activeEndpoint, endpoints } = useEndpoint()
  const { data: health } = useHealth()
  const [resetOpen, setResetOpen] = useState(false)

  const endpoint = endpoints.find((e) => e.name === activeEndpoint)
  const emulator = health?.emulator ?? null
  const profile = emulator?.profile ?? null
  const url = health?.endpoint_url ?? endpoint?.url ?? null
  const canReset = Boolean(endpoint && profile?.reset && health?.connection_type === 'local')

  let content: ReactNode
  if (!health) {
    content = <StatusIndicator type="loading">Looking for the emulator</StatusIndicator>
  } else if (health.connection_type === 'aws') {
    content = <Box>This endpoint is real AWS, not an emulator.</Box>
  } else if (!emulator) {
    content = (
      <Box>
        StackPort doesn&apos;t recognise an emulator at {url} right now: it isn&apos;t running, or it isn&apos;t one
        StackPort knows (AWS Emulator, MiniStack, Floci, LocalStack and Moto).
      </Box>
    )
  } else {
    const pairs: KeyValuePairsProps.Pair[] = [{ label: 'Emulator', value: emulatorLabel(emulator) }]
    if (profile) pairs.push({ label: 'Documentation', value: <EmulatorDocsLink name={emulator.name} url={profile.docs_url} /> })
    content = (
      <SpaceBetween size="l">
        <KeyValuePairs columns={2} items={pairs} />
        {profile && (
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: 'Known limits',
                value:
                  profile.limits.length > 0 ? <EmulatorLimitList limits={profile.limits} /> : 'None that StackPort knows of',
              },
            ]}
          />
        )}
      </SpaceBetween>
    )
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={activeEndpoint ? `The emulator behind ${activeEndpoint}, the endpoint you're browsing.` : undefined}
          actions={
            canReset && (
              <Button
                onClick={() => setResetOpen(true)}
                disabled={!health?.writes_enabled}
                disabledReason="Write operations are disabled (STACKPORT_ALLOW_WRITES=false)."
              >
                Reset emulator
              </Button>
            )
          }
        >
          Emulator
        </Header>
      }
    >
      {content}
      {resetOpen && endpoint && emulator && (
        <ResetEmulatorModal endpointName={endpoint.name} url={url} emulator={emulator} onClose={() => setResetOpen(false)} />
      )}
    </Container>
  )
}
