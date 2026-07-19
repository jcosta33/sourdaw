import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';

import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { ClipContextMenu } from '../ClipContextMenu';

// useStore reads via getSnapshot(); clipSelectionStore must reflect clipSelectionStore.set() in tests.
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
                        {
                            id: 'clip2',
                            name: 'Test With Buffer',
                            type: 'audio',
                            startBeat: 4,
                            endBeat: 8,
                            audioBufferId: 'buffer-2',
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

vi.mock('#/modules/Command/useCases', () => {
    const commitUndo = vi.fn();
    return {
        pushUndoEntry: commitUndo,
        runLegacyCommandMutation: (mutation: (publishUndo: typeof commitUndo) => unknown) =>
            Promise.resolve(mutation(commitUndo)),
    };
});

vi.mock('#/modules/AiGeneration/useCases', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

// Invoke the action immediately so the denoise dispatch is observable.
vi.mock('#/modules/AiRuntime/useCases', () => ({
    runAiActionWithToast: vi.fn((action: () => unknown) => {
        void action();
        return Promise.resolve();
    }),
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
        clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipIds: [] });
    });

    it('should render without crashing', () => {
        render(<ClipContextMenu x={100} y={100} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        expect(screen.getByText(/Split/i)).toBeInTheDocument();
    });

    it('should render at correct position', () => {
        render(<ClipContextMenu x={150} y={200} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        const surface = screen.getByTestId('context-menu-surface');
        expect(surface).toHaveStyle({ left: '150px', top: '200px' });
    });

    it('should show multi-select info when multiple clips selected', () => {
        clipSelectionStore.set({
            ...defaultClipSelectionState,
            selectedClipIds: ['clip1', 'clip2', 'clip3'],
        });

        render(<ClipContextMenu x={100} y={100} clipId="clip1" splitBeat={8} onClose={mockOnClose} />);
        expect(screen.getByText('3 clips selected')).toBeInTheDocument();
    });

    it('dispatches denoise keyed on the clip audioBufferId', () => {
        // handleAiDenoiseClip treats its argument as a cache bufferId (writes
        // `${id}-denoised`); the Inspector A/B reads `${clip.audioBufferId}-denoised`.
        render(<ClipContextMenu x={100} y={100} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Denoise' }));

        expect(handleAiDenoiseClip).toHaveBeenCalledWith('buffer-2', 0.7);
    });

    it('does not dispatch denoise for a clip without an audioBufferId', () => {
        // clip1 has no audioBufferId: there is no cache entry to denoise and no
        // key the consumer could reconstruct — the entry must no-op.
        render(<ClipContextMenu x={100} y={100} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Denoise' }));

        expect(handleAiDenoiseClip).not.toHaveBeenCalled();
    });
});
