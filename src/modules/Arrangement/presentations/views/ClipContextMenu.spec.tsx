import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipContextMenu } from './ClipContextMenu';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: {
        value: { selectedClipIds: [] },
    },
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: {
        value: { tracks: [] },
    },
}));

vi.mock('#/helpers/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('../../useCases/clip/removeClip', () => ({
    removeClip: vi.fn(),
}));

vi.mock('../../useCases/clip/duplicateClip', () => ({
    duplicateClip: vi.fn(),
}));

vi.mock('../../useCases/clip/renameClip', () => ({
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
        workspaceStore.value = { selectedClipIds: [] };
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
        workspaceStore.value = {
            selectedClipIds: ['clip1', 'clip2', 'clip3'],
        };

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
