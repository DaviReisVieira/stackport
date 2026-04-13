import { describe, expect, it } from 'vitest'
import { getServiceIcon, FALLBACK_ICON } from '@/lib/service-icons'
import { AWS_ICON_MAP } from '@/lib/aws-icons'

describe('getServiceIcon', () => {
  it('returns AWS icon for known services', () => {
    const icon = getServiceIcon('s3')
    expect(icon).toBeDefined()
    expect(icon).toBe(AWS_ICON_MAP['s3'])
  })

  it('returns fallback for unknown services', () => {
    const icon = getServiceIcon('unknown-service-xyz')
    expect(icon).toBe(FALLBACK_ICON)
  })

  it('is case-insensitive', () => {
    const lower = getServiceIcon('s3')
    const upper = getServiceIcon('S3')
    expect(lower).toBe(upper)
  })

  it('handles hyphenated service names', () => {
    const icon = getServiceIcon('cognito-idp')
    expect(icon).toBeDefined()
    expect(icon).not.toBe(FALLBACK_ICON)
  })
})
