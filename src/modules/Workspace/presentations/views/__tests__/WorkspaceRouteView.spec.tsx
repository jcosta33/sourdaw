import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { WorkspaceRouteView } from '../WorkspaceRouteView';

vi.mock('../../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(),
}));

vi.mock('../ArrangeView', () => ({
    ArrangeView: () => <div data-testid="arrange-view">Arrange View</div>,
}));

vi.mock('../AutomationView', () => ({
    AutomationView: () => <div data-testid="automation-view">Automation View</div>,
}));

describe('WorkspaceRouteView', () => {
    beforeEach(() => {
        vi.mocked(useWorkspaceState).mockReturnValue({ ...defaultWorkspaceState, mode: 'arrange' });
    });

    it('should render ArrangeView by default', () => {
        render(<WorkspaceRouteView />);
        expect(screen.getByTestId('arrange-view')).toBeInTheDocument();
    });

    it('should render AutomationView when mode is automation', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({ ...defaultWorkspaceState, mode: 'automation' });

        render(<WorkspaceRouteView />);
        expect(screen.getByTestId('automation-view')).toBeInTheDocument();
    });

    it('should render ArrangeView when mode is clip', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({ ...defaultWorkspaceState, mode: 'clip' });

        render(<WorkspaceRouteView />);
        expect(screen.getByTestId('arrange-view')).toBeInTheDocument();
    });
});
