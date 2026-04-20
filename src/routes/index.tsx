import { type ReactElement } from 'react';

import { createFileRoute } from '@tanstack/react-router';

import { useWorkspaceState } from '#/modules/Workspace/presentations/hooks/useWorkspaceState';
import { ArrangeView } from '#/modules/Workspace/presentations/views/ArrangeView';
import { AutomationView } from '#/modules/Workspace/presentations/views/AutomationView';

export const Route = createFileRoute('/')({
    component: IndexPage,
});

export function IndexPage(): ReactElement {
    const { mode } = useWorkspaceState();

    switch (mode) {
        case 'automation':
            return <AutomationView />;
        case 'arrange':
        case 'clip':
        default:
            return <ArrangeView />;
    }
}
