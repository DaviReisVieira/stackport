import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '@cloudscape-design/components/app-layout'
import Autosuggest from '@cloudscape-design/components/autosuggest'
import Flashbar from '@cloudscape-design/components/flashbar'
import SideNavigation from '@cloudscape-design/components/side-navigation'
import TopNavigation from '@cloudscape-design/components/top-navigation'
import type { TopNavigationProps } from '@cloudscape-design/components/top-navigation'
import { applyMode, Mode } from '@cloudscape-design/global-styles'
import '@cloudscape-design/global-styles/index.css'
import { Monitor, Moon, Sun } from 'lucide-react'
import { CloudscapeShortcutsModal } from '@/components/cloudscape/CloudscapeShortcutsModal'
import { fetchStats } from '@/lib/api'
import type { StatsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFavorites } from '@/hooks/useFavorites'
import { useFetch } from '@/hooks/useFetch'
import { useHealth } from '@/hooks/useHealth'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useTheme } from '@/hooks/useTheme'
import { getServiceIcon } from '@/lib/service-icons'

/**
 * Shared shell for Cloudscape-migrated views (launch PR #149).
 *
 * AWS-console style chrome: a TopNavigation with a unified service search,
 * pinned favorite services, endpoint selector, theme toggle, and keyboard
 * shortcuts, plus the side navigation and a warning banner when connected to
 * real AWS. Each migrated view renders inside this AppLayout. The side nav
 * below is the single source of truth for what has been migrated: point an
 * entry at its /cloudscape route once the view lands, and leave it pointing at
 * the legacy route until then.
 */
export function CloudscapeShell({ activeHref, children }: { activeHref: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(true)
  const [searchValue, setSearchValue] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const { activeEndpoint, endpoints, setActiveEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const { favorites } = useFavorites()
  const { theme, setTheme, effectiveTheme } = useTheme()

  // Service names for the top-nav search; a single cached fetch is enough
  const statsFetcher = useCallback(() => fetchStats(activeEndpoint), [activeEndpoint])
  const { data: stats } = useFetch<StatsResponse>(statsFetcher)

  // Keep Cloudscape's mode in sync with the app theme (t shortcut, system changes)
  useEffect(() => {
    applyMode(effectiveTheme === 'dark' ? Mode.Dark : Mode.Light)
  }, [effectiveTheme])

  const cycleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')
  }, [theme, setTheme])

  useKeyboardShortcuts(
    [
      { key: '?', handler: () => setShortcutsOpen(true), shift: true },
      { key: 'Escape', handler: () => setShortcutsOpen(false) },
      { key: 'b', handler: () => setNavOpen((open) => !open) },
      { key: 't', handler: cycleTheme },
    ],
    [
      { sequence: ['g', 'd'], handler: () => navigate('/cloudscape') },
      { sequence: ['g', 'r'], handler: () => navigate('/resources') },
      { sequence: ['g', 's'], handler: () => navigate('/settings') },
      { sequence: ['g', 'a'], handler: () => navigate('/about') },
    ],
  )

  const searchOptions = useMemo(
    () => Object.keys(stats?.services ?? {}).sort().map((name) => ({ value: name })),
    [stats],
  )

  const goToService = useCallback(
    (service: string) => {
      setSearchValue('')
      navigate(`/resources/${service}`)
    },
    [navigate],
  )

  const utilities = useMemo<TopNavigationProps.Utility[]>(() => {
    const items: TopNavigationProps.Utility[] = favorites.map((name) => {
      const Icon = getServiceIcon(name)
      return {
        type: 'button' as const,
        text: name,
        iconSvg: <Icon />,
        onClick: () => goToService(name),
      }
    })

    if (health && !health.writes_enabled) {
      items.push({
        type: 'button',
        text: 'Read-only',
        iconName: 'lock-private',
        ariaLabel: 'Write operations are disabled (STACKPORT_ALLOW_WRITES=false)',
        onClick: () => {},
      })
    }

    const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
    items.push({
      type: 'button',
      iconSvg: <ThemeIcon />,
      ariaLabel: `Theme: ${theme} (click to change)`,
      onClick: cycleTheme,
    })

    items.push({
      type: 'button',
      iconName: 'keyboard',
      ariaLabel: 'Keyboard shortcuts',
      onClick: () => setShortcutsOpen(true),
    })

    if (endpoints.length > 0) {
      const active = endpoints.find((e) => e.name === activeEndpoint)
      items.push({
        type: 'menu-dropdown',
        text: active ? active.name : 'endpoint',
        description: active ? `${active.connection_type}${active.region ? ` · ${active.region}` : ''}` : undefined,
        iconName: 'globe',
        ariaLabel: 'Select endpoint',
        items: endpoints.map((e) => ({
          id: e.name,
          text: e.name,
          iconName: e.name === activeEndpoint ? ('check' as const) : undefined,
          description: `${e.connection_type}${e.region ? ` · ${e.region}` : ''}`,
        })),
        onItemClick: ({ detail }) => setActiveEndpoint(detail.id),
      })
    }

    return items
  }, [favorites, goToService, health, theme, cycleTheme, endpoints, activeEndpoint, setActiveEndpoint])

  const awsWarning = health?.connection_type === 'aws'

  return (
    <>
      <div id="stackport-top-nav" style={{ position: 'sticky', top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{
            href: '/cloudscape',
            title: 'StackPort',
            onFollow: (event) => {
              event.preventDefault()
              navigate('/cloudscape')
            },
          }}
          search={
            <Autosuggest
              value={searchValue}
              onChange={({ detail }) => setSearchValue(detail.value)}
              onSelect={({ detail }) => {
                if (detail.value) goToService(detail.value)
              }}
              options={searchOptions}
              placeholder="Search services"
              ariaLabel="Search services"
              empty="No services found"
            />
          }
          utilities={utilities}
        />
      </div>
      <CloudscapeShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <AppLayout
        toolsHide
        headerSelector="#stackport-top-nav"
        stickyNotifications
        notifications={
          awsWarning ? (
            <Flashbar
              items={[
                {
                  type: 'warning',
                  content:
                    'Connected to real AWS. Actions here affect live resources and may incur costs.',
                  id: 'aws-warning',
                },
              ]}
            />
          ) : undefined
        }
        navigationOpen={navOpen}
        onNavigationChange={({ detail }) => setNavOpen(detail.open)}
        navigation={
          <SideNavigation
            header={{ text: 'StackPort', href: '/cloudscape' }}
            activeHref={activeHref}
            onFollow={(event) => {
              if (!event.detail.external) {
                event.preventDefault()
                navigate(event.detail.href)
              }
            }}
            items={[
              { type: 'link', text: 'Dashboard', href: '/cloudscape' },
              { type: 'link', text: 'Resources', href: '/resources' },
              { type: 'link', text: 'Settings', href: '/settings' },
              { type: 'link', text: 'About', href: '/about' },
              { type: 'divider' },
              { type: 'link', text: 'Back to current UI', href: '/' },
              {
                type: 'link',
                text: 'Migration progress',
                href: 'https://github.com/DaviReisVieira/stackport/issues/148',
                external: true,
              },
            ]}
          />
        }
        content={children}
      />
    </>
  )
}
