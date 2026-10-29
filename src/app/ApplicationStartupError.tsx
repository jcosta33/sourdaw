import { type ReactElement } from 'react';

type ApplicationStartupErrorProps = {
    onReload: () => void;
};

export function ApplicationStartupError({ onReload }: ApplicationStartupErrorProps): ReactElement {
    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
            <section
                aria-labelledby="application-startup-error-title"
                className="daw-floating-surface w-full max-w-md rounded-md p-6 text-center"
                role="alert"
            >
                <h1 id="application-startup-error-title" className="text-lg font-semibold">
                    Sourdaw could not start
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    The application did not load. Reload Sourdaw to try starting it again.
                </p>
                <button
                    className="mt-5 rounded border border-border bg-surface-raised px-4 py-2 text-sm font-medium hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={onReload}
                    type="button"
                >
                    Reload Sourdaw
                </button>
            </section>
        </main>
    );
}
