import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { detectKey, detectTempo } from '#/modules/AudioAnalysis/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { duplicateClip } from '../../../useCases/clip/duplicateClip';
import { removeClip } from '../../../useCases/clip/removeClip';
import { renameClip } from '../../../useCases/clipEditing/renameClip';
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
                        {
                            id: 'midi1',
                            name: 'MIDI Clip',
                            type: 'midi',
                            startBeat: 0,
                            endBeat: 4,
                            isInlineEditing: true,
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

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: vi.fn(),
    detectKey: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

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

vi.mock('#/components/daw/DawMenuInlineEditor', () => ({
    DawMenuInlineEditor: ({ value, onChange, onSubmit, onCancel, label }: any) => (
        <div data-testid="inline-editor">
            <span>{label}</span>
            <input value={value} onChange={(event) => onChange(event.target.value)} />
            <button onClick={() => onSubmit()}>Submit</button>
            <button onClick={() => onCancel()}>Cancel</button>
        </div>
    ),
}));

vi.mock('#/components/daw/DawSwatchButton', () => ({
    DawSwatchButton: ({ color, onClick, 'aria-label': ariaLabel }: any) => (
        <button onClick={onClick} aria-label={ariaLabel} data-color={color}>
            swatch
        </button>
    ),
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

    it('removes every selected clip on multi-select delete', () => {
        clipSelectionStore.set({
            ...defaultClipSelectionState,
            selectedClipIds: ['clip1', 'clip2'],
        });
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
        expect(removeClip).toHaveBeenCalledWith('clip1');
        expect(removeClip).toHaveBeenCalledWith('clip2');
    });

    it('duplicates every selected clip on multi-select duplicate', () => {
        clipSelectionStore.set({
            ...defaultClipSelectionState,
            selectedClipIds: ['clip1', 'clip2'],
        });
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: /^Duplicate/ }));
        expect(duplicateClip).toHaveBeenCalledWith('clip1');
        expect(duplicateClip).toHaveBeenCalledWith('clip2');
    });

    it('notifies the detected tempo when detectTempo returns a bpm', () => {
        vi.mocked(detectTempo).mockReturnValue(128);
        render(<ClipContextMenu x={0} y={0} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Tempo' }));
        expect(detectTempo).toHaveBeenCalledWith('buffer-2');
        expect(notifyUser).toHaveBeenCalledWith('Detected tempo: 128 BPM');
    });

    it('notifies failure when detectTempo returns null', () => {
        vi.mocked(detectTempo).mockReturnValue(null);
        render(<ClipContextMenu x={0} y={0} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Tempo' }));
        expect(notifyUser).toHaveBeenCalledWith('Could not detect tempo');
    });

    it('notifies the detected key when detectKey returns a result', () => {
        vi.mocked(detectKey).mockReturnValue({ key: 'C', mode: 'major', confidence: 0.875 });
        render(<ClipContextMenu x={0} y={0} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Key' }));
        expect(detectKey).toHaveBeenCalledWith('buffer-2');
        expect(notifyUser).toHaveBeenCalledWith('Detected key: C major (88% confidence)');
    });

    it('notifies failure when detectKey returns null', () => {
        vi.mocked(detectKey).mockReturnValue(null);
        render(<ClipContextMenu x={0} y={0} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Key' }));
        expect(notifyUser).toHaveBeenCalledWith('Could not detect key');
    });

    it('renders the close-inline-editor label for a midi clip already editing inline', () => {
        render(<ClipContextMenu x={0} y={0} clipId="midi1" splitBeat={4} onClose={mockOnClose} />);
        expect(screen.getByRole('button', { name: 'Close Inline Editor' })).toBeInTheDocument();
    });

    it('renames the clip on submit when the new name is non-empty', () => {
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Clip' }));
        const changeInput = screen.getByTestId('inline-editor').querySelector('input') as HTMLInputElement;
        fireEvent.change(changeInput, { target: { value: '  Renamed  ' } });
        fireEvent.click(screen.getByText('Submit'));
        // renameClip fires only when the trimmed name is non-empty.
        expect(renameClip).toHaveBeenCalledWith('clip1', 'Renamed');
    });

    it('does not rename when the submitted name is blank', () => {
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Clip' }));
        const changeInput = screen.getByTestId('inline-editor').querySelector('input') as HTMLInputElement;
        fireEvent.change(changeInput, { target: { value: '   ' } });
        fireEvent.click(screen.getByText('Submit'));
        expect(renameClip).not.toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('cancels rename without renaming', () => {
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Clip' }));
        fireEvent.click(screen.getByText('Cancel'));
        expect(renameClip).not.toHaveBeenCalled();
    });
});
