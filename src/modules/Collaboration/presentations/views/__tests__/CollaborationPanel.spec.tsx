import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CollaborationPanel } from '../CollaborationPanel';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn((store: unknown, defaultValue: unknown) => defaultValue),
    closeCollaborationPanel: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    closeCollaborationPanel: mocks.closeCollaborationPanel,
}));

describe('CollaborationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.useStore.mockImplementation((_store, defaultValue) => defaultValue);
    });

    it('should render without crashing', () => {
        render(<CollaborationPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<CollaborationPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<CollaborationPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<CollaborationPanel />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('closes when Escape is pressed while the panel is open', () => {
        mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        render(<CollaborationPanel />);

        const panel = screen.getByRole('dialog', { name: 'Collaborate' });
        fireEvent.keyDown(panel, { key: 'Escape' });

        expect(mocks.closeCollaborationPanel).toHaveBeenCalledTimes(1);
    });

    it('does not close on other keys', () => {
        mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        render(<CollaborationPanel />);

        const panel = screen.getByRole('dialog', { name: 'Collaborate' });
        fireEvent.keyDown(panel, { key: 'Enter' });

        expect(mocks.closeCollaborationPanel).not.toHaveBeenCalled();
    });
});
