import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Keyboard } from 'lucide-react'

interface KeyboardShortcutsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ShortcutSection {
  title: string
  shortcuts: Array<{ keys: string[]; description: string }>
}

const SHORTCUTS: ShortcutSection[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['/'], description: 'Focus search input' },
      { keys: ['Esc'], description: 'Close modal or blur search' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['g', 'd'], description: 'Go to Dashboard' },
      { keys: ['g', 'r'], description: 'Go to Resource Browser' },
    ],
  },
  {
    title: 'Resource Browser',
    shortcuts: [
      { keys: ['j'], description: 'Move selection down' },
      { keys: ['k'], description: 'Move selection up' },
      { keys: ['Enter'], description: 'Open selected resource' },
      { keys: ['['], description: 'Previous service' },
      { keys: [']'], description: 'Next service' },
      { keys: ['r'], description: 'Refresh current view' },
    ],
  },
  {
    title: 'S3 Browser',
    shortcuts: [
      { keys: ['Backspace'], description: 'Navigate up one folder' },
      { keys: ['Enter'], description: 'Open selected folder/file' },
      { keys: ['d'], description: 'Download selected file' },
    ],
  },
]

function ShortcutKey({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 text-xs font-medium bg-muted text-muted-foreground border border-border rounded">
      {children}
    </kbd>
  )
}

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-muted-foreground" />
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </div>
          <DialogDescription>
            Navigate StackPort faster with keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {SHORTCUTS.map((section, i) => (
            <div key={section.title}>
              {i > 0 && <Separator className="my-4" />}
              <h3 className="text-sm font-semibold mb-3">{section.title}</h3>
              <div className="space-y-2">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, idx) => (
                        <span key={idx} className="flex items-center gap-1">
                          {idx > 0 && <span className="text-muted-foreground text-xs">then</span>}
                          <ShortcutKey>{key}</ShortcutKey>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
