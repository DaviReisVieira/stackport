import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Spinner from '@cloudscape-design/components/spinner'
import Steps from '@cloudscape-design/components/steps'
import { useNavigate } from 'react-router-dom'
import { useHealth } from '@/hooks/useHealth'
import { useLearn } from '@/hooks/useLearn'
import { LearnLessonCard } from './LearnLessonCard'
import { LearnStepContent } from './LearnStepContent'
import { LearnVariableEditor } from './LearnVariableEditor'

/**
 * The Learn panel, docked in the layout's right rail the way the AWS console
 * docks its own tutorials: the catalogue when nothing is running, and the
 * lesson's spine plus the current step while one is.
 */
export function LearnDrawer() {
  const { loading, trail, run, exitLesson } = useLearn()
  const { data: health } = useHealth()

  if (loading && !trail) {
    return (
      <Box padding="l" textAlign="center">
        <Spinner /> <Box variant="span">Loading lessons</Box>
      </Box>
    )
  }

  if (health?.connection_type === 'aws') {
    return (
      <Box padding="l">
        <Alert type="warning" header="Not against real AWS">
          Lessons create and delete resources, so they only run against a local emulator. Switch to a local
          endpoint to use them.
        </Alert>
      </Box>
    )
  }

  if (!trail) {
    return (
      <Box padding="l">
        <Alert type="info" header="No lessons loaded">
          StackPort could not read its trail content. Restart it, and if it keeps happening please open an
          issue.
        </Alert>
      </Box>
    )
  }

  if (run) return <RunningLesson onExit={exitLesson} />

  return (
    <div style={{ padding: 20 }}>
      <SpaceBetween size="l">
        <Header variant="h2" description={trail.description}>
          {trail.title}
        </Header>
        <SpaceBetween size="m">
          {trail.lessons.map((lesson) => (
            <LearnLessonCard key={lesson.id} lesson={lesson} />
          ))}
        </SpaceBetween>
      </SpaceBetween>
    </div>
  )
}

function RunningLesson({ onExit }: { onExit: () => void }) {
  const navigate = useNavigate()
  const { run, stepIndex, isStepDone, isStepSkipped } = useLearn()
  if (!run) return null

  const { lesson } = run
  const doneCount = lesson.steps.filter((step) => isStepDone(lesson.id, step.id)).length
  const allDone = doneCount === lesson.steps.length
  const currentStep = lesson.steps[stepIndex]

  return (
    <div style={{ padding: 20 }}>
      <SpaceBetween size="l">
        <Header
          variant="h2"
          actions={<Button variant="icon" iconName="close" ariaLabel="Leave the lesson" onClick={onExit} />}
        >
          {lesson.title}
        </Header>

        <ProgressBar
          value={(doneCount / lesson.steps.length) * 100}
          additionalInfo={`${doneCount} of ${lesson.steps.length} steps done`}
          label="Progress"
        />

        <Steps
          steps={lesson.steps.map((step, index) => ({
            status: isStepSkipped(lesson.id, step.id)
              ? ('info' as const)
              : isStepDone(lesson.id, step.id)
                ? ('success' as const)
                : index === stepIndex
                  ? ('in-progress' as const)
                  : ('pending' as const),
            header: step.title,
            statusIconAriaLabel: isStepDone(lesson.id, step.id) ? 'Done' : 'Not done',
          }))}
        />

        {allDone ? (
          <LessonComplete onExit={onExit} onBrowse={() => navigate(`/resources/${lesson.service ?? 's3'}`)} />
        ) : (
          currentStep && (
            <div data-testid="learn-current-step">
              <Box variant="h4" padding={{ bottom: 'xs' }}>
                {`Step ${stepIndex + 1}: ${currentStep.title}`}
              </Box>
              <LearnStepContent lessonId={lesson.id} stepId={currentStep.id} variant="panel" />
            </div>
          )
        )}

        <LearnVariableEditor lesson={lesson} />

        <Box variant="small">
          <Link
            href="/learn"
            onFollow={(event) => {
              event.preventDefault()
              navigate('/learn')
            }}
          >
            All lessons and progress
          </Link>
        </Box>
      </SpaceBetween>
    </div>
  )
}

/** Celebration is information: what exists now, by name, and where to go see it. */
function LessonComplete({ onExit, onBrowse }: { onExit: () => void; onBrowse: () => void }) {
  const { run } = useLearn()
  const completion = run?.lesson.completion

  return (
    <Alert type="success" header={completion?.title ?? 'Lesson complete'}>
      <SpaceBetween size="s">
        {completion?.summary && <Box variant="p">{completion.summary}</Box>}
        {completion?.takeaways && (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {completion.takeaways.map((takeaway) => (
              <li key={takeaway}>{takeaway}</li>
            ))}
          </ul>
        )}
        {completion?.nextHint && (
          <Box variant="small" color="text-body-secondary">
            {completion.nextHint}
          </Box>
        )}
        <SpaceBetween size="xs" direction="horizontal">
          <Button onClick={onBrowse}>Go look at what you built</Button>
          <Button variant="link" onClick={onExit}>
            Close
          </Button>
        </SpaceBetween>
      </SpaceBetween>
    </Alert>
  )
}
