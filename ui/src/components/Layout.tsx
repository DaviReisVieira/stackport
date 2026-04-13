import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { LayoutDashboard, FolderOpen, Keyboard, PanelLeftClose, PanelLeft, Info } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useTheme } from '@/hooks/useTheme'
import type { LucideIcon } from 'lucide-react'

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/resources', label: 'Resources', icon: FolderOpen },
  { to: '/about', label: 'About', icon: Info },
]

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { setTheme, theme } = useTheme()

  const toggleSidebar = () => setSidebarCollapsed(!sidebarCollapsed)
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
    setTheme(nextTheme)
  }

  // Global keyboard shortcuts (available on all pages)
  useKeyboardShortcuts(
    [
      { key: '?', handler: () => setShowShortcuts(true), shift: true },
      { key: 'Escape', handler: () => setShowShortcuts(false) },
      { key: 'b', handler: toggleSidebar },
      { key: 't', handler: toggleTheme },
    ],
    [
      { sequence: ['g', 'd'], handler: () => navigate('/') },
      { sequence: ['g', 'r'], handler: () => navigate('/resources') },
      { sequence: ['g', 'a'], handler: () => navigate('/about') },
    ]
  )

  return (
    <div className="flex h-screen bg-background text-foreground">
      <KeyboardShortcutsModal open={showShortcuts} onOpenChange={setShowShortcuts} />

      {/* Sidebar */}
      <nav
        aria-label="Main navigation"
        className={`bg-card border-r flex flex-col transition-all duration-300 ${
          sidebarCollapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className={`px-4 py-4 flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
          <img src="/favicon.svg" alt="StackPort" className="h-8 w-8 flex-shrink-0" />
          {!sidebarCollapsed && (
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">StackPort</h1>
              <p className="text-xs text-muted-foreground">AWS Resource Browser</p>
            </div>
          )}
        </div>
        <Separator />
        <ul className="flex-1 py-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                title={sidebarCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 ${sidebarCollapsed ? 'justify-center px-4' : 'px-4'} py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary border-r-2 border-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  }`
                }
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                {!sidebarCollapsed && item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <Separator />
        <div className={`px-4 py-2.5 flex items-center ${sidebarCollapsed ? 'flex-col gap-2' : 'justify-between'}`}>
          {!sidebarCollapsed && <span className="text-xs text-muted-foreground">StackPort</span>}
          <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'flex-col' : ''}`}>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 px-0 ${sidebarCollapsed ? '' : 'gap-1.5'} text-muted-foreground hover:text-foreground`}
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts"
            >
              <Keyboard className="h-3.5 w-3.5" />
              {!sidebarCollapsed && <kbd className="text-[10px] bg-muted px-1 rounded">?</kbd>}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
