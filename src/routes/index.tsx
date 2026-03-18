import { type ReactElement } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ArrangeView } from '#/modules/Workspace/presentations/views/ArrangeView';
import { AutomationView } from '#/modules/Workspace/presentations/views/AutomationView';
import { ClipView } from '#/modules/Workspace/presentations/views/ClipView';
import { useWorkspaceState } from '#/modules/Workspace/presentations/hooks/useWorkspaceState';

export const Route = createFileRoute('/')({
    component: IndexPage,
});

function IndexPage(): ReactElement {
    const { mode } = useWorkspaceState();

    switch (mode) {
        case 'arrange':
            return <ArrangeView />;
        case 'automation':
            return <AutomationView />;
        case 'clip':
            return <ClipView />;
        default:
            return <ArrangeView />;
    }
}
