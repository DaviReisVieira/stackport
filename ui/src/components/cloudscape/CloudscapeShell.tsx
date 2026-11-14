import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AppLayout from '@cloudscape-design/components/app-layout'
import Autosuggest from '@cloudscape-design/components/autosuggest'
import type { AutosuggestProps } from '@cloudscape-design/components/autosuggest'
import Button from '@cloudscape-design/components/button'
import Flashbar from '@cloudscape-design/components/flashbar'
import type { FlashbarProps } from '@cloudscape-design/components/flashbar'
import SideNavigation from '@cloudscape-design/components/side-navigation'
import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation'
import TopNavigation from '@cloudscape-design/components/top-navigation'
import { I18nProvider } from '@cloudscape-design/components/i18n'
import enMessages from '@cloudscape-design/components/i18n/messages/all.en'
import type { TopNavigationProps } from '@cloudscape-design/components/top-navigation'
import { applyMode, Mode } from '@cloudscape-design/global-styles'
import '@cloudscape-design/global-styles/index.css'
import { GraduationCap, Monitor, Moon, Sun } from 'lucide-react'
import { CloudscapeShortcutsModal } from '@/components/cloudscape/CloudscapeShortcutsModal'
import { LearnDrawer } from '@/components/cloudscape/learn/LearnDrawer'
import { LearnHotspotMarker } from '@/components/cloudscape/learn/LearnHotspot'
import { LEARN_HOTSPOTS } from '@/components/cloudscape/learn/hotspots'
import { fetchStats } from '@/lib/api'
import type { Endpoint, HealthResponse, StatsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFavorites } from '@/hooks/useFavorites'
import { useFetch } from '@/hooks/useFetch'
import { useHealth } from '@/hooks/useHealth'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useLearn } from '@/hooks/useLearn'
import { useTheme } from '@/hooks/useTheme'
import { getServiceIcon } from '@/lib/service-icons'
import { SEARCH_SHORTCUT_LABEL } from '@/components/cloudscape/platform'

const LEARN_DRAWER_ID = 'learn'

/**
 * Why requests to the active endpoint's emulator fail when StackPort only reached
 * it with certificate checks off (`tls_trusted: false`), and whether the fix is
 * in Settings. Null when there's nothing to warn about.
 */
function untrustedCertificateNotice(health: HealthResponse | null): { content: string; fixInSettings: boolean } | null {
  if (health?.emulator?.tls_trusted !== false) return null
  const { emulator, connection } = health
  const reached = `StackPort reached ${emulator.name}`
  // The backend can't describe the connection when AWS Emulator's files can't be read
  if (connection === null) {
    return {
      content: `${reached} but can't read the files AWS Emulator wrote for this port, so it can't trust the emulator's certificate and requests to it fail. Run StackPort as the user that runs the emulator, or point STACKPORT_AWS_EMULATOR_DIR at a copy StackPort can read.`,
      fixInSettings: false,
    }
  }
  const untrusted = `${reached} but doesn't trust its TLS certificate, so requests to it fail.`
  if (connection?.tls_trust_source === 'endpoint') {
    const bundle = connection.ca_bundle ? ` (${connection.ca_bundle})` : ''
    return {
      content: `${untrusted} Check this endpoint's CA bundle${bundle} in Settings: StackPort couldn't read it, or it isn't the CA that signed this certificate.`,
      fixInSettings: true,
    }
  }
  // StackPort trusts the CA AWS Emulator wrote, and this certificate isn't from it
  if (connection?.tls_trust_source === 'aws-emulator') {
    const where = connection.aws_emulator_dir ? ` in ${connection.aws_emulator_dir}` : ''
    return {
      content: `${reached} but its TLS certificate didn't verify against the CA AWS Emulator wrote${where}, so requests to it fail. Try restarting the emulator, then StackPort.`,
      fixInSettings: false,
    }
  }
  // Without the folder, StackPort has neither the certificate nor the keys
  if (emulator.id === 'aws-emulator' && connection?.aws_emulator_dir === null && connection.aws_emulator_lookup_dir) {
    return {
      content: `${reached} but can't find the certificate and keys it writes for this port. StackPort looks in ${connection.aws_emulator_lookup_dir} on the machine where it runs: run StackPort where it can see that folder, share it as the Compose example does, or point STACKPORT_AWS_EMULATOR_DIR at it.`,
      fixInSettings: false,
    }
  }
  return { content: `${untrusted} Add the certificate's CA bundle to this endpoint in Settings.`, fixInSettings: true }
}

/**
 * Shared shell for Cloudscape-migrated views (launch PR #149).
 *
 * AWS-console style chrome: a TopNavigation with a unified service search,
 * pinned favorite services, endpoint selector (naming the emulator detected
 * behind the active endpoint), theme toggle, and keyboard shortcuts, plus the
 * side navigation and warning banners for real AWS and for an emulator whose
 * certificate StackPort doesn't trust. Every page renders inside this AppLayout.
 */
