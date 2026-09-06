import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

type DesktopStartupErrorProps = {
    onReload: () => void;
};

export function DesktopStartupError({ onReload }: DesktopStartupErrorProps): ReactElement {
    return (
        <Row as="main" justify="center" className="min-h-screen bg-background p-6 text-foreground">
            <section
                aria-labelledby="desktop-startup-error-title"
                className="daw-floating-surface w-full max-w-md rounded-md p-6 text-center"
                role="alert"
            >
                <h1 id="desktop-startup-error-title" className="text-lg font-semibold">
                    Sourdaw could not start
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    The desktop connection did not load. Reload Sourdaw to try starting it again.
                </p>
                <Button
                    variant="bare"
                    size="bare"
                    className="mt-5 rounded border border-border bg-surface-raised px-4 py-2 text-sm font-medium hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={onReload}
                    type="button"
                >
                    Reload Sourdaw
                </Button>
            </section>
        </Row>
    );
}
