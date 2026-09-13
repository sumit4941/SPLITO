import { Button, ErrorState } from '@splito/ui';
import { Component, type ReactNode } from 'react';

interface SafeErrorBoundaryProps {
  children: ReactNode;
}

interface SafeErrorBoundaryState {
  failed: boolean;
}

export class SafeErrorBoundary extends Component<SafeErrorBoundaryProps, SafeErrorBoundaryState> {
  state: SafeErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): SafeErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-error-fallback">
          <ErrorState
            action={<Button onClick={() => window.location.reload()}>Reload SPLITO</Button>}
            description="This page couldn't be displayed. Reload the app and try again."
            title="Something went wrong"
          />
        </main>
      );
    }

    return this.props.children;
  }
}
