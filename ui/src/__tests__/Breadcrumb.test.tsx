import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { Breadcrumb, createHomeSegment, type BreadcrumbSegment } from '@/components/Breadcrumb'
import { Home } from 'lucide-react'

// Wrapper with router context
function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('Breadcrumb', () => {
  it('renders nothing when segments array is empty', () => {
    const { container } = renderWithRouter(<Breadcrumb segments={[]} />)
    expect(container.querySelector('nav')).toBeNull()
  })

  it('renders a single segment without link', () => {
    const segments: BreadcrumbSegment[] = [{ label: 'Dashboard' }]
    renderWithRouter(<Breadcrumb segments={segments} />)

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders multiple segments with links for non-last items', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Dashboard', href: '/' },
      { label: 'Resources', href: '/resources' },
      { label: 'S3' },
    ]
    renderWithRouter(<Breadcrumb segments={segments} />)

    const dashboardLink = screen.getByRole('link', { name: /dashboard/i })
    const resourcesLink = screen.getByRole('link', { name: /resources/i })

    expect(dashboardLink).toHaveAttribute('href', '/')
    expect(resourcesLink).toHaveAttribute('href', '/resources')

    // Last segment should not be a link
    expect(screen.getByText('S3')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /s3/i })).toBeNull()
  })

  it('renders icons when provided', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Home', href: '/', icon: Home },
      { label: 'Page' },
    ]
    const { container } = renderWithRouter(<Breadcrumb segments={segments} />)

    // Check that icon is rendered (lucide icons render as SVGs)
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(0) // At least the Home icon + chevrons
  })

  it('renders chevron separators between segments', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'A', href: '/a' },
      { label: 'B', href: '/b' },
      { label: 'C' },
    ]
    const { container } = renderWithRouter(<Breadcrumb segments={segments} />)

    // ChevronRight icons are rendered between segments (2 chevrons for 3 segments)
    const chevrons = container.querySelectorAll('svg')
    expect(chevrons.length).toBeGreaterThanOrEqual(2)
  })

  it('applies custom className', () => {
    const segments: BreadcrumbSegment[] = [{ label: 'Test' }]
    const { container } = renderWithRouter(<Breadcrumb segments={segments} className="custom-class" />)

    const nav = container.querySelector('nav')
    expect(nav).toHaveClass('custom-class')
  })
})

describe('createHomeSegment', () => {
  it('returns a segment with Dashboard label and home href', () => {
    const segment = createHomeSegment()

    expect(segment.label).toBe('Dashboard')
    expect(segment.href).toBe('/')
    expect(segment.icon).toBeDefined()
  })
})
