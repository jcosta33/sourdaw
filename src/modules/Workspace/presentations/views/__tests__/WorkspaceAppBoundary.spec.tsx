import { type ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceAppBoundary } from '../WorkspaceAppBoundary';

vi.mock('../../components/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: { children: ReactNode }) => (
        <div data-testid="workspace-error-boundary">{children}</div>
    ),
}));

describe('WorkspaceAppBoundary', () => {
    it('should render children through the Workspace error boundary', () => {
        render(
            <WorkspaceAppBoundary>
                <span>Workspace child</span>
            </WorkspaceAppBoundary>
        );

        expect(screen.getByTestId('workspace-error-boundary')).toBeInTheDocument();
        expect(screen.getByText('Workspace child')).toBeInTheDocument();
    });
});
