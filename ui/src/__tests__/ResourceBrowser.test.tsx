import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ResourceBrowser from '@/pages/ResourceBrowser'

// Mock sonner
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

// Mock API
vi.mock('@/lib/api', () => ({
  fetchStats: vi.fn(),
  fetchResources: vi.fn(),
  fetchResourceDetail: vi.fn(),
}))

// Mock service views — empty registry so generic table is used
vi.mock('@/components/service-views', () => ({
  SERVICE_VIEWS: {} as Record<string, never>,
}))

import { fetchStats, fetchResources } from '@/lib/api'
const mockFetchStats = vi.mocked(fetchStats)
const mockFetchResources = vi.mocked(fetchResources)

function renderBrowser(path = '/resources') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources/:service?" element={<ResourceBrowser />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResourceBrowser', () => {
  it('shows empty state when no service selected', async () => {
    mockFetchStats.mockResolvedValue({
      services: { s3: { status: 'available', resources: { buckets: 1 } } },
      total_resources: 1,
      uptime_seconds: 10,
    })

    renderBrowser('/resources')

    await waitFor(() => {
      expect(screen.getByText('Select a service')).toBeInTheDocument()
    })
  })

  it('renders service sidebar from stats', async () => {
    mockFetchStats.mockResolvedValue({
      services: {
        s3: { status: 'available', resources: { buckets: 2 } },
        lambda: { status: 'available', resources: { functions: 5 } },
      },
      total_resources: 7,
      uptime_seconds: 10,
    })

    renderBrowser('/resources')

    await waitFor(() => {
      expect(screen.getByText('s3')).toBeInTheDocument()
    })
    expect(screen.getByText('lambda')).toBeInTheDocument()
  })

  it('loads resources when service is selected', async () => {
    mockFetchStats.mockResolvedValue({
      services: { dynamodb: { status: 'available', resources: { tables: 2 } } },
      total_resources: 2,
      uptime_seconds: 10,
    })
    mockFetchResources.mockResolvedValue({
      service: 'dynamodb',
      resources: {
        tables: [
          { id: 'users-table', TableName: 'users-table' },
          { id: 'orders-table', TableName: 'orders-table' },
        ],
      },
    })

    renderBrowser('/resources/dynamodb')

    await waitFor(() => {
      expect(screen.getAllByText('dynamodb').length).toBeGreaterThanOrEqual(1)
    })
    await waitFor(() => {
      expect(screen.getByText('users-table')).toBeInTheDocument()
    })
    expect(screen.getByText('orders-table')).toBeInTheDocument()
  })
})
