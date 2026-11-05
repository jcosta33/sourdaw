import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type UndoEntry } from '../../../models/UndoEntry';
import { undoStore } from '../../../stores/undoStore';
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

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: { name: 'workspaceStore' },
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    closeUndoHistory: vi.fn(),
}));

vi.mock('#/modules/Command/useCases/moveHistoryToStep', () => ({
    moveHistoryToStep: vi.fn(),
}));

const { useStore } = await import('#/infra/store/useStore');
const { closeUndoHistory } = await import('#/modules/WorkspaceShell/useCases');
const { moveHistoryToStep } = await import('#/modules/Command/useCases/moveHistoryToStep');

function entry(id: string, groupId?: string): UndoEntry {
    const row: UndoEntry = {
        kind: 'callback',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        undo: () => undefined,
        redo: () => undefined,
    };
    if (groupId) {
        row.groupId = groupId;
    }
    return row;
}

/** Opens the panel over the real undo history. */
function openPanelOverHistory(): void {
    (useStore as ReturnType<typeof vi.fn>).mockImplementation((store, defaultValue) => {
        if (store?.name === 'workspaceStore') {
            return { undoHistoryOpen: true };
        }
        return store.getSnapshot() ?? defaultValue;
    });
}

describe('UndoHistoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        undoStore.set({ past: [], future: [] });
    });

    it('should render null when panel is closed', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: false };
            }
            return { pastSteps: [], futureSteps: [] };
        });

        const { container } = render(<UndoHistoryPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('should render panel when open', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { pastSteps: [], futureSteps: [] };
        });

        render(<UndoHistoryPanel />);
        expect(screen.getByText(/Undo History/i)).toBeInTheDocument();
    });

    it('should render empty state when no history', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { pastSteps: [], futureSteps: [] };
        });

        render(<UndoHistoryPanel />);
        expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    });

    it('should render close button', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { pastSteps: [], futureSteps: [] };
        });

        render(<UndoHistoryPanel />);
        expect(screen.getByLabelText(/Close undo history/i)).toBeInTheDocument();
    });

    it('should call closeUndoHistory when close button is clicked', () => {
        (useStore as ReturnType<typeof vi.fn>).mockImplementation((store) => {
            if (store?.name === 'workspaceStore') {
                return { undoHistoryOpen: true };
            }
            return { pastSteps: [], futureSteps: [] };
        });

        render(<UndoHistoryPanel />);
        const closeButton = screen.getByLabelText(/Close undo history/i);
        fireEvent.click(closeButton);
        expect(closeUndoHistory).toHaveBeenCalled();
    });

    it('lists a grouped gesture as one row and keeps a clicked older past step applied', () => {
        undoStore.set({
            past: [
                entry('first'),
                entry('drag a', 'drag'),
                entry('drag b', 'drag'),
                entry('drag c', 'drag'),
                entry('last'),
            ],
            future: [],
        });
        openPanelOverHistory();

        render(<UndoHistoryPanel />);

        expect(screen.getByText('drag c')).toBeInTheDocument();
        expect(screen.queryByText('drag a')).not.toBeInTheDocument();
        expect(screen.queryByText('drag b')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('drag c'));
        expect(moveHistoryToStep).toHaveBeenCalledWith('drag c');
    });

    it('redoes through the whole clicked future step', () => {
        undoStore.set({
            past: [entry('first')],
            future: [entry('drag a', 'drag'), entry('drag b', 'drag'), entry('drag c', 'drag'), entry('last')],
        });
        openPanelOverHistory();

        render(<UndoHistoryPanel />);

        expect(screen.queryByText('drag b')).not.toBeInTheDocument();
        expect(screen.queryByText('drag c')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('drag a'));
        expect(moveHistoryToStep).toHaveBeenCalledWith('drag c');

        fireEvent.click(screen.getByText('last'));
        expect(moveHistoryToStep).toHaveBeenLastCalledWith('last');
    });

    it('leaves a fully inert unit out of the rows', () => {
        const inert: UndoEntry = {
            kind: 'action',
            id: 'cut clip',
            label: 'cut clip',
            timestamp: 0,
            source: 'manual',
            action: { type: 'togglePlayback' },
            inverseAction: null,
        };
        undoStore.set({ past: [entry('move clip'), inert], future: [] });
        openPanelOverHistory();

        render(<UndoHistoryPanel />);

        expect(screen.getByText('move clip')).toBeInTheDocument();
        expect(screen.queryByText('cut clip')).not.toBeInTheDocument();
    });
});
