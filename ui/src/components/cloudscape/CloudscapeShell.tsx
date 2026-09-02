import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '@cloudscape-design/components/app-layout'
import Autosuggest from '@cloudscape-design/components/autosuggest'
import SideNavigation from '@cloudscape-design/components/side-navigation'
import TopNavigation from '@cloudscape-design/components/top-navigation'
import { applyMode, Mode } from '@cloudscape-design/global-styles'
import '@cloudscape-design/global-styles/index.css'
import { fetchStats } from '@/lib/api'
import type { StatsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFavorites } from '@/hooks/useFavorites'
import { useFetch } from '@/hooks/useFetch'
import { getServiceIcon } from '@/lib/service-icons'

/**
 * Shared shell for Cloudscape-migrated views (milestone: Cloudscape UI v0.4.0).
 *
 * AWS-console style chrome: a TopNavigation with a unified service search and
 * the user's favorite services pinned as one-click shortcuts, plus the side
 * navigation. Each migrated view renders inside this AppLayout. The side nav
 * below is the single source of truth for what has been migrated: point an
 * entry at its /cloudscape route once the view lands, and leave it pointing at
 * the legacy route until then.
 */
export function CloudscapeShell({ activeHref, children }: { activeHref: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(true)
  const [searchValue, setSearchValue] = useState('')
  const { activeEndpoint } = useEndpoint()
  const { favorites } = useFavorites()

  // Service names for the top-nav search; a single cached fetch is enough
  const statsFetcher = useCallback(() => fetchStats(activeEndpoint), [activeEndpoint])
  const { data: stats } = useFetch<StatsResponse>(statsFetcher)

  // Match Cloudscape's mode to the app's current theme
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark')
    applyMode(isDark ? Mode.Dark : Mode.Light)
  }, [])

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

  const pinnedFavorites = useMemo(
    () =>
      favorites.map((name) => {
        const Icon = getServiceIcon(name)
        return {
          type: 'button' as const,
          text: name,
          iconSvg: <Icon />,
          onClick: () => goToService(name),
        }
      }),
    [favorites, goToService],
  )

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
          utilities={pinnedFavorites}
        />
      </div>
      <AppLayout
        toolsHide
        headerSelector="#stackport-top-nav"
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
