import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
                    <h1 className="text-xl font-bold">Something went wrong</h1>
                    <p className="text-sm text-muted-foreground max-w-md text-center">
                        {this.state.error?.message ?? 'An unexpected error occurred.'}
                    </p>
                    <button
                        type="button"
                        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        Try Again
                    </button>
                    <button
                        type="button"
                        className="text-xs text-muted-foreground underline"
                        onClick={() => window.location.reload()}
                    >
                        Reload App
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
