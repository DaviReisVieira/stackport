import { useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Container from '@cloudscape-design/components/container'
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard'
import Header from '@cloudscape-design/components/header'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import Pagination from '@cloudscape-design/components/pagination'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { toast } from 'sonner'
import type { ApiError } from '@/lib/api'
import { exportData } from '@/lib/export'
import type { ExplorerRunResponse, JsonObject } from '@/lib/types'

export type RunState =
  | { status: 'running' }
  | { status: 'done'; endpoint: string; result: ExplorerRunResponse }
  | { status: 'failed'; endpoint: string; error: ApiError }

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

function Failure({ error, endpoint }: { error: ApiError; endpoint: string }) {
  const code = error.classified?.code
  return (
    <SpaceBetween size="m">
      <KeyValuePairs
        columns={2}
        items={[
          { label: 'Status', value: <StatusIndicator type="error">{error.status || 'No response'}</StatusIndicator> },
          { label: 'Endpoint', value: endpoint },
        ]}
      />
      <Alert type="error" header={code ?? 'The request failed'}>
        <SpaceBetween size="xs">
          <span className="whitespace-pre-line">{error.message}</span>
          {error.classified?.hint && <Box color="text-body-secondary">{error.classified.hint}</Box>}
        </SpaceBetween>
      </Alert>
    </SpaceBetween>
  )
}

function exportPages(result: ExplorerRunResponse, service: string, operation: string) {
  try {
    const bodies = result.responses.map((page) => page.body).filter((body): body is JsonObject => body !== null)
    exportData({ service, resourceType: operation, data: bodies, format: 'json' })
  } catch (error) {
    toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function Success({
  result,
  endpoint,
  pageIndex,
  onNextPage,
}: {
  result: ExplorerRunResponse
  endpoint: string
  pageIndex: number
  onNextPage: (token: JsonObject) => void
}) {
  const pages = result.responses
  const response = pages[pageIndex - 1]
  const { httpStatusCode, requestId, retryAttempts } = response.metadata

  return (
    <SpaceBetween size="m">
      <KeyValuePairs
        columns={4}
        items={[
          { label: 'Status', value: <StatusIndicator type="success">{httpStatusCode ?? 'OK'}</StatusIndicator> },
          { label: 'Duration', value: formatDuration(result.durationMs) },
          pages.length > 1 ? { label: 'Pages', value: pages.length } : { label: 'Retries', value: retryAttempts ?? 0 },
          { label: 'Endpoint', value: endpoint },
        ]}
      />
      {requestId && (
        <KeyValuePairs
          items={[
            {
              label: 'Request ID',
              value: (
                <CopyToClipboard
                  variant="inline"
                  textToCopy={requestId}
                  wrapText={false}
                  copyButtonAriaLabel="Copy request ID"
                  copySuccessText="Request ID copied"
                  copyErrorText="Could not copy the request ID"
                />
              ),
            },
          ]}
        />
      )}
      {result.notices.map((notice) => (
        <Alert key={notice} type="warning">
          {notice}
        </Alert>
      ))}
      {result.nextToken && (
        <Alert type="info" action={<Button onClick={() => onNextPage(result.nextToken ?? {})}>Fetch next page</Button>}>
          More results are available.
        </Alert>
      )}
      {response.body === null ? (
        <Box color="text-body-secondary">This response is too large to show here.</Box>
      ) : (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-500/20 p-3 text-xs">{JSON.stringify(response.body, null, 2)}</pre>
      )}
    </SpaceBetween>
  )
}

/** What the last run of the operation returned: its status, metadata and JSON, or the endpoint's error. */
export function ResponseView({
  run,
  service,
  operation,
  onNextPage,
}: {
  run: RunState
  service: string
  operation: string
  onNextPage: (token: JsonObject) => void
}) {
  const [pageIndex, setPageIndex] = useState(1)
  const result = run.status === 'done' ? run.result : null
  const pages = result?.responses ?? []
  const body = pages[pageIndex - 1]?.body ?? null

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            result && (
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                {pages.length > 1 && (
                  <Pagination
                    currentPageIndex={pageIndex}
                    pagesCount={pages.length}
                    onChange={({ detail }) => setPageIndex(detail.currentPageIndex)}
                    ariaLabels={{ nextPageLabel: 'Next page', previousPageLabel: 'Previous page', pageLabel: (n) => `Page ${n}` }}
                  />
                )}
                {body !== null && (
                  <CopyToClipboard
                    variant="icon"
                    textToCopy={JSON.stringify(body, null, 2)}
                    copyButtonAriaLabel="Copy response"
                    copySuccessText="Response copied"
                    copyErrorText="Could not copy the response"
                  />
                )}
                <Button iconName="download" onClick={() => exportPages(result, service, operation)}>
                  Export JSON
                </Button>
              </SpaceBetween>
            )
          }
        >
          {pages.length > 1 ? `Response, page ${pageIndex} of ${pages.length}` : 'Response'}
        </Header>
      }
    >
      {run.status === 'running' && <StatusIndicator type="loading">Running {operation}</StatusIndicator>}
      {run.status === 'failed' && <Failure error={run.error} endpoint={run.endpoint} />}
      {run.status === 'done' && <Success result={run.result} endpoint={run.endpoint} pageIndex={pageIndex} onNextPage={onNextPage} />}
    </Container>
  )
}
