import { type ReactElement } from 'react';

import { ArrangeView, AutomationView } from '#/modules/TimelineEditor/presentations/views';

import { useWorkspaceState } from '../hooks/useWorkspaceState';

export const WorkspaceRouteView = (): ReactElement => {
    const { mode } = useWorkspaceState();

    switch (mode) {
        case 'automation':
            return <AutomationView />;
        case 'arrange':
        case 'clip':
        default:
            return <ArrangeView />;
    }
};
