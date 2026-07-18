import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { IndexPage } from '../index';

vi.mock('#/modules/WorkspaceShell/presentations/views', () => ({
    WorkspaceRouteView: () => <div data-testid="workspace-route-view">Workspace Route View</div>,
}));

describe('IndexPage', () => {
    it('should render the Workspace route view contract', () => {
        render(<IndexPage />);
        expect(screen.getByTestId('workspace-route-view')).toBeInTheDocument();
    });
});
