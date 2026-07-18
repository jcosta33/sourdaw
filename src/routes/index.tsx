import { type ReactElement } from 'react';

import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceRouteView } from '#/modules/WorkspaceShell/presentations/views';

export const Route = createFileRoute('/')({
    component: IndexPage,
});

export function IndexPage(): ReactElement {
    return <WorkspaceRouteView />;
}
