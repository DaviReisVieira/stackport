import { useState } from 'react'
import Box from '@cloudscape-design/components/box'
import Checkbox from '@cloudscape-design/components/checkbox'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Tabs from '@cloudscape-design/components/tabs'
import { CliSetupBlock } from '@/components/cloudscape/learn/CliSetupBlock'
import { CopyableCode } from '@/components/cloudscape/learn/CopyableCode'
import type { ExplorerOperation, JsonObject, JsonValue, LearnCliSetup } from '@/lib/types'
import { JsonField, ParameterForm } from './ParameterForm'
import type { FieldDraft, ReportDraft } from './ParameterForm'
import { isObject, rootStructure, sameJson } from './shapes'
import { awsCliCommand, boto3Snippet } from './snippets'
import type { SnippetTarget } from './snippets'

export const MAX_PAGES = 50

/** The names the JSON view and the page count keep their drafts under, next to the parameters' own. */
export const REQUEST_JSON = 'request JSON'
export const MAX_PAGES_FIELD = 'most pages'

const EMPTY_REQUEST: JsonObject = {}

export interface PageOptions {
  paginate: boolean
  maxPages: number
}

function Snippet({ text, copyLabel, setup }: { text: string; copyLabel: string; setup: LearnCliSetup | null }) {
  return (
    <SpaceBetween size="s">
      {setup && <CliSetupBlock setup={setup} />}
      <CopyableCode text={text} copyLabel={copyLabel} />
    </SpaceBetween>
  )
}

/**
 * The request for one operation, as a form, as JSON, and as the AWS CLI command
 * and boto3 code that make the same call.
 *
 * The form and the JSON view edit the same parameters. Text one of them can't
 * send yet is a draft the page keeps, so it outlives a tab switch; a change
 * from the other view to what a draft is about replaces the draft.
 */
export function RequestEditor({
  operation,
  params,
  drafts,
  showRequired,
  pages,
  target,
  cliSetup,
  onParamsChange,
  onPagesChange,
  onDraft,
}: {
  operation: ExplorerOperation
  params: JsonObject
  drafts: Record<string, FieldDraft>
  showRequired: boolean
  pages: PageOptions
  target: SnippetTarget
  /** Shell setup the endpoint's emulator needs before copied commands work */
  cliSetup: LearnCliSetup | null
  onParamsChange: (params: JsonObject) => void
  onPagesChange: (pages: PageOptions) => void
  onDraft: ReportDraft
}) {
  const [tab, setTab] = useState('form')
  const graph = operation.input
  const root = rootStructure(graph)
  const snippet = { operation, params, paginate: pages.paginate }
  const streamsEvents = operation.eventStreamInput || operation.eventStreamOutput

  const fromForm = (next: JsonObject) => {
    onDraft(REQUEST_JSON, null)
    onParamsChange(next)
  }
  const fromJson = (value: JsonValue | undefined) => {
    const next = isObject(value) ? value : EMPTY_REQUEST
    for (const name of Object.keys(drafts)) {
      if (name in params || name in next) {
        if (!sameJson(params[name], next[name])) onDraft(name, null)
      }
    }
    onParamsChange(next)
  }

  return (
    <SpaceBetween size="m">
      <Tabs
        activeTabId={tab}
        onChange={({ detail }) => setTab(detail.activeTabId)}
        tabs={[
          {
            id: 'form',
            label: 'Form',
            content:
              graph && root ? (
                <ParameterForm
                  graph={graph}
                  root={root}
                  params={params}
                  drafts={drafts}
                  showRequired={showRequired}
                  onChange={fromForm}
                  onDraft={onDraft}
                />
              ) : (
                <Box color="text-body-secondary">This operation takes no parameters.</Box>
              ),
          },
          {
            id: 'json',
            label: 'JSON',
            content:
              graph && root ? (
                <FormField
                  label="Request"
                  description="The whole request as boto3 takes it. Changes here show up in the form."
                  errorText={drafts[REQUEST_JSON]?.error}
                  stretch
                >
                  <JsonField
                    name={REQUEST_JSON}
                    shape={root}
                    graph={graph}
                    shapeName={graph.root}
                    value={params}
                    draft={drafts[REQUEST_JSON]}
                    emptyValue={EMPTY_REQUEST}
                    rows={16}
                    onChange={fromJson}
                    onDraft={onDraft}
                  />
                </FormField>
              ) : (
                <Box color="text-body-secondary">This operation takes no parameters.</Box>
              ),
          },
          {
            id: 'cli',
            label: 'AWS CLI',
            content: streamsEvents ? (
              <Box color="text-body-secondary">The AWS CLI doesn't run operations that stream events.</Box>
            ) : (
              <Snippet text={awsCliCommand(snippet, target)} copyLabel="AWS CLI command" setup={cliSetup} />
            ),
          },
          {
            id: 'boto3',
            label: 'Python (boto3)',
            content: operation.eventStreamInput ? (
              <Box color="text-body-secondary">boto3 can't send a stream of events to an operation.</Box>
            ) : (
              <Snippet text={boto3Snippet(snippet, target)} copyLabel="boto3 code" setup={cliSetup} />
            ),
          },
        ]}
      />
      {operation.pagination && (
        <SpaceBetween direction="horizontal" size="m" alignItems="center">
          <Checkbox
            checked={pages.paginate}
            onChange={({ detail }) => {
              if (!detail.checked) onDraft(MAX_PAGES_FIELD, null)
              onPagesChange({ ...pages, paginate: detail.checked })
            }}
            description="Keep calling with each response's next token"
          >
            Follow pages
          </Checkbox>
          <FormField label="Up to" errorText={drafts[MAX_PAGES_FIELD]?.error}>
            <Input
              type="number"
              inputMode="numeric"
              value={drafts[MAX_PAGES_FIELD]?.text ?? String(pages.maxPages)}
              disabled={!pages.paginate}
              ariaLabel="Most pages to follow"
              onChange={({ detail }) => {
                const count = Number(detail.value)
                if (Number.isInteger(count) && count >= 1 && count <= MAX_PAGES) {
                  onDraft(MAX_PAGES_FIELD, null)
                  onPagesChange({ ...pages, maxPages: count })
                } else {
                  onDraft(MAX_PAGES_FIELD, { text: detail.value, error: `Enter 1 to ${MAX_PAGES} pages.` })
                }
              }}
            />
          </FormField>
        </SpaceBetween>
      )}
    </SpaceBetween>
  )
}
