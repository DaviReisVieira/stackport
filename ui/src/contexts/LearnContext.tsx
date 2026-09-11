import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AnnotationContext from '@cloudscape-design/components/annotation-context'
import { toast } from 'sonner'
import { LearnContext } from '@/contexts/learn-context'
import type { LearnRun, LearnStepState } from '@/contexts/learn-context'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useHealth } from '@/hooks/useHealth'
import {
  fetchLearnTrail,
  markLearnStep,
  resetLearnProgress,
  setLearnVariable,
  verifyLearnStep,
} from '@/lib/api'
import type { LearnCompleted, LearnStep, LearnTrail, LearnVariables } from '@/lib/types'
import { buildTutorial } from '@/components/cloudscape/learn/buildTutorial'
import { FALLBACK_HOTSPOT_ID, resolveHotspotId } from '@/components/cloudscape/learn/hotspots'

const TRAIL_ID = 'aws-first-steps'
const AUTO_VERIFY_INTERVAL_MS = 3000
const AUTO_VERIFY_MAX_ATTEMPTS = 40

const EMPTY_STEP_STATE: LearnStepState = { checking: false, result: null, error: null }


/**
 * Owns every piece of tutorial state, and renders AnnotationContext.
 *
 * This lives above the router on purpose. Each page renders its own
 * CloudscapeShell, so a shell-level AnnotationContext would remount on every
 * navigation and reset the step index, making a tutorial that crosses pages
 * impossible. The integration test for cross-page advance is what keeps that
 * from being undone.
 */
