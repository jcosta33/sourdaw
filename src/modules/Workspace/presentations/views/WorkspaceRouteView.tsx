import { type ReactElement } from 'react';

import { useWorkspaceState } from '../hooks/useWorkspaceState';

import { ArrangeView } from './ArrangeView';
import { AutomationView } from './AutomationView';

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
