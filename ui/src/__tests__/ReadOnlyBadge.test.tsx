import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReadOnlyBadge } from '@/components/ReadOnlyBadge'

function renderBadge(props: Parameters<typeof ReadOnlyBadge>[0]) {
  return render(
    <MemoryRouter>
      <ReadOnlyBadge {...props} />
    </MemoryRouter>
  )
}

describe('ReadOnlyBadge', () => {
  it('shows Read-only when writes are disabled', () => {
    renderBadge({ writesEnabled: false })
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })

  it('shows Writes enabled when writes are enabled', () => {
    renderBadge({ writesEnabled: true })
    expect(screen.getByText('Writes enabled')).toBeInTheDocument()
  })
})
