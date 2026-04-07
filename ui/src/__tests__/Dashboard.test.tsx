import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '@/pages/Dashboard'

// Mock sonner
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

// Mock the API module
vi.mock('@/lib/api', () => ({
  fetchStats: vi.fn(),
}))

import { fetchStats } from '@/lib/api'
const mockFetchStats = vi.mocked(fetchStats)

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
}

describe('Dashboard', () => {
  it('shows loading skeletons initially', () => {
    mockFetchStats.mockReturnValue(new Promise(() => {})) // never resolves
    renderDashboard()
    // Loading state shows skeletons — no heading or service names yet
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('renders service grid after data loads', async () => {
    mockFetchStats.mockResolvedValue({
      services: {
        s3: { status: 'available', resources: { buckets: 3 } },
        sqs: { status: 'unavailable', resources: { queues: 0 } },
      },
      total_resources: 3,
      uptime_seconds: 120,
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
    })

    expect(screen.getByText('s3')).toBeInTheDocument()
    expect(screen.getByText('sqs')).toBeInTheDocument()
    expect(screen.getByText('available')).toBeInTheDocument()
    expect(screen.getByText('unavailable')).toBeInTheDocument()
    expect(screen.getByText('buckets')).toBeInTheDocument()
  })

  it('shows error state when fetch fails', async () => {
    mockFetchStats.mockRejectedValue(new Error('Connection refused'))

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Unable to connect')).toBeInTheDocument()
    })
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })
})
