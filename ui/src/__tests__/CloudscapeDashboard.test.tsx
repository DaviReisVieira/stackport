import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { StatsResponse } from '@/lib/types'

const refresh = vi.fn()

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({ activeEndpoint: 'http://localhost:4566' }),
}))

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
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
})

describe('CloudscapeDashboard', () => {
  it('renders the summary and every service', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
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

  it('refreshes on demand', () => {
    renderDashboard()
    fireEvent.click(screen.getByText('Refresh'))
    expect(refresh).toHaveBeenCalled()
  })
})
