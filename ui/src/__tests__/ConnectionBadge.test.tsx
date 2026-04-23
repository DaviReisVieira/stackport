import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ConnectionBadge } from '@/components/ConnectionBadge'

function renderBadge(props: Parameters<typeof ConnectionBadge>[0]) {
  return render(
    <MemoryRouter>
      <ConnectionBadge {...props} />
    </MemoryRouter>
  )
}

describe('ConnectionBadge', () => {
  it('shows Local with endpoint host for local connections', () => {
    renderBadge({ connectionType: 'local', region: 'us-east-1', endpointUrl: 'http://localhost:4566' })
    expect(screen.getByText(/Local/)).toBeInTheDocument()
    expect(screen.getByText(/localhost:4566/)).toBeInTheDocument()
  })

  it('shows AWS with region for real AWS connections', () => {
    renderBadge({ connectionType: 'aws', region: 'us-west-2', endpointUrl: null })
    expect(screen.getByText(/AWS/)).toBeInTheDocument()
    expect(screen.getByText(/us-west-2/)).toBeInTheDocument()
  })

  it('handles null endpointUrl for local connections gracefully', () => {
    renderBadge({ connectionType: 'local', region: 'us-east-1', endpointUrl: null })
    expect(screen.getByText(/Local/)).toBeInTheDocument()
    expect(screen.getByText(/emulator/)).toBeInTheDocument()
  })
})
