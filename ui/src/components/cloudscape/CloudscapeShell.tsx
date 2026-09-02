import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '@cloudscape-design/components/app-layout'
import SideNavigation from '@cloudscape-design/components/side-navigation'
import { applyMode, Mode } from '@cloudscape-design/global-styles'
import '@cloudscape-design/global-styles/index.css'

/**
 * Shared shell for Cloudscape-migrated views (milestone: Cloudscape UI v0.4.0).
 *
 * Each migrated view renders inside this AppLayout. The nav below is the single
 * source of truth for what has been migrated: point an entry at its /cloudscape
 * route once the view lands, and leave it pointing at the legacy route until then.
 */
export function CloudscapeShell({ activeHref, children }: { activeHref: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(true)

  // Match Cloudscape's mode to the app's current theme
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark')
    applyMode(isDark ? Mode.Dark : Mode.Light)
  }, [])

  return (
    <AppLayout
      toolsHide
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
  )
}
