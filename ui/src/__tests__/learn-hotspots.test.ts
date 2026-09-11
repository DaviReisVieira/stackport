import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { KNOWN_HOTSPOT_IDS, LEARN_HOTSPOTS, resolveHotspotId, FALLBACK_HOTSPOT_ID } from '@/components/cloudscape/learn/hotspots'

const REPO_ROOT = join(__dirname, '../../..')
const BACKEND_HOTSPOTS = join(REPO_ROOT, 'backend/learn/hotspots.py')
const TRAILS_DIR = join(REPO_ROOT, 'backend/learn/trails')

/** The backend file is kept as plain string literals so this can read it. */
function backendHotspotIds(): Set<string> {
  const source = readFileSync(BACKEND_HOTSPOTS, 'utf8')
  const body = source.slice(source.indexOf('frozenset('))
  return new Set([...body.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]))
}

describe('hotspot registry', () => {
  it('matches the backend list that validates trail content', () => {
    // if these drift, a lesson can point at an anchor the UI never renders,
    // and the learner gets a step with no popover and no way to continue
    expect([...KNOWN_HOTSPOT_IDS].sort()).toEqual([...backendHotspotIds()].sort())
  })

  it('has no duplicate ids', () => {
    const values = Object.values(LEARN_HOTSPOTS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('falls back to the panel anchor for an id nobody renders', () => {
    expect(resolveHotspotId('not-a-real-hotspot')).toBe(FALLBACK_HOTSPOT_ID)
    expect(resolveHotspotId(undefined)).toBe(FALLBACK_HOTSPOT_ID)
  })

  it('resolves a known id to itself', () => {
    expect(resolveHotspotId(LEARN_HOTSPOTS.s3Upload)).toBe('s3-upload')
  })
})

describe('shipped trail content', () => {
  const trails = readdirSync(TRAILS_DIR)
    .filter((name: string) => name.endsWith('.json'))
    .map((name: string) => JSON.parse(readFileSync(join(TRAILS_DIR, name), 'utf8')))

  it('ships at least one trail', () => {
    expect(trails.length).toBeGreaterThan(0)
  })

  it('only points at hotspots this app renders', () => {
    for (const trail of trails) {
      for (const lesson of trail.lessons) {
        for (const step of lesson.steps) {
          if (step.console?.hotspotId) {
            expect(KNOWN_HOTSPOT_IDS.has(step.console.hotspotId)).toBe(true)
          }
        }
      }
    }
  })
})
