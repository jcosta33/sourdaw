import { type ReactElement } from 'react';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { type AppRouterContext } from '#/app/router';
import { AppShell } from '#/modules/Workspace/presentations/views/AppShell';

export const Route = createRootRouteWithContext<AppRouterContext>()({
    component: RootLayout,
    errorComponent: RootError,
});

function RootLayout(): ReactElement {
    return (
        <AppShell>
            <Outlet />
        </AppShell>
    );
}

function RootError(): ReactElement {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-background">
            <div className="text-center">
                <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    An unexpected error occurred. Please reload the application.
                </p>
            </div>
        </div>
    );
}
