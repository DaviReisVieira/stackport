import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Container from '@cloudscape-design/components/container'
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard'
import Header from '@cloudscape-design/components/header'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import Modal from '@cloudscape-design/components/modal'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { toast } from 'sonner'
import { formatEventTime } from '@/components/cloudscape/activity/activity'
import { exportData } from '@/lib/export'
import type { ActivityEvent } from '@/lib/types'

function text(value: string | null): string {
  return value || '-'
}

function readOnlyText(value: boolean | null): string {
  return value === null ? '-' : value ? 'true' : 'false'
}

/** The parsed record, or for an event whose record isn't a JSON object, the event with the record as sent. */
function exportEvent(event: ActivityEvent) {
  try {
    exportData({ service: 'cloudtrail', resourceType: 'event', data: [event.record ?? { ...event }], format: 'json' })
  } catch (error) {
    toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** One event: what the table shows, every field LookupEvents answered, and the CloudTrail record in full. */
export function ActivityEventModal({ event, onDismiss }: { event: ActivityEvent; onDismiss: () => void }) {
  const recordText = event.record ? JSON.stringify(event.record, null, 2) : event.rawRecord

  return (
    <Modal
      visible
      size="large"
      onDismiss={onDismiss}
      header={
        <Header variant="h1" description={`${event.eventSource} · ${formatEventTime(event.eventTime)}`}>
          {event.eventName}
        </Header>
      }
      footer={
        <Box float="right">
          <Button variant="primary" onClick={onDismiss}>
            Close
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <KeyValuePairs
          columns={3}
          items={[
            { label: 'Event time', value: event.eventTime ?? '-' },
            { label: 'User name', value: text(event.username) },
            { label: 'AWS access key', value: text(event.accessKeyId) },
            { label: 'Event source', value: text(event.eventSource) },
            { label: 'AWS region', value: text(event.awsRegion) },
            { label: 'Source IP address', value: text(event.sourceIpAddress) },
            { label: 'Read-only', value: readOnlyText(event.readOnly) },
            {
              label: 'Error code',
              value: event.errorCode ? <StatusIndicator type="error">{event.errorCode}</StatusIndicator> : '-',
            },
            { label: 'Event ID', value: text(event.eventId) },
          ]}
        />
        <KeyValuePairs
          columns={1}
          items={[
            ...(event.errorMessage ? [{ label: 'Error message', value: event.errorMessage }] : []),
            {
              label: 'Resources',
              value:
                event.resources.length === 0
                  ? '-'
                  : event.resources.map((resource, index) => (
                      <Box key={index}>{[resource.type, resource.name].filter(Boolean).join(': ')}</Box>
                    )),
            },
            { label: 'User agent', value: text(event.userAgent) },
          ]}
        />
        <Container
          header={
            <Header
              variant="h2"
              actions={
                recordText !== null && (
                  <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                    <CopyToClipboard
                      variant="icon"
                      textToCopy={recordText}
                      copyButtonAriaLabel="Copy the event record"
                      copySuccessText="Event record copied"
                      copyErrorText="Could not copy the event record"
                    />
                    <Button iconName="download" onClick={() => exportEvent(event)}>
                      Export JSON
                    </Button>
                  </SpaceBetween>
                )
              }
            >
              Event record
            </Header>
          }
        >
          <SpaceBetween size="s">
            {event.record === null && event.rawRecord !== null && (
              <Alert type="warning">The endpoint sent a CloudTrailEvent that isn't a JSON object, so it's shown as it came.</Alert>
            )}
            {recordText === null ? (
              <Box color="text-body-secondary">The endpoint sent no CloudTrailEvent for this event.</Box>
            ) : (
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-500/20 p-3 text-xs">
                {recordText}
              </pre>
            )}
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </Modal>
  )
}
