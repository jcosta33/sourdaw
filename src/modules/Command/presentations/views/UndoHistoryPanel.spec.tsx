import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UndoHistoryPanel } from './UndoHistoryPanel';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => {
        if (store?.name === 'workspaceStore') {
            return { undoHistoryOpen: true };
        }
        return defaultValue;
    }),
}));

vi.mock('#/modules/Command/stores/undoStore', () => ({
    undoStore: { name: 'undoStore' },
}));

vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: { name: 'workspaceStore' },
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/panelToggles', () => ({
    closeUndoHistory: vi.fn(),
}));

vi.mock('#/modules/Command/useCases/undoRedo', () => ({
    undoToIndex: vi.fn(),
}));

describe('UndoHistoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render null when panel is closed', () => {
        const useStoreMock = vi.mocked(await import('#/infra/store/useStore'));
        useStoreMock.useStore.mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: false };
            }
            return { past: [], future: [] };
        });
        
        const { container } = render(<UndoHistoryPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('should render panel when open', () => {
        const { container } = render(<UndoHistoryPanel />);
        expect(screen.getByText(/Undo History/i)).toBeInTheDocument();
    });

    it('should render empty state when no history', () => {
        render(<UndoHistoryPanel />);
        expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    });

    it('should render close button', () => {
        render(<UndoHistoryPanel />);
        expect(screen.getByLabelText(/Close undo history/i)).toBeInTheDocument();
    });

    it('should call closeUndoHistory when close button is clicked', () => {
        const { closeUndoHistory } = await import('#/modules/Workspace/useCases/togglePanel/panelToggles');
        render(<UndoHistoryPanel />);
        const closeButton = screen.getByLabelText(/Close undo history/i);
        fireEvent.click(closeButton);
        expect(closeUndoHistory).toHaveBeenCalled();
    });
});
