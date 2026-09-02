import Box from '@cloudscape-design/components/box'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Modal from '@cloudscape-design/components/modal'
import SpaceBetween from '@cloudscape-design/components/space-between'

const GLOBAL_SHORTCUTS: Array<[string, string]> = [
  ['?', 'Show keyboard shortcuts'],
  ['b', 'Toggle sidebar'],
  ['t', 'Toggle theme'],
  ['g then d', 'Go to Dashboard'],
  ['g then r', 'Go to Resource Browser'],
  ['g then s', 'Go to Settings'],
  ['g then a', 'Go to About'],
  ['Esc', 'Close modal'],
]

const DASHBOARD_SHORTCUTS: Array<[string, string]> = [
  ['r', 'Refresh'],
  ['v', 'Toggle grid/list view'],
]

function ShortcutList({ title, shortcuts }: { title: string; shortcuts: Array<[string, string]> }) {
  return (
    <div>
      <Box variant="h4">{title}</Box>
      <SpaceBetween size="xs">
        {shortcuts.map(([keys, label]) => (
          <ColumnLayout key={keys} columns={2} variant="text-grid">
            <Box fontWeight="bold">{keys}</Box>
            <Box color="text-body-secondary">{label}</Box>
          </ColumnLayout>
        ))}
      </SpaceBetween>
    </div>
  )
}

export function CloudscapeShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal visible={open} onDismiss={onClose} header="Keyboard shortcuts" size="medium">
      <SpaceBetween size="l">
        <ShortcutList title="Global" shortcuts={GLOBAL_SHORTCUTS} />
        <ShortcutList title="Dashboard" shortcuts={DASHBOARD_SHORTCUTS} />
      </SpaceBetween>
    </Modal>
  )
}
