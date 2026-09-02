import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { StatsResponse } from '@/lib/types'

const refresh = vi.fn()

const setActiveEndpoint = vi.fn()

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [
      {
        name: 'local',
        url: 'http://localhost:4566',
        health: 'healthy',
        active: true,
        connection_type: 'local',
        region: 'us-east-1',
        source: 'env',
        auth_type: 'default',
      },
      {
        name: 'staging',
        url: 'http://localhost:5001',
        health: 'unknown',
        active: false,
        connection_type: 'local',
        region: 'us-east-1',
        source: 'user',
        auth_type: 'default',
      },
    ],
    loading: false,
    setActiveEndpoint,
    refresh: vi.fn(),
  }),
}))

const health = {
  status: 'ok',
  version: 'test',
  uptime_seconds: 1,
  endpoint_url: 'http://localhost:4566',
  region: 'us-east-1',
  services_count: 3,
  connection_type: 'local' as const,
  writes_enabled: false,
}

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({ data: health, loading: false, error: null, refresh: vi.fn() }),
}))

const stats: StatsResponse = {
  services: {
    s3: { status: 'available', resources: { buckets: 3 } },
    dynamodb: { status: 'available', resources: { tables: 2 } },
    ec2: { status: 'unavailable', resources: {} },
  },
  total_resources: 5,
  uptime_seconds: 120,
}

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ data: stats, loading: false, error: null, connected: true, refresh }),
}))

import CloudscapeDashboard from '@/pages/CloudscapeDashboard'

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/cloudscape']}>
      <CloudscapeDashboard />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  refresh.mockReset()
  // The shell fetches /api/stats once for the top-nav search options
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(stats),
  }) as unknown as typeof fetch
})

describe('CloudscapeDashboard', () => {
  it('renders the summary and every service', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('s3')).toBeInTheDocument()
    expect(screen.getByText('dynamodb')).toBeInTheDocument()
    expect(screen.getByText('ec2')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('filters services by name', () => {
    renderDashboard()
    const filterInput = screen.getAllByPlaceholderText('Find a service')[0]
    fireEvent.change(filterInput, { target: { value: 'dyna' } })
    expect(screen.getByText('dynamodb')).toBeInTheDocument()
    expect(screen.queryByText('s3')).not.toBeInTheDocument()
  })

  it('switches between grid and list view', () => {
    renderDashboard()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('List'))
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(localStorage.getItem('stackport:view-mode')).toBe('list')
  })

  it('marks a favorite and persists it', () => {
    renderDashboard()
    const star = screen.getByLabelText('Add ec2 to favorites')
    fireEvent.click(star)
    expect(JSON.parse(localStorage.getItem('stackport:favorites') ?? '[]')).toContain('ec2')
    expect(screen.getByLabelText('Remove ec2 from favorites')).toBeInTheDocument()
  })

  it('shows the top-nav service search', () => {
    renderDashboard()
    expect(screen.getAllByPlaceholderText('Search services').length).toBeGreaterThan(0)
  })

  it('pins a favorited service to the top navigation', () => {
    renderDashboard()
    expect(screen.getAllByText('dynamodb')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Add dynamodb to favorites'))
    // dashboard entry + pinned top-nav shortcut
    expect(screen.getAllByText('dynamodb').length).toBeGreaterThan(1)
  })

  it('refreshes on demand', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the active endpoint and switches endpoints from the top nav', () => {
    renderDashboard()
    fireEvent.click(screen.getAllByText('local')[0])
    fireEvent.click(screen.getAllByText('staging')[0])
    expect(setActiveEndpoint).toHaveBeenCalledWith('staging')
  })

  it('shows the read-only badge when writes are disabled', () => {
    renderDashboard()
    expect(screen.getAllByText('Read-only').length).toBeGreaterThan(0)
  })

  it('opens the keyboard shortcuts modal', () => {
    renderDashboard()
    fireEvent.click(screen.getAllByLabelText('Keyboard shortcuts')[0])
    expect(screen.getByText('Toggle sidebar')).toBeInTheDocument()
  })
})
