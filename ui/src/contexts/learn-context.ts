import { createContext } from 'react'
import type { TutorialPanelProps } from '@cloudscape-design/components/tutorial-panel'
import type {
  LearnCompleted,
  LearnLesson,
  LearnStep,
  LearnTrail,
  LearnVariables,
  LearnVerifyResponse,
} from '@/lib/types'

/** Result of the last verification attempt for one step. */
export interface LearnStepState {
  checking: boolean
  result: LearnVerifyResponse | null
  error: string | null
}

export interface LearnRun {
  lesson: LearnLesson
  /** Handed to AnnotationContext. Always completed: false, or the hotspots vanish. */
  tutorial: TutorialPanelProps.Tutorial
  /**
   * Index of the lesson step the tutorial's own step 0 corresponds to.
   *
   * AnnotationContext always starts a tutorial at its first step and keeps the
   * index private, so resuming mid lesson means handing it a tutorial that
   * begins at the resumed step and translating indices back with this.
   */
  offset: number
}

export interface LearnContextValue {
  enabled: boolean
  loading: boolean
  trail: LearnTrail | null
  completed: LearnCompleted
  skipped: LearnCompleted
  variables: LearnVariables

  /** The lesson currently being walked through, or null. */
  run: LearnRun | null
  stepIndex: number
  /** First step of the running lesson that is not yet done. */
  frontier: number

  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void

  startLesson: (lessonId: string) => void
  exitLesson: () => void
  onStepChange: (index: number, reason: string) => void

  stepStateFor: (stepId: string) => LearnStepState
  verifyStep: (step: LearnStep) => Promise<void>
  markStep: (step: LearnStep) => Promise<void>
  setVariable: (lessonId: string, name: string, value: string) => Promise<void>
  resetTrail: () => Promise<void>

  isStepDone: (lessonId: string, stepId: string) => boolean
  isStepSkipped: (lessonId: string, stepId: string) => boolean
  /**
   * True only while a tutorial is running, for an id that belongs to it, and
   * for a step at or before the frontier. That single predicate is what gates
   * Next on verification: Cloudscape enables Next when the next step's hotspot
   * is mounted, so an unverified step simply does not mount the next anchor.
   */
  isHotspotActive: (hotspotId: string) => boolean
}

const noop = () => {}
const asyncNoop = async () => {}

export const LearnContext = createContext<LearnContextValue>({
  enabled: false,
  loading: false,
  trail: null,
  completed: {},
  skipped: {},
  variables: {},
  run: null,
  stepIndex: 0,
  frontier: 0,
  drawerOpen: false,
  setDrawerOpen: noop,
  startLesson: noop,
  exitLesson: noop,
  onStepChange: noop,
  stepStateFor: () => ({ checking: false, result: null, error: null }),
  verifyStep: asyncNoop,
  markStep: asyncNoop,
  setVariable: asyncNoop,
  resetTrail: asyncNoop,
  isStepDone: () => false,
  isStepSkipped: () => false,
  isHotspotActive: () => false,
})
