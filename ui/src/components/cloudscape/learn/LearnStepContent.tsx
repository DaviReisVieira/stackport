import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Link from '@cloudscape-design/components/link'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Tabs from '@cloudscape-design/components/tabs'
import { useLearn } from '@/hooks/useLearn'
import type { LearnStep } from '@/lib/types'
import { Prose } from './Prose'

const PATH_PREFERENCE_KEY = 'stackport.learn.path'

type Variant = 'popover' | 'panel'

/**
 * One lesson step, rendered twice at once: compact inside the hotspot popover
 * that points at the control, and in full inside the Learn panel. The popover
 * nudges, the panel explains, which is also the only way the CLI block and its
 * notes fit anywhere readable.
 *
 * All state lives in the Learn context, because both copies are mounted
 * simultaneously and must agree.
 */
export function LearnStepContent({
  lessonId,
  stepId,
  variant,
}: {
  lessonId: string
  stepId: string
  variant: Variant
}) {
  const { run, stepStateFor, verifyStep, markStep, isStepDone, isStepSkipped, setDrawerOpen } = useLearn()
  const step = run?.lesson.id === lessonId ? run.lesson.steps.find((s) => s.id === stepId) : undefined
  if (!step) return null

  const state = stepStateFor(stepId)
  const done = isStepDone(lessonId, stepId)
  const skipped = isStepSkipped(lessonId, stepId)

  return (
    <SpaceBetween size="s">
      {variant === 'panel' ? (
        <Prose text={step.instruction} />
      ) : (
        <Prose text={step.instruction.split('\n\n')[0]} small />
      )}

      {variant === 'panel' ? (
        <StepPaths step={step} />
      ) : (
        step.console && <ConsoleFields step={step} />
      )}

      <StepActions
        step={step}
        lessonId={lessonId}
        variant={variant}
        done={done}
        skipped={skipped}
        checking={state.checking}
        onVerify={() => verifyStep(step)}
        onMark={() => markStep(step)}
      />

      <StepResult step={step} state={state} done={done} skipped={skipped} />

      {variant === 'popover' && (step.commands?.cli || step.whyItMatters) && (
        <Box variant="small" color="text-body-secondary">
          <Link
            variant="secondary"
            onFollow={(event) => {
              event.preventDefault()
              setDrawerOpen(true)
            }}
          >
            The CLI command and the details are in the Learn panel
          </Link>
        </Box>
      )}

      {variant === 'panel' && step.whyItMatters && (
        <ExpandableSection headerText="Why this matters" variant="footer">
          <Prose text={step.whyItMatters} small />
        </ExpandableSection>
      )}

      {variant === 'panel' && step.docsUrl && (
        <Box variant="small">
          <Link external href={step.docsUrl} variant="primary">
            AWS documentation for this step
          </Link>
        </Box>
      )}
    </SpaceBetween>
  )
}

/** Console and CLI as tabs, so the learner picks a path instead of being given one. */
function StepPaths({ step }: { step: LearnStep }) {
  const [activeTab, setActiveTab] = useState(() => {
    const stored = localStorage.getItem(PATH_PREFERENCE_KEY)
    if (stored === 'cli' && step.commands?.cli) return 'cli'
    return step.console ? 'console' : 'cli'
  })

  const tabs = []
  if (step.console) {
    tabs.push({ id: 'console', label: 'Do it here', content: <ConsolePath step={step} /> })
  }
  if (step.commands?.cli) {
    tabs.push({ id: 'cli', label: 'With the CLI', content: <CliPath step={step} /> })
  }
  if (tabs.length === 0) return null
  if (tabs.length === 1) return <div>{tabs[0].content}</div>

  return (
    <Tabs
      tabs={tabs}
      activeTabId={tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0].id}
      onChange={({ detail }) => {
        setActiveTab(detail.activeTabId)
        localStorage.setItem(PATH_PREFERENCE_KEY, detail.activeTabId)
      }}
      variant="container"
    />
  )
}

function ConsolePath({ step }: { step: LearnStep }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const consolePath = step.console
  if (!consolePath) return null
  const elsewhere = consolePath.route !== pathname

  return (
    <SpaceBetween size="s">
      <Box variant="p" color="text-body-secondary" padding="n">
        {consolePath.label}
      </Box>
      <ConsoleFields step={step} />
      {elsewhere && (
        <Button iconName="angle-right" onClick={() => navigate(consolePath.route)}>
          Take me there
        </Button>
      )}
    </SpaceBetween>
  )
}

