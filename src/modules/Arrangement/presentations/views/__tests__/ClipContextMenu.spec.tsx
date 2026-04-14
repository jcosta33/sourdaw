import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipContextMenu } from '../ClipContextMenu';
import { defaultWorkspaceState, workspaceStore } from '#/modules/Workspace/stores';

// useStore reads via getSnapshot(); workspaceStore must reflect workspaceStore.set() in tests.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { getSnapshot?: () => unknown; value?: unknown }, defaultValue: unknown) => {
        const snap = typeof store.getSnapshot === 'function' ? store.getSnapshot() : store.value;
        return snap ?? defaultValue;
    }),
}));

vi.mock('../../../stores/trackStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/trackStore')>()),
    trackStore: {
        value: {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'clip1',
                            name: 'Test',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 4,
                        },
                    ],
                },
            ],
        },
    },
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('../../../useCases/clip/removeClip', () => ({
    removeClip: vi.fn(),
}));

vi.mock('../../../useCases/clip/duplicateClip', () => ({
    duplicateClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/renameClip', () => ({
    renameClip: vi.fn(),
}));

vi.mock('#/modules/Command/useCases/pushUndoEntry', () => ({
    pushUndoEntry: vi.fn(),
}));

// Mock UI components
vi.mock('#/components/daw/DawContextMenuSurface', () => ({
    DawContextMenuSurface: ({ children, x, y }: any) => (
        <div data-testid="context-menu-surface" style={{ left: x, top: y }}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuButton: ({ children, onClick, disabled, shortcut }: any) => (
        <button onClick={onClick} disabled={disabled} data-shortcut={shortcut}>
            {children}
        </button>
    ),
    DawMenuSectionLabel: ({ children }: any) => <div>{children}</div>,
    DawMenuSeparator: () => <hr />,
    DawMenuMutedRow: ({ children }: any) => <div>{children}</div>,
    DawMenuDisabledRow: ({ children }: any) => <div>{children}</div>,
}));

describe('ClipContextMenu', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ ...defaultWorkspaceState, selectedClipIds: [] });
    });

    it('should render without crashing', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={4}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText(/Split/i)).toBeInTheDocument();
    });

    it('should render at correct position', () => {
        render(
            <ClipContextMenu
                x={150}
                y={200}
                clipId="clip1"
                splitBeat={4}
                onClose={mockOnClose}
            />
        );
        const surface = screen.getByTestId('context-menu-surface');
        expect(surface).toHaveStyle({ left: '150px', top: '200px' });
    });

    it('should show multi-select info when multiple clips selected', () => {
        workspaceStore.set({
            ...defaultWorkspaceState,
            selectedClipIds: ['clip1', 'clip2', 'clip3'],
        });

        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('3 clips selected')).toBeInTheDocument();
    });
});
