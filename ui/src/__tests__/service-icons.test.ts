import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getServiceIcon, FALLBACK_ICON } from '@/lib/service-icons'
import { AWS_ICON_MAP } from '@/lib/aws-icons'

const BACKEND_CONFIG = join(__dirname, '../../../backend/config.py')

/** The services the backend probes when STACKPORT_SERVICES isn't set, read from its config. */
function defaultServices(): string[] {
  const source = readFileSync(BACKEND_CONFIG, 'utf8')
  const start = source.indexOf('"STACKPORT_SERVICES",') + '"STACKPORT_SERVICES",'.length
  const literals = source.slice(start, source.indexOf(')', start))
  const joined = [...literals.matchAll(/"([^"]*)"/g)].map((match) => match[1]).join('')
  return joined.split(',').map((service) => service.trim()).filter(Boolean)
}

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

  it('has an icon of its own for every service the dashboard probes by default', () => {
    const services = defaultServices()
    // The parsing found the list from its first entry to its last.
    expect(services).toEqual(expect.arrayContaining(['s3', 'appsync', 'scheduler', 'verifiedpermissions']))
    expect(services.filter((service) => getServiceIcon(service) === FALLBACK_ICON)).toEqual([])
  })

  it.each(['scheduler', 'pipes'])('draws %s with the EventBridge icon', (service) => {
    const { container } = render(createElement(getServiceIcon(service)))
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/aws-icons/events.svg')
  })
})
