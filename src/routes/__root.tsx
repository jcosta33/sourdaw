import { type ReactElement } from 'react';

import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { type queryClient } from '#/app/queryClient';
import { Row } from '#/components/layout';
import { AppShell, WorkspaceMobileGate } from '#/modules/WorkspaceShell/presentations/views';

type AppRouterContext = {
    queryClient: typeof queryClient;
};

export const Route = createRootRouteWithContext<AppRouterContext>()({
    component: RootLayout,
    errorComponent: RootError,
});

export function RootLayout(): ReactElement {
    return (
        <WorkspaceMobileGate>
            <AppShell>
                <Outlet />
            </AppShell>
        </WorkspaceMobileGate>
    );
}

export function RootError(): ReactElement {
    return (
        <Row justify="center" className="h-screen w-screen bg-background">
            <div className="text-center">
                <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    An unexpected error occurred. Please reload the application.
                </p>
            </div>
        </Row>
    );
}