export function LearnProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { activeEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const enabled = health?.learn_enabled === true

  const [trail, setTrail] = useState<LearnTrail | null>(null)
  const [completed, setCompleted] = useState<LearnCompleted>({})
  const [skipped, setSkipped] = useState<LearnCompleted>({})
  const [variables, setVariables] = useState<LearnVariables>({})
  const [loading, setLoading] = useState(false)

  // AnnotationContext holds on to the onStepChange handler it was given, so
  // reading pathname from the render closure there yields the route the lesson
  // was started from. Every step change would then "navigate" to the step's
  // route, wiping any query string the learner had built up (the open bucket,
  // for instance). A ref is always current.
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  const [run, setRun] = useState<LearnRun | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [stepStates, setStepStates] = useState<Record<string, LearnStepState>>({})

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const data = await fetchLearnTrail(TRAIL_ID, activeEndpoint)
      setTrail(data.trail)
      setCompleted(data.completed ?? {})
      setSkipped(data.skipped ?? {})
      setVariables(data.variables ?? {})
    } catch {
      setTrail(null)
    } finally {
      setLoading(false)
    }
  }, [enabled, activeEndpoint])

  useEffect(() => {
    void load()
  }, [load])

  const isStepDone = useCallback(
    (lessonId: string, stepId: string) => (completed[lessonId] ?? []).includes(stepId),
    [completed],
  )
  const isStepSkipped = useCallback(
    (lessonId: string, stepId: string) => (skipped[lessonId] ?? []).includes(stepId),
    [skipped],
  )

  /** First step of the running lesson that is not done. Everything gates on this. */
  const frontier = useMemo(() => {
    if (!run) return 0
    const index = run.lesson.steps.findIndex((step) => !isStepDone(run.lesson.id, step.id))
    return index === -1 ? run.lesson.steps.length - 1 : index
  }, [run, isStepDone])

  const startLesson = useCallback(
    (lessonId: string) => {
      const lesson = trail?.lessons.find((l) => l.id === lessonId)
      if (!lesson) return
      // resume where they stopped, unless the lesson is finished and they are
      // deliberately doing it again
      const unfinished = lesson.steps.findIndex((step) => !isStepDone(lesson.id, step.id))
      const offset = unfinished === -1 ? 0 : unfinished
      // built once per run: rebuilding resets AnnotationContext's step index
      setRun({ lesson, tutorial: buildTutorial(lesson, offset), offset })
      setStepIndex(offset)
      setStepStates({})
      setDrawerOpen(true)
      const route = lesson.steps[offset]?.console?.route
      if (route && route !== pathnameRef.current) navigate(route)
    },
    [trail, navigate, isStepDone],
  )

  const exitLesson = useCallback(() => {
    setRun(null)
    setStepIndex(0)
    setStepStates({})
  }, [])

  const onStepChange = useCallback(
    (index: number, reason: string) => {
      // auto-fallback means the step's anchor is not on screen, so Cloudscape
      // moved its popover to whichever anchor is. That is a navigation problem,
      // not a step change: the panel stays on the step the learner is actually
      // on, and tells them where to go. Navigating here would also unmount the
      // next anchor and loop forever.
      if (reason === 'auto-fallback') return
      const absolute = (run?.offset ?? 0) + index
      setStepIndex(absolute)
      const route = run?.lesson.steps[absolute]?.console?.route
      if (route && route !== pathnameRef.current) navigate(route)
    },
    [run, navigate],
  )

  const applyProgress = useCallback((next: { completed: LearnCompleted; skipped: LearnCompleted }) => {
    setCompleted(next.completed ?? {})
    setSkipped(next.skipped ?? {})
  }, [])

  const setStepState = useCallback((stepId: string, patch: Partial<LearnStepState>) => {
    setStepStates((current) => ({
      ...current,
      [stepId]: { ...EMPTY_STEP_STATE, ...current[stepId], ...patch },
    }))
  }, [])

  const runVerify = useCallback(
    async (step: LearnStep, lessonId: string, quiet: boolean) => {
      if (!quiet) setStepState(step.id, { checking: true, error: null })
      try {
        const result = await verifyLearnStep(TRAIL_ID, lessonId, step.id, activeEndpoint)
        // a silent poll that has not passed leaves the panel as it was
        if (quiet && !result.passed) return false
        setStepState(step.id, { checking: false, result, error: null })
        applyProgress(result)
        if (result.passed) toast.success(result.message)
        return result.passed
      } catch (error) {
        if (!quiet) {
          setStepState(step.id, { checking: false, error: error instanceof Error ? error.message : 'Check failed' })
        }
        return false
      }
    },
    [activeEndpoint, applyProgress, setStepState],
  )

  const verifyStep = useCallback(
    async (step: LearnStep) => {
      if (!run) return
      await runVerify(step, run.lesson.id, false)
    },
    [run, runVerify],
  )

  const markStep = useCallback(
    async (step: LearnStep) => {
      if (!run) return
      try {
        const result = await markLearnStep(TRAIL_ID, run.lesson.id, step.id, Boolean(step.verify))
        applyProgress(result)
      } catch (error) {
        setStepState(step.id, { error: error instanceof Error ? error.message : 'Could not save that' })
      }
    },
    [run, applyProgress, setStepState],
  )

  const setVariable = useCallback(
    async (lessonId: string, name: string, value: string) => {
      const result = await setLearnVariable(TRAIL_ID, lessonId, name, value)
      setVariables((current) => ({ ...current, [lessonId]: result.variables }))
      // the commands and instructions embed the value, so the trail is refetched
      await load()
    },
    [load],
  )

  const resetTrail = useCallback(async () => {
    await resetLearnProgress(TRAIL_ID)
    exitLesson()
    await load()
  }, [exitLesson, load])

  /**
   * Finishing a step moves the tutorial to the next one, so the popover follows
   * what the learner built rather than waiting for a Next click.
   *
   * Re-anchoring means handing AnnotationContext a tutorial that begins at the
   * new step: it resets to step 0 whenever the tutorial's identity changes, and
   * slicing turns that reset into exactly the move we want. It also resyncs
   * after an auto-fallback, which leaves Cloudscape's private index somewhere
   * the panel deliberately did not follow.
   */
  const lastFrontierRef = useRef(-1)
  useEffect(() => {
    if (!run) {
      lastFrontierRef.current = -1
      return
    }
    if (lastFrontierRef.current === -1) {
      lastFrontierRef.current = frontier
      return
    }
    if (frontier <= lastFrontierRef.current) return

    lastFrontierRef.current = frontier
    setRun((current) =>
      current ? { ...current, tutorial: buildTutorial(current.lesson, frontier), offset: frontier } : current,
    )
    setStepIndex(frontier)
    const route = run.lesson.steps[frontier]?.console?.route
    if (route && route !== pathnameRef.current) navigate(route)
  }, [frontier, run, navigate])

  /**
   * Auto-verify: the learner runs a command in their own terminal and the step
   * turns green on its own. Off against real AWS, where every poll is a billed
   * API call, and off when the drawer is closed or the tab is hidden.
   */
  const attemptsRef = useRef(0)
  const currentStep = run?.lesson.steps[stepIndex]
  const currentStepDone = Boolean(run && currentStep && isStepDone(run.lesson.id, currentStep.id))
  const autoVerifyEligible = Boolean(
    run &&
      currentStep?.verify &&
      currentStep.autoVerify &&
      !currentStepDone &&
      drawerOpen &&
      health?.connection_type !== 'aws',
  )

  useEffect(() => {
    attemptsRef.current = 0
  }, [currentStep?.id, autoVerifyEligible])

  useEffect(() => {
    if (!autoVerifyEligible || !run || !currentStep) return
    const timer = window.setInterval(() => {
      if (document.hidden) return
      if (attemptsRef.current >= AUTO_VERIFY_MAX_ATTEMPTS) {
        window.clearInterval(timer)
        return
      }
      attemptsRef.current += 1
      void runVerify(currentStep, run.lesson.id, true)
    }, AUTO_VERIFY_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [autoVerifyEligible, run, currentStep, runVerify])

  /**
   * Which anchors exist right now. Cloudscape enables Next when the next
   * step's hotspot is mounted, so limiting mounted anchors to the frontier is
   * what makes Next wait for verification.
   */
  const activeHotspots = useMemo(() => {
    if (!run) return new Set<string>()
    const ids = new Set<string>([FALLBACK_HOTSPOT_ID])
    // from the step the tutorial starts at, since a resumed run slices the
    // earlier ones off and Cloudscape renders no anchor for a step it does not
    // know about
    run.lesson.steps.slice(run.offset, frontier + 1).forEach((step) => {
      ids.add(resolveHotspotId(step.console?.hotspotId))
    })
    return ids
  }, [run, frontier])

  const isHotspotActive = useCallback((hotspotId: string) => activeHotspots.has(hotspotId), [activeHotspots])

  const stepStateFor = useCallback(
    (stepId: string): LearnStepState => stepStates[stepId] ?? EMPTY_STEP_STATE,
    [stepStates],
  )

  /**
   * Popover labels count steps within the lesson, not within the tutorial
   * object. Those differ because re-anchoring hands Cloudscape a tutorial that
   * starts at the current step, which would otherwise read "Step 1 of 1".
   * The functions read a ref so they stay correct even though
   * AnnotationContext keeps the i18n object it was first given.
   */
  const positionRef = useRef({ offset: 0, total: 0 })
  positionRef.current = { offset: run?.offset ?? 0, total: run?.lesson.steps.length ?? 0 }

  const annotationI18n = useMemo(() => {
    const position = (stepIndex: number) => {
      const { offset, total } = positionRef.current
      return `step ${offset + stepIndex + 1} of ${total}`
    }
    return {
      nextButtonText: 'Next',
      previousButtonText: 'Previous',
      finishButtonText: 'Finish',
      labelDismissAnnotation: 'Close this step',
      labelHotspot: (open: boolean, stepIndex: number) =>
        `${open ? 'Close' : 'Open'} ${position(stepIndex)}`,
      stepCounterText: (stepIndex: number) => {
        const counter = position(stepIndex)
        return counter.charAt(0).toUpperCase() + counter.slice(1)
      },
      taskTitle: (_taskIndex: number, taskTitle: string) => taskTitle,
    }
  }, [])

  const value = useMemo(
    () => ({
      enabled,
      loading,
      trail,
      completed,
      skipped,
      variables,
      run,
      stepIndex,
      frontier,
      drawerOpen,
      setDrawerOpen,
      startLesson,
      exitLesson,
      onStepChange,
      stepStateFor,
      verifyStep,
      markStep,
      setVariable,
      resetTrail,
      isStepDone,
      isStepSkipped,
      isHotspotActive,
    }),
    [
      enabled,
      loading,
      trail,
      completed,
      skipped,
      variables,
      run,
      stepIndex,
      frontier,
      drawerOpen,
      startLesson,
      exitLesson,
      onStepChange,
      stepStateFor,
      verifyStep,
      markStep,
      setVariable,
      resetTrail,
      isStepDone,
      isStepSkipped,
      isHotspotActive,
    ],
  )

  return (
    <LearnContext.Provider value={value}>
      <AnnotationContext
        currentTutorial={run?.tutorial ?? null}
        i18nStrings={annotationI18n}
        onStartTutorial={() => {}}
        onExitTutorial={exitLesson}
        onFinish={exitLesson}
        onStepChange={({ detail }) => onStepChange(detail.step, detail.reason)}
      >
        {children}
      </AnnotationContext>
    </LearnContext.Provider>
  )
}
