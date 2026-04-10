import { type ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ArrangeView } from '#/modules/Workspace/presentations/views/ArrangeView';
import { AutomationView } from '#/modules/Workspace/presentations/views/AutomationView';
import { useWorkspaceState } from '#/modules/Workspace/presentations/hooks/useWorkspaceState';

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
