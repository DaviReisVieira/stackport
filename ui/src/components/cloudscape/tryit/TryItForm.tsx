import { useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Container from '@cloudscape-design/components/container'
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import FormField from '@cloudscape-design/components/form-field'
import Grid from '@cloudscape-design/components/grid'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import SegmentedControl from '@cloudscape-design/components/segmented-control'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Textarea from '@cloudscape-design/components/textarea'
import { ApiError, sendTryItRequest } from '@/lib/api'
import type { TryItMethod, TryItNameValue, TryItResponse, TryItTarget } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'

const METHODS: TryItMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const BODY_METHODS: ReadonlySet<TryItMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** What the last send to `target` gave. */
type Outcome = { target: string } & ({ ok: true; response: TryItResponse } | { ok: false; error: Error })

function statusType(status: number): StatusIndicatorProps.Type {
  if (status < 300) return 'success'
  if (status < 400) return 'info'
  if (status < 500) return 'warning'
  return 'error'
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The body as it came back: JSON indented, other text as it is, anything else as base64. */
function shownBody(response: TryItResponse): string {
  if (response.bodyText === null) return response.bodyBase64 ?? ''
  try {
    return JSON.stringify(JSON.parse(response.bodyText), null, 2)
  } catch {
    return response.bodyText
  }
}

function HeaderTable({ headers }: { headers: [string, string][] }) {
  return (
    <Table
      variant="embedded"
      items={headers.map(([name, value], index) => ({ name, value, index }))}
      trackBy="index"
      empty={<Box textAlign="center">No headers</Box>}
      columnDefinitions={[
        { id: 'name', header: 'Name', cell: (header) => header.name },
        { id: 'value', header: 'Value', cell: (header) => <span className="break-all">{header.value}</span> },
      ]}
    />
  )
}

function ResponseView({ response }: { response: TryItResponse }) {
  const [view, setView] = useState('body')
  return (
    <Container header={<Header variant="h3">Response</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={3}
          items={[
            {
              label: 'Status',
              value: (
                <StatusIndicator type={statusType(response.status)}>
                  {`${response.status} ${response.reason}`.trim()}
                </StatusIndicator>
              ),
            },
            { label: 'Time', value: formatDuration(response.durationMs) },
            { label: 'Size', value: formatBytes(response.bodyBytes) },
          ]}
        />
        {response.notices.map((notice) => (
          <Alert key={notice} type="info">
            {notice}
          </Alert>
        ))}
        <SegmentedControl
          selectedId={view}
          onChange={({ detail }) => setView(detail.selectedId)}
          label="Response part"
          options={[
            { id: 'body', text: 'Body' },
            { id: 'headers', text: `Headers (${response.headers.length})` },
            { id: 'request', text: 'Request' },
          ]}
        />
        {view === 'body' &&
          (response.bodyBytes === 0 ? (
            <Box color="text-body-secondary">No body</Box>
          ) : (
            <SpaceBetween size="xs">
              {response.bodyText === null && <Box color="text-body-secondary">Binary body, shown as base64</Box>}
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-500/20 p-3 text-xs">
                {shownBody(response)}
              </pre>
            </SpaceBetween>
          ))}
        {view === 'headers' && <HeaderTable headers={response.headers} />}
        {view === 'request' && (
          <SpaceBetween size="s">
            <CopyToClipboard
              variant="inline"
              textToCopy={response.request.url}
              copyButtonAriaLabel="Copy request URL"
              copySuccessText="URL copied"
              copyErrorText="Could not copy the URL"
            />
            <HeaderTable headers={response.request.headers} />
          </SpaceBetween>
        )}
      </SpaceBetween>
    </Container>
  )
}

function NameValueEditor({
  items,
  onChange,
  addText,
  empty,
}: {
  items: TryItNameValue[]
  onChange: (items: TryItNameValue[]) => void
  addText: string
  empty: string
}) {
  const update = (index: number, change: Partial<TryItNameValue>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...change } : item)))
  return (
    <AttributeEditor
      items={items}
      onAddButtonClick={() => onChange([...items, { name: '', value: '' }])}
      onRemoveButtonClick={({ detail }) => onChange(items.filter((_, i) => i !== detail.itemIndex))}
      addButtonText={addText}
      removeButtonText="Remove"
      empty={empty}
      definition={[
        {
          label: 'Name',
          control: (item, index) => (
            <Input value={item.name} onChange={({ detail }) => update(index, { name: detail.value })} />
          ),
        },
        {
          label: 'Value',
          control: (item, index) => (
            <Input value={item.value} onChange={({ detail }) => update(index, { value: detail.value })} />
          ),
        },
      ]}
    />
  )
}

