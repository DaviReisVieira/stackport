import { useState } from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import Modal from '@cloudscape-design/components/modal'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Spinner from '@cloudscape-design/components/spinner'
import { CloudscapeShell } from '@/components/cloudscape/CloudscapeShell'
import { LearnLessonCard } from '@/components/cloudscape/learn/LearnLessonCard'
import { useHealth } from '@/hooks/useHealth'
import { useLearn } from '@/hooks/useLearn'

/**
 * The Learn catalogue as a real page.
 *
 * The drawer trigger is one icon in a right rail, which nobody finds on their
 * own, so this is the on-ramp and the link you can send someone.
 */
export default function CloudscapeLearn() {
  const { enabled, loading, trail, completed, resetTrail } = useLearn()
  const { data: health } = useHealth()
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const totalSteps = trail?.lessons.reduce((sum, lesson) => sum + lesson.steps.length, 0) ?? 0
  const doneSteps = Object.values(completed).reduce((sum, steps) => sum + steps.length, 0)

  return (
    <CloudscapeShell activeHref="/learn">
      <ContentLayout
        header={
          <Header
            variant="h1"
            description="Short hands-on lessons against your own emulator. You do the work in the console or the CLI, and StackPort checks the real resource state, so a step only turns green when the thing genuinely exists."
            actions={
              doneSteps > 0 && (
                <Button onClick={() => setConfirmReset(true)} data-testid="learn-reset">
                  Reset progress
                </Button>
              )
            }
          >
            Learn
          </Header>
        }
      >
        <SpaceBetween size="l">
          {health?.connection_type === 'aws' && (
            <Alert type="warning" header="Lessons need a local emulator">
              You are connected to real AWS. Lessons create and delete resources, so they stay disabled
              until you switch to a local endpoint.
            </Alert>
          )}

          {!enabled && (
            <Alert type="info" header="Learn is turned off">
              Start StackPort with <Box variant="code">STACKPORT_LEARN=true</Box> to use the lessons.
            </Alert>
          )}

          {loading && !trail && (
            <Box textAlign="center" padding="xxl">
              <Spinner size="large" />
            </Box>
          )}

          {trail && (
            <>
              <Container header={<Header variant="h2">{trail.title}</Header>}>
                <ColumnLayout columns={2} variant="text-grid">
                  <Box variant="p" color="text-body-secondary">
                    {trail.description}
                  </Box>
                  <ProgressBar
                    value={totalSteps > 0 ? (doneSteps / totalSteps) * 100 : 0}
                    additionalInfo={`${doneSteps} of ${totalSteps} steps done`}
                    label="Your progress"
                  />
                </ColumnLayout>
              </Container>

              <SpaceBetween size="l">
                {trail.lessons.map((lesson) => (
                  <LearnLessonCard key={lesson.id} lesson={lesson} />
                ))}
              </SpaceBetween>

              <Box variant="small" color="text-body-secondary">
                More lessons are on the way: queues, fan-out, logs and metrics, and a table you query rather
                than scan.
              </Box>
            </>
          )}
        </SpaceBetween>
      </ContentLayout>

      <Modal
        visible={confirmReset}
        onDismiss={() => setConfirmReset(false)}
        header="Reset your progress?"
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={resetting}
                onClick={async () => {
                  setResetting(true)
                  try {
                    await resetTrail()
                    setConfirmReset(false)
                  } finally {
                    setResetting(false)
                  }
                }}
                data-testid="learn-reset-confirm"
              >
                Reset progress
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Every step goes back to not done, and the lesson picks fresh resource names. Nothing you created in
        your emulator is deleted.
      </Modal>
    </CloudscapeShell>
  )
}
