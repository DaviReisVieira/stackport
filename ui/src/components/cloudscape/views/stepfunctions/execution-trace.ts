import type { StepFunctionsHistoryEvent } from '@/lib/types'

export type StateStatus = 'succeeded' | 'failed' | 'in-progress'

export interface ExecutionTrace {
  visitedStates: Map<string, StateStatus>
  activeState?: string
}

export function buildExecutionTrace(events: StepFunctionsHistoryEvent[]): ExecutionTrace {
  const visitedStates = new Map<string, StateStatus>()
  const enteredStates = new Set<string>()
  let activeState: string | undefined

  for (const event of events) {
    const type = event.type

    // Extract state name from entered events
    if (type.endsWith('StateEntered')) {
      const details = findStateDetails(event, 'stateEnteredEventDetails')
      if (details?.name) {
        enteredStates.add(details.name)
        visitedStates.set(details.name, 'in-progress')
        activeState = details.name
      }
    }

    // Mark as succeeded on exit
    if (type.endsWith('StateExited')) {
      const details = findStateDetails(event, 'stateExitedEventDetails')
      if (details?.name) {
        visitedStates.set(details.name, 'succeeded')
        if (activeState === details.name) activeState = undefined
      }
    }

    // Mark as failed
    if (type.includes('Failed') || type.includes('TimedOut') || type.includes('Aborted')) {
      const details = findStateDetails(event, 'stateEnteredEventDetails')
        || findStateDetails(event, 'executionFailedEventDetails')
      if (details?.name && enteredStates.has(details.name)) {
        visitedStates.set(details.name, 'failed')
        if (activeState === details.name) activeState = undefined
      }
    }

    // Execution-level failures mark the last active state as failed
    if (type === 'ExecutionFailed' || type === 'ExecutionTimedOut' || type === 'ExecutionAborted') {
      if (activeState) {
        visitedStates.set(activeState, 'failed')
        activeState = undefined
      }
    }

    if (type === 'ExecutionSucceeded') {
      activeState = undefined
    }
  }

  return { visitedStates, activeState }
}

function findStateDetails(
  event: StepFunctionsHistoryEvent,
  key: string
): { name?: string } | undefined {
  const details = event[key]
  if (details && typeof details === 'object' && 'name' in (details as object)) {
    return details as { name?: string }
  }
  return undefined
}
