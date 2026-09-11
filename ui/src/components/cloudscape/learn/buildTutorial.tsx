import type { TutorialPanelProps } from '@cloudscape-design/components/tutorial-panel'
import type { LearnLesson } from '@/lib/types'
import { resolveHotspotId } from './hotspots'
import { LearnStepContent } from './LearnStepContent'

/**
 * Turn a lesson into a Cloudscape tutorial for AnnotationContext.
 *
 * Build this once per run and never rebuild it: AnnotationContext resets the
 * step index to 0 whenever the tutorial object's identity changes, so
 * rebuilding it after each verification would throw the learner back to step
 * one. Step content is therefore a stable element whose component reads live
 * state from the Learn context rather than being closed over here.
 *
 * `completed` stays false for the same reason it must: AnnotationContext hides
 * every hotspot the moment it sees that flag. The finished state is rendered by
 * the Learn panel instead.
 */
export function buildTutorial(lesson: LearnLesson, fromIndex = 0): TutorialPanelProps.Tutorial {
  const steps: TutorialPanelProps.Step[] = lesson.steps.slice(fromIndex).map((step) => ({
    title: step.title,
    hotspotId: resolveHotspotId(step.console?.hotspotId),
    content: <LearnStepContent lessonId={lesson.id} stepId={step.id} variant="popover" />,
  }))

  return {
    title: lesson.title,
    description: lesson.summary,
    completed: false,
    learnMoreUrl: lesson.docsUrl ?? null,
    tasks: [{ title: lesson.title, steps }],
    completedScreenDescription: lesson.completion?.summary ?? null,
  }
}
