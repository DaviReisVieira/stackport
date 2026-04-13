import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['b'], description: 'Toggle sidebar' },
      { keys: ['t'], description: 'Toggle theme' },
      { keys: ['g', 'd'], description: 'Go to Dashboard' },
      { keys: ['g', 'r'], description: 'Go to Resource Browser' },
      { keys: ['g', 'a'], description: 'Go to About' },
      { keys: ['/'], description: 'Focus search input' },
      { keys: ['Esc'], description: 'Close modal or blur search' },
    ],
  },
  {
    title: 'Dashboard',
    shortcuts: [
      { keys: ['v'], description: 'Toggle grid/list view' },
      { keys: ['r'], description: 'Refresh' },
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
      { keys: ['\u232B'], description: 'Navigate up one folder' },
      { keys: ['Enter'], description: 'Open selected folder/file' },
    ],
  },
]

function ShortcutKey({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-7 px-2 text-[11px] font-semibold font-mono bg-gradient-to-b from-muted to-muted/80 text-foreground border border-border/80 rounded-md shadow-[0_2px_0_0_hsl(var(--border)),inset_0_1px_0_0_hsl(var(--muted-foreground)/0.05)]">
      {children}
    </kbd>
  )
}

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <Keyboard className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base">Keyboard Shortcuts</DialogTitle>
              <DialogDescription className="text-xs">
                Navigate faster with your keyboard
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-3">
          {SHORTCUTS.map((section) => (
            <div key={section.title}>
              <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">{section.title}</h3>
              <div className="space-y-1.5">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between py-1 px-2 -mx-2 rounded-md hover:bg-accent/50 transition-colors"
                  >
                    <span className="text-sm text-foreground/80">{shortcut.description}</span>
                    <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                      {shortcut.keys.map((key, idx) => (
                        <span key={idx} className="flex items-center gap-1">
                          {idx > 0 && <span className="text-muted-foreground/60 text-[10px] font-medium mx-0.5">then</span>}
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