/**
 * Compose a request to a stage or function URL, send it through StackPort, and show the answer.
 *
 * `url` is where the backend sends it (shown so it can be copied). On AWS the
 * request runs real code, so sending asks first.
 */
export function TryItForm({ target, url, realAws }: { target: TryItTarget; url: string; realAws: boolean }) {
  const { activeEndpoint } = useEndpoint()
  const [method, setMethod] = useState<TryItMethod>('GET')
  const [path, setPath] = useState('/')
  const [query, setQuery] = useState<TryItNameValue[]>([])
  const [headers, setHeaders] = useState<TryItNameValue[]>([])
  const [body, setBody] = useState('')
  const [confirmingFor, setConfirmingFor] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null)

  // Switching stage or URL keeps the request, not the previous target's answer
  const targetKey = JSON.stringify(target)
  const outcome = lastOutcome?.target === targetKey ? lastOutcome : null
  const confirming = confirmingFor === targetKey
  const hasBody = BODY_METHODS.has(method)

  const send = async () => {
    setConfirmingFor(null)
    setSending(true)
    try {
      const response = await sendTryItRequest(
        target,
        {
          method,
          path: path.trim() || '/',
          query: query.filter((pair) => pair.name.trim()),
          headers: headers.filter((pair) => pair.name.trim()),
          body: hasBody && body !== '' ? body : null,
          confirmed: realAws,
        },
        activeEndpoint,
      )
      setLastOutcome({ target: targetKey, ok: true, response })
    } catch (error) {
      setLastOutcome({ target: targetKey, ok: false, error: error instanceof Error ? error : new Error(String(error)) })
    } finally {
      setSending(false)
    }
  }

  return (
    <SpaceBetween size="m">
      <FormField label="Address" description="Where StackPort sends the request; the path below is added to it.">
        <CopyToClipboard
          variant="inline"
          textToCopy={url}
          copyButtonAriaLabel="Copy address"
          copySuccessText="Address copied"
          copyErrorText="Could not copy the address"
        />
      </FormField>
      <Grid gridDefinition={[{ colspan: { default: 12, xs: 3 } }, { colspan: { default: 12, xs: 9 } }]}>
        <FormField label="Method">
          <Select
            selectedOption={{ value: method, label: method }}
            onChange={({ detail }) => setMethod(detail.selectedOption.value as TryItMethod)}
            options={METHODS.map((m) => ({ value: m, label: m }))}
          />
        </FormField>
        <FormField label="Path">
          <Input value={path} onChange={({ detail }) => setPath(detail.value)} placeholder="/" ariaLabel="Path" />
        </FormField>
      </Grid>
      <ExpandableSection headerText={`Query parameters (${query.length})`}>
        <NameValueEditor items={query} onChange={setQuery} addText="Add parameter" empty="No query parameters" />
      </ExpandableSection>
      <ExpandableSection headerText={`Headers (${headers.length})`}>
        <NameValueEditor items={headers} onChange={setHeaders} addText="Add header" empty="No headers" />
      </ExpandableSection>
      {hasBody && (
        <FormField label="Body" stretch>
          <Textarea value={body} onChange={({ detail }) => setBody(detail.value)} rows={6} spellcheck={false} />
        </FormField>
      )}
      {confirming ? (
        <Alert
          type="warning"
          header="Send this request to AWS?"
          action={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setConfirmingFor(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void send()}>
                Send to AWS
              </Button>
            </SpaceBetween>
          }
        >
          It runs this resource's code on your AWS account, which can change data and incur costs.
        </Alert>
      ) : (
        <Button variant="primary" loading={sending} onClick={() => (realAws ? setConfirmingFor(targetKey) : void send())}>
          Send
        </Button>
      )}
      {outcome?.ok === true && <ResponseView response={outcome.response} />}
      {outcome?.ok === false && (
        <Alert type="error" header="The request wasn't sent or got no answer">
          <SpaceBetween size="xs">
            <span>{outcome.error.message}</span>
            {outcome.error instanceof ApiError && outcome.error.classified?.hint && (
              <Box color="text-body-secondary">{outcome.error.classified.hint}</Box>
            )}
          </SpaceBetween>
        </Alert>
      )}
    </SpaceBetween>
  )
}
