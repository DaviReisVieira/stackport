import Box from '@cloudscape-design/components/box'
import Modal from '@cloudscape-design/components/modal'
import SpaceBetween from '@cloudscape-design/components/space-between'
import { IS_MAC } from '@/components/cloudscape/platform'

interface Shortcut {
  keys: string[]
  label: string
}

const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: IS_MAC ? ['⌥', 'S'] : ['Alt', 'S'], label: 'Focus service search' },
  { keys: ['B'], label: 'Toggle sidebar' },
  { keys: ['T'], label: 'Toggle theme' },
  { keys: ['G', 'D'], label: 'Go to Dashboard' },
  { keys: ['G', 'R'], label: 'Go to Resource Browser' },
  { keys: ['G', 'S'], label: 'Go to Settings' },
  { keys: ['G', 'A'], label: 'Go to About' },
  { keys: ['Esc'], label: 'Close modal' },
]

const DASHBOARD_SHORTCUTS: Shortcut[] = [
  { keys: ['R'], label: 'Refresh' },
  { keys: ['V'], label: 'Toggle grid/list view' },
]

const BROWSER_SHORTCUTS: Shortcut[] = [
  { keys: ['J'], label: 'Next row' },
  { keys: ['K'], label: 'Previous row' },
  { keys: ['⏎'], label: 'Open selected row' },
]

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-neutral-500/40 bg-neutral-500/10 px-1.5 font-mono text-xs">
      {children}
    </kbd>
  )
}

function ShortcutList({ title, shortcuts }: { title: string; shortcuts: Shortcut[] }) {
  return (
    <div>
      <Box variant="h4" padding={{ bottom: 'xs' }}>
        {title}
      </Box>
      <div className="rounded-lg border border-neutral-500/20">
        {shortcuts.map(({ keys, label }) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 border-b border-neutral-500/20 px-3 py-2 last:border-b-0"
          >
            <Box color="text-body-secondary">{label}</Box>
            <span className="flex shrink-0 items-center gap-1">
              {keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CloudscapeShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal visible={open} onDismiss={onClose} header="Keyboard shortcuts" size="medium">
      <SpaceBetween size="l">
        <ShortcutList title="Global" shortcuts={GLOBAL_SHORTCUTS} />
        <ShortcutList title="Dashboard" shortcuts={DASHBOARD_SHORTCUTS} />
        <ShortcutList title="Tables" shortcuts={BROWSER_SHORTCUTS} />
      </SpaceBetween>
    </Modal>
  )
}
