import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceProjectLoadingFallback } from '../WorkspaceProjectLoadingFallback';

vi.mock('../../components/ProjectLoadingOverlay', () => ({
    ProjectLoadingOverlay: () => <div data-testid="project-loading-overlay">Project loading</div>,
}));

describe('WorkspaceProjectLoadingFallback', () => {
    it('should render the Workspace project loading overlay', () => {
        render(<WorkspaceProjectLoadingFallback />);
        expect(screen.getByTestId('project-loading-overlay')).toBeInTheDocument();
    });
});
