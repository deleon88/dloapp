import { Component, type ErrorInfo, type ReactNode } from 'react'
import ErrorFallback from './ErrorFallback'

/**
 * Catches render errors in the page below it so one broken card doesn't blank
 * the whole app. Layout keys it on the route, so navigating elsewhere resets it.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    return this.state.error ? <ErrorFallback /> : this.props.children
  }
}
