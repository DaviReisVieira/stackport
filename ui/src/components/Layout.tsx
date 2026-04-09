import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { LayoutDashboard, FolderOpen, Keyboard } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import type { LucideIcon } from 'lucide-react'

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/resources', label: 'Resources', icon: FolderOpen },
]

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Global keyboard shortcuts (available on all pages)
  useKeyboardShortcuts(
    [
      { key: '?', handler: () => setShowShortcuts(true), shift: true },
      { key: 'Escape', handler: () => setShowShortcuts(false) },
    ],
    [
      { sequence: ['g', 'd'], handler: () => navigate('/') },
      { sequence: ['g', 'r'], handler: () => navigate('/resources') },
    ]
  )

  return (
    <div className="flex h-screen bg-background text-foreground">
      <KeyboardShortcutsModal open={showShortcuts} onOpenChange={setShowShortcuts} />

      {/* Sidebar */}
      <nav aria-label="Main navigation" className="w-56 bg-card border-r flex flex-col">
        <div className="px-4 py-4 flex items-center gap-3">
          <img src="/favicon.svg" alt="StackPort" className="h-8 w-8" />
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-tight">StackPort</h1>
            <p className="text-xs text-muted-foreground">AWS Resource Browser</p>
          </div>
        </div>
        <Separator />
        <ul className="flex-1 py-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary border-r-2 border-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  }`
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <Separator />
        <div className="px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">StackPort</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1.5 text-muted-foreground hover:text-foreground px-1.5"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts"
          >
            <Keyboard className="h-3.5 w-3.5" />
            <kbd className="text-[10px] bg-muted px-1 rounded">?</kbd>
          </Button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
