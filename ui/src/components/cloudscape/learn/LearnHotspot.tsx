import type { ReactNode } from 'react'
import Hotspot from '@cloudscape-design/components/hotspot'
import { useLearn } from '@/hooks/useLearn'

/**
 * Anchor a tutorial step to a real control.
 *
 * Renders its children untouched unless this hotspot is active, so the console
 * is pixel-identical for everyone who never opens Learn: a bare Hotspot wraps
 * children in a `flex: 1` div, which would shift header action rows for
 * everybody. Not rendering the anchor at all is also what gates the Next
 * button, since Cloudscape enables Next only once the following step's hotspot
 * has mounted.
 */
export function LearnHotspot({
  hotspotId,
  children,
  side,
  direction,
}: {
  hotspotId: string
  children: ReactNode
  side?: 'left' | 'right'
  direction?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const { isHotspotActive } = useLearn()
  if (!isHotspotActive(hotspotId)) return <>{children}</>
  return (
    <Hotspot hotspotId={hotspotId} side={side} direction={direction}>
      {children}
    </Hotspot>
  )
}

/**
 * An inline anchor with no children, for places where wrapping a control would
 * disturb the layout (a navigation item's `info` slot, a header's `info` slot).
 */
export function LearnHotspotMarker({
  hotspotId,
  direction,
}: {
  hotspotId: string
  direction?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const { isHotspotActive } = useLearn()
  if (!isHotspotActive(hotspotId)) return null
  return <Hotspot hotspotId={hotspotId} direction={direction} />
}
