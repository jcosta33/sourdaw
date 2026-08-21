import { Component, type ReactNode } from 'react';

import { Stack } from '#/components/layout';
import { logger } from '#/infra/logger/appLogger';

/**
 * `page` fills the viewport — correct when the boundary is the app root.
 * `inline` fills whatever height-constrained container it was dropped into, which is
 * what every device-panel call site needs: a viewport-tall fallback inside a ~300px
 * panel pushes "Try Again" and "Reload App" out of view, clipping the recovery path
 * the boundary exists to provide.
 */
type ErrorBoundaryVariant = 'page' | 'inline';

type Props = { children: ReactNode; variant?: ErrorBoundaryVariant };
type State = { hasError: boolean; error: Error | null };

// Sizing is an inline style rather than a Tailwind class so the variant is an
// observable DOM property: jsdom compiles no Tailwind, so a class-based height
// would be untestable — and asserting on class strings is disallowed anyway.
const FALLBACK_HEIGHT: Record<ErrorBoundaryVariant, string> = {
    page: '100vh',
    inline: '100%',
};

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        logger.error(error);
        logger.warn('ErrorBoundary error info:', errorInfo);
    }

    render(): ReactNode {
        if (this.state.hasError) {
            const variant = this.props.variant ?? 'page';
            return (
                <Stack
                    align="center"
                    justify="center"
                    gap={4}
                    className="overflow-auto bg-background text-foreground"
                    style={{ height: FALLBACK_HEIGHT[variant] }}
                >
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
                </Stack>
            );
        }
        return this.props.children;
    }
}
