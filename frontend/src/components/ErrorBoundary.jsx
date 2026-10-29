import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from './ui/Button.jsx';

/**
 * Catches a render crash so one broken component does not blank the whole app.
 *
 * Shows the correlation id when the failure came from an API error, so a user
 * reporting a problem can quote something that finds the exact request in the
 * server logs.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // In production this is where an error reporter would be called.
    console.error('Unhandled UI error', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="relative mb-5">
          <span
            aria-hidden="true"
            className="absolute -inset-5 rounded-full bg-danger-500/10 blur-xl"
          />
          <div className="icon-chip icon-chip-danger relative h-14 w-14 rounded-card shadow-card">
            <AlertTriangle aria-hidden="true" className="h-6 w-6" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-ink-900">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-md text-ink-500">
          This screen failed to load. Reloading usually fixes it.
        </p>
        {error.requestId && (
          <p className="mt-3 rounded-field bg-ink-100 px-2.5 py-1 font-mono text-xs text-ink-500">
            Reference: {error.requestId}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
