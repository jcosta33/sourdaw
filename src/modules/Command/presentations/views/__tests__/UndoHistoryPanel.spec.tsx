import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { UndoHistoryPanel } from '../UndoHistoryPanel';

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

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: { name: 'workspaceStore' },
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    closeUndoHistory: vi.fn(),
}));

vi.mock('#/modules/Command/useCases/undoToIndex', () => ({
    undoToIndex: vi.fn(),
}));

const { useStore } = await import('#/infra/store/useStore');
const { undoToIndex } = await import('#/modules/Command/useCases/undoToIndex');
const { closeUndoHistory } = await import('#/modules/WorkspaceShell/useCases');

describe('UndoHistoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render null when panel is closed', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: false };
            }
            return { past: [], future: [] };
        });

        const { container } = render(<UndoHistoryPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('should render panel when open', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { past: [], future: [] };
        });

        render(<UndoHistoryPanel />);
        expect(screen.getByText(/Undo History/i)).toBeInTheDocument();
    });

    it('should render empty state when no history', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { past: [], future: [] };
        });

        render(<UndoHistoryPanel />);
        expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    });

    it('should render close button', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { past: [], future: [] };
        });

        render(<UndoHistoryPanel />);
        expect(screen.getByLabelText(/Close undo history/i)).toBeInTheDocument();
    });

    it('should call closeUndoHistory when close button is clicked', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { past: [], future: [] };
        });

        render(<UndoHistoryPanel />);
        const closeButton = screen.getByLabelText(/Close undo history/i);
        fireEvent.click(closeButton);
        expect(closeUndoHistory).toHaveBeenCalled();
    });

    it('renders an atomic transaction group as one stable reachable history unit', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return {
                past: [
                    {
                        kind: 'action',
                        id: 'group-first',
                        label: 'Grouped edit',
                        timestamp: 1,
                        source: 'ai',
                        action: { type: 'togglePlayback' },
                        inverseAction: { type: 'togglePlayback' },
                        transactionGroupId: 'group-1',
                    },
                    {
                        kind: 'action',
                        id: 'group-second',
                        label: 'Grouped edit',
                        timestamp: 2,
                        source: 'ai',
                        action: { type: 'toggleLoop' },
                        inverseAction: { type: 'toggleLoop' },
                        transactionGroupId: 'group-1',
                    },
                ],
                future: [],
            };
        });

        render(<UndoHistoryPanel />);

        const grouped_row = screen.getByText('Grouped edit');
        fireEvent.click(grouped_row);
        expect(screen.getAllByText('Grouped edit')).toHaveLength(1);
        expect(undoToIndex).toHaveBeenCalledWith('transaction:group-1');
    });
});
