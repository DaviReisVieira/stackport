import { describe, expect, it } from 'vitest'
import { Server } from 'lucide-react'
import { getServiceIcon } from '@/lib/service-icons'

describe('getServiceIcon', () => {
  it('returns correct icon for known services', () => {
    const icon = getServiceIcon('s3')
    expect(icon).toBeDefined()
    expect(icon).not.toBe(Server) // s3 has a specific icon
  })

  it('returns Server as fallback for unknown services', () => {
    const icon = getServiceIcon('unknown-service-xyz')
    expect(icon).toBe(Server)
  })

  it('is case-insensitive', () => {
    const lower = getServiceIcon('s3')
    const upper = getServiceIcon('S3')
    expect(lower).toBe(upper)
  })

  it('handles hyphenated service names', () => {
    const icon = getServiceIcon('cognito-idp')
    expect(icon).toBeDefined()
    expect(icon).not.toBe(Server)
  })
})
