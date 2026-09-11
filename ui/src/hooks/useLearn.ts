import { useContext } from 'react'
import { LearnContext } from '@/contexts/learn-context'

export function useLearn() {
  return useContext(LearnContext)
}
