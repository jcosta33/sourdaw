import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IndexPage } from './index';

// Mock workspace state
vi.mock('#/modules/Workspace/presentations/hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(() => ({ mode: 'arrange' })),
}));

// Mock child views
vi.mock('#/modules/Workspace/presentations/views/ArrangeView', () => ({
    ArrangeView: () => <div data-testid="arrange-view">Arrange View</div>,
}));

vi.mock('#/modules/Workspace/presentations/views/AutomationView', () => ({
    AutomationView: () => <div data-testid="automation-view">Automation View</div>,
}));

describe('IndexPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render ArrangeView by default', () => {
        render(<IndexPage />);
        expect(screen.getByTestId('arrange-view')).toBeInTheDocument();
    });

    it('should render AutomationView when mode is automation', async () => {
        const { useWorkspaceState } = await import('#/modules/Workspace/presentations/hooks/useWorkspaceState');
        vi.mocked(useWorkspaceState).mockReturnValue({ mode: 'automation' } as any);
        
        render(<IndexPage />);
        expect(screen.getByTestId('automation-view')).toBeInTheDocument();
    });

    it('should render ArrangeView when mode is arrange', async () => {
        const { useWorkspaceState } = await import('#/modules/Workspace/presentations/hooks/useWorkspaceState');
        vi.mocked(useWorkspaceState).mockReturnValue({ mode: 'arrange' } as any);
        
        render(<IndexPage />);
        expect(screen.getByTestId('arrange-view')).toBeInTheDocument();
    });
});
