import Box from '@cloudscape-design/components/box'
import Icon from '@cloudscape-design/components/icon'
import Link from '@cloudscape-design/components/link'
import SpaceBetween from '@cloudscape-design/components/space-between'
import type { EmulatorLimit } from '@/lib/types'

/** An emulator's limits, one line each, in the quiet colour of a hint. */
export function EmulatorLimitList({ limits }: { limits: EmulatorLimit[] }) {
  return (
    <SpaceBetween size="xxs">
      {limits.map((limit) => (
        <div key={limit.text} className="flex items-start gap-1.5">
          <Icon name="status-info" variant="subtle" />
          <Box color="text-body-secondary">{limit.text}</Box>
        </div>
      ))}
    </SpaceBetween>
  )
}

/** A link to an emulator's own documentation. */
export function EmulatorDocsLink({ name, url }: { name: string; url: string }) {
  return (
    <Link href={url} external externalIconAriaLabel="(opens in a new tab)">
      {name} documentation
    </Link>
  )
}