export function CloudscapeShell({
  activeHref,
  extraNavItems = [],
  children,
}: {
  activeHref: string
  extraNavItems?: SideNavigationProps.Item[]
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [navOpen, setNavOpen] = useState(true)
  const [searchValue, setSearchValue] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const { activeEndpoint, endpoints, setActiveEndpoint } = useEndpoint()
  const { data: health } = useHealth()
  const { favorites } = useFavorites()
  const { theme, setTheme, effectiveTheme } = useTheme()
  const { enabled: learnEnabled, drawerOpen, setDrawerOpen, run: learnRun } = useLearn()

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

  // Alt+S (Option+S on macOS) focuses the service search, mirroring the AWS
  // console shortcut. e.code is used because on macOS Option+S types "ß" into e.key.
  const searchRef = useRef<AutosuggestProps.Ref>(null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useKeyboardShortcuts(
    [
      { key: '?', handler: () => setShortcutsOpen(true), shift: true },
      { key: 'Escape', handler: () => setShortcutsOpen(false) },
      { key: 'b', handler: () => setNavOpen((open) => !open) },
      { key: 't', handler: cycleTheme },
    ],
    [
      { sequence: ['g', 'd'], handler: () => navigate('/') },
      { sequence: ['g', 'r'], handler: () => navigate('/resources') },
      { sequence: ['g', 'e'], handler: () => navigate('/explorer') },
      { sequence: ['g', 's'], handler: () => navigate('/settings') },
      { sequence: ['g', 'a'], handler: () => navigate('/about') },
      ...(learnEnabled ? [{ sequence: ['g', 'l'], handler: () => navigate('/learn') }] : []),
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
      // Health follows the active endpoint, so only that one can name its emulator
      const summary = (e: Endpoint) =>
        [e.name === activeEndpoint ? health?.emulator?.name : null, e.connection_type, e.region]
          .filter(Boolean)
          .join(' · ')
      const active = endpoints.find((e) => e.name === activeEndpoint)
      items.push({
        type: 'menu-dropdown',
        text: active ? active.name : 'endpoint',
        description: active ? summary(active) : undefined,
        iconName: 'globe',
        ariaLabel: 'Select endpoint',
        items: endpoints.map((e) => ({
          id: e.name,
          text: e.name,
          iconName: e.name === activeEndpoint ? ('check' as const) : undefined,
          secondaryText: summary(e),
        })),
        onItemClick: ({ detail }) => setActiveEndpoint(detail.id),
      })
    }

    return items
  }, [favorites, goToService, health, theme, cycleTheme, endpoints, activeEndpoint, setActiveEndpoint])

  const notifications: FlashbarProps.MessageDefinition[] = []
  if (health?.connection_type === 'aws') {
    notifications.push({
      type: 'warning',
      content: 'Connected to real AWS. Actions here affect live resources and may incur costs.',
      id: 'aws-warning',
    })
  }
  const certificateNotice = untrustedCertificateNotice(health)
  if (certificateNotice) {
    notifications.push({
      type: 'warning',
      id: 'tls-untrusted',
      content: certificateNotice.content,
      action:
        certificateNotice.fixInSettings && pathname !== '/settings' ? (
          <Button onClick={() => navigate('/settings')}>Open settings</Button>
        ) : undefined,
    })
  }

  return (
    <I18nProvider locale="en" messages={[enMessages]}>
      <div id="stackport-top-nav" style={{ position: 'sticky', top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{
            href: '/',
            title: 'StackPort',
            logo: { src: '/stackport-logo.svg', alt: 'StackPort' },
            onFollow: (event) => {
              event.preventDefault()
              navigate('/')
            },
          }}
          search={
            <Autosuggest
              ref={searchRef}
              value={searchValue}
              onChange={({ detail }) => setSearchValue(detail.value)}
              onSelect={({ detail }) => {
                if (detail.value) goToService(detail.value)
              }}
              options={searchOptions}
              placeholder={`Search services (${SEARCH_SHORTCUT_LABEL})`}
              ariaLabel="Search services"
              empty="No services found"
            />
          }
          utilities={utilities}
        />
      </div>
      <CloudscapeShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <AppLayout
        {...(learnEnabled
          ? {
              drawers: [
                {
                  id: LEARN_DRAWER_ID,
                  content: <LearnDrawer />,
                  trigger: { iconSvg: <GraduationCap /> },
                  ariaLabels: {
                    drawerName: 'Learn',
                    closeButton: 'Close the Learn panel',
                    triggerButton: 'Open the Learn panel',
                    resizeHandle: 'Resize the Learn panel',
                  },
                  badge: Boolean(learnRun),
                  resizable: true,
                  defaultSize: 400,
                  preserveInactiveContent: true,
                },
              ],
            }
          : { toolsHide: true })}
        activeDrawerId={drawerOpen && learnEnabled ? LEARN_DRAWER_ID : null}
        onDrawerChange={({ detail }) => setDrawerOpen(detail.activeDrawerId === LEARN_DRAWER_ID)}
        headerSelector="#stackport-top-nav"
        stickyNotifications
        notifications={notifications.length > 0 ? <Flashbar items={notifications} /> : undefined}
        navigationOpen={navOpen}
        onNavigationChange={({ detail }) => setNavOpen(detail.open)}
        navigation={
          <SideNavigation
            header={{ text: 'StackPort', href: '/' }}
            activeHref={activeHref}
            onFollow={(event) => {
              if (!event.detail.external) {
                event.preventDefault()
                navigate(event.detail.href)
              }
            }}
            items={[
              { type: 'link', text: 'Dashboard', href: '/' },
              {
                type: 'link',
                text: 'Resources',
                href: '/resources',
                info: <LearnHotspotMarker hotspotId={LEARN_HOTSPOTS.navResources} />,
              },
              ...extraNavItems,
              { type: 'link', text: 'API Explorer', href: '/explorer' },
              ...(learnEnabled
                ? [
                    {
                      type: 'link' as const,
                      text: 'Learn',
                      href: '/learn',
                      // always mounted while Learn is on, so a step whose anchor
                      // cannot be resolved still gets a popover somewhere visible
                      info: <LearnHotspotMarker hotspotId={LEARN_HOTSPOTS.panelAnchor} />,
                    },
                  ]
                : []),
              { type: 'link', text: 'Settings', href: '/settings' },
              { type: 'link', text: 'About', href: '/about' },
            ]}
          />
        }
        content={children}
      />
    </I18nProvider>
  )
}
