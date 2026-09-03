import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI error:', error, errorInfo)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="max-w-md break-all text-sm opacity-70">{this.state.error?.message ?? 'Unexpected error'}</p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded border px-4 py-2 text-sm font-medium hover:opacity-80"
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
