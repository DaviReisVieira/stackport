import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import { useLearn } from '@/hooks/useLearn'
import type { LearnLesson } from '@/lib/types'
import { LearnVariableEditor } from './LearnVariableEditor'

/** A lesson in the catalogue: what it teaches, how far along you are, and one button. */
export function LearnLessonCard({ lesson, showVariables = true }: { lesson: LearnLesson; showVariables?: boolean }) {
  const { startLesson, isStepDone } = useLearn()
  const doneCount = lesson.steps.filter((step) => isStepDone(lesson.id, step.id)).length
  const finished = doneCount === lesson.steps.length
  const started = doneCount > 0

  return (
    <Container
      header={
        <Header
          variant="h3"
          description={lesson.summary}
          actions={
            <Button
              variant={finished ? 'normal' : 'primary'}
              onClick={() => startLesson(lesson.id)}
              data-testid={`learn-start-${lesson.id}`}
            >
              {finished ? 'Do it again' : started ? 'Continue' : 'Start lesson'}
            </Button>
          }
        >
          {lesson.title}
        </Header>
      }
    >
      <SpaceBetween size="s">
        <SpaceBetween size="xs" direction="horizontal">
          {lesson.service && <Badge>{lesson.service}</Badge>}
          {lesson.level && <Badge color="blue">{lesson.level}</Badge>}
          {lesson.durationMinutes && (
            <Box variant="small" color="text-body-secondary">
              {`about ${lesson.durationMinutes} min`}
            </Box>
          )}
          <Box variant="small" color="text-body-secondary">
            {`${lesson.steps.length} steps`}
          </Box>
        </SpaceBetween>

        {finished ? (
          <StatusIndicator type="success">You finished this one</StatusIndicator>
        ) : (
          started && (
            <ProgressBar
              value={(doneCount / lesson.steps.length) * 100}
              additionalInfo={`${doneCount} of ${lesson.steps.length} steps done`}
              label="Progress"
            />
          )
        )}

        {showVariables && <LearnVariableEditor lesson={lesson} />}
      </SpaceBetween>
    </Container>
  )
}