/** The exact values to type, copyable, so nobody fails a step over a typo. */
function ConsoleFields({ step }: { step: LearnStep }) {
  const fields = step.console?.fields
  if (!fields || fields.length === 0) return null

  return (
    <SpaceBetween size="xxs">
      {fields.map((field) => (
        <div key={field.label} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Box variant="awsui-key-label">{field.label}</Box>
          <Box variant="code">{field.value}</Box>
          <CopyToClipboard
            copyButtonAriaLabel={`Copy ${field.label}`}
            textToCopy={field.value}
            variant="icon"
            copySuccessText={`${field.label} copied`}
            copyErrorText={`Could not copy ${field.label}`}
          />
        </div>
      ))}
    </SpaceBetween>
  )
}

function CliPath({ step }: { step: LearnStep }) {
  const cli = step.commands?.cli
  if (!cli) return null

  return (
    <SpaceBetween size="s">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Box variant="code" padding="n">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{cli}</pre>
        </Box>
        <CopyToClipboard
          copyButtonAriaLabel="Copy command"
          textToCopy={cli}
          variant="icon"
          copySuccessText="Command copied"
          copyErrorText="Could not copy the command"
        />
      </div>
      {step.cliNotes && step.cliNotes.length > 0 && (
        <ExpandableSection headerText="What each part does" variant="footer">
          <SpaceBetween size="xs">
            {step.cliNotes.map((note) => (
              <div key={note.flag}>
                <Box variant="code">{note.flag}</Box>
                <Prose text={note.note} small />
              </div>
            ))}
          </SpaceBetween>
        </ExpandableSection>
      )}
    </SpaceBetween>
  )
}

function StepActions({
  step,
  variant,
  done,
  skipped,
  checking,
  onVerify,
  onMark,
}: {
  step: LearnStep
  lessonId: string
  variant: Variant
  done: boolean
  skipped: boolean
  checking: boolean
  onVerify: () => void
  onMark: () => void
}) {
  if (done && !skipped) return null

  if (!step.verify) {
    return (
      <Button variant="primary" onClick={onMark} data-testid={`learn-mark-${step.id}`}>
        Mark as done
      </Button>
    )
  }

  return (
    <SpaceBetween size="xs" direction="horizontal">
      <Button variant="primary" loading={checking} onClick={onVerify} data-testid={`learn-verify-${step.id}`}>
        {skipped ? 'Check it now' : 'Check my work'}
      </Button>
      {variant === 'panel' && !skipped && (
        <Button variant="link" onClick={onMark} data-testid={`learn-skip-${step.id}`}>
          Skip
        </Button>
      )}
    </SpaceBetween>
  )
}

/**
 * Three outcomes, three different things to say. A step that has not happened
 * yet is not a failure, and the word never appears.
 */
function StepResult({
  step,
  state,
  done,
  skipped,
}: {
  step: LearnStep
  state: { checking: boolean; result: { passed: boolean; verifyStatus: string; message: string } | null; error: string | null }
  done: boolean
  skipped: boolean
}) {
  if (done && !skipped) {
    return <StatusIndicator type="success">{state.result?.message ?? 'Done'}</StatusIndicator>
  }
  if (skipped) {
    return (
      <StatusIndicator type="info">
        Skipped. Come back and check it whenever you like.
      </StatusIndicator>
    )
  }
  if (state.error) {
    return <Alert type="error">{state.error}</Alert>
  }
  if (!state.result || state.result.passed) return null

  if (state.result.verifyStatus === 'service_unreachable') {
    return (
      <Alert type="warning" header="Cannot reach your emulator">
        StackPort could not talk to the endpoint, so there is nothing to check yet. Make sure your emulator
        is running, then try again.
      </Alert>
    )
  }

  return (
    <Alert type="info" header="Not there yet">
      <SpaceBetween size="xs">
        <Box variant="p" padding="n">
          {state.result.message}
        </Box>
        {step.hint && (
          <ExpandableSection headerText="Give me a hint" variant="footer">
            <Prose text={step.hint} small />
          </ExpandableSection>
        )}
      </SpaceBetween>
    </Alert>
  )
}
