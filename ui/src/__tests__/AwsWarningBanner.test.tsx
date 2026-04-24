import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AwsWarningBanner } from '@/components/AwsWarningBanner'

beforeEach(() => {
  sessionStorage.clear()
})

describe('AwsWarningBanner', () => {
  it('renders warning banner for real AWS connections', () => {
    render(<AwsWarningBanner connectionType="aws" region="us-west-2" writesEnabled={false} />)
    expect(screen.getByText(/real AWS/)).toBeInTheDocument()
    expect(screen.getByText(/us-west-2/)).toBeInTheDocument()
  })

  it('does not render for local connections', () => {
    const { container } = render(<AwsWarningBanner connectionType="local" region="us-east-1" writesEnabled={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows writes caution when writes are enabled on AWS', () => {
    render(<AwsWarningBanner connectionType="aws" region="us-west-2" writesEnabled={true} />)
    expect(screen.getByText(/Writes are enabled/)).toBeInTheDocument()
  })

  it('does not show writes caution when writes are disabled', () => {
    render(<AwsWarningBanner connectionType="aws" region="us-west-2" writesEnabled={false} />)
    expect(screen.queryByText(/Writes are enabled/)).not.toBeInTheDocument()
  })

  it('can be dismissed and stays dismissed', () => {
    const { rerender, container } = render(
      <AwsWarningBanner connectionType="aws" region="us-west-2" writesEnabled={false} />
    )
    expect(screen.getByText(/real AWS/)).toBeInTheDocument()

    const dismissBtn = container.querySelector('button')
    fireEvent.click(dismissBtn!)

    expect(screen.queryByText(/real AWS/)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('stackport:aws-warning-dismissed')).toBe('1')

    rerender(<AwsWarningBanner connectionType="aws" region="us-west-2" writesEnabled={false} />)
    expect(screen.queryByText(/real AWS/)).not.toBeInTheDocument()
  })
})
