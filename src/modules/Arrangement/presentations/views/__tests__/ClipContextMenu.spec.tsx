import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { describeDetectedKey, detectKey, detectTempo } from '#/modules/AudioAnalysis/useCases';
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
        subscribe: vi.fn(() => () => undefined),
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

vi.mock('../../../useCases/clipEditing/muteClip', () => ({
    muteClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/lockClip', () => ({
    lockClip: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: vi.fn(),
    detectKey: vi.fn(),
    describeDetectedKey: vi.fn(),
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

    it('routes the detection result through the shared description before notifying', () => {
        const result = { detected: true, key: 'C', mode: 'major', confidence: 0.875 } as const;
        vi.mocked(detectKey).mockReturnValue(result);
        vi.mocked(describeDetectedKey).mockReturnValue('Detected key: C major (88% confidence)');
        render(<ClipContextMenu x={0} y={0} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Key' }));
        expect(detectKey).toHaveBeenCalledWith('buffer-2');
        expect(describeDetectedKey).toHaveBeenCalledWith(result);
        expect(notifyUser).toHaveBeenCalledWith('Detected key: C major (88% confidence)');
    });

    it('hands the no-key result to the same description rather than inventing a message', () => {
        // The menu must not phrase results itself: an atonal reading has to
        // reach the user as the detector's own wording.
        vi.mocked(detectKey).mockReturnValue({ detected: false });
        vi.mocked(describeDetectedKey).mockReturnValue('No key detected: the audio is atonal or broadband');
        render(<ClipContextMenu x={0} y={0} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Key' }));
        expect(describeDetectedKey).toHaveBeenCalledWith({ detected: false });
        expect(notifyUser).toHaveBeenCalledWith('No key detected: the audio is atonal or broadband');
    });

    it('notifies failure when detectKey returns null', () => {
        vi.mocked(detectKey).mockReturnValue(null);
        vi.mocked(describeDetectedKey).mockReturnValue('Could not detect key: no audio to analyse');
        render(<ClipContextMenu x={0} y={0} clipId="clip2" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Key' }));
        expect(describeDetectedKey).toHaveBeenCalledWith(null);
        expect(notifyUser).toHaveBeenCalledWith('Could not detect key: no audio to analyse');
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

    it('shows Unmute/Lock toggles and dispatches the inverse state for a muted+locked clip', async () => {
        // Add a muted, locked audio clip to the mocked track store via a fresh
        // render with a controllable store snapshot.
        const { trackStore } = await import('../../../stores/trackStore');
        const previous = trackStore.value;
        (trackStore as unknown as { value: unknown }).value = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        {
                            id: 'clipM',
                            name: 'Muted',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 4,
                            muted: true,
                            locked: true,
                            audioBufferId: 'bufM',
                        },
                    ],
                },
            ],
        };
        try {
            render(<ClipContextMenu x={0} y={0} clipId="clipM" splitBeat={4} onClose={mockOnClose} />);
            // Muted+locked → the labels flip to the inverse action.
            expect(screen.getByRole('button', { name: 'Unmute Clip' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Unlock Clip' })).toBeInTheDocument();

            const { muteClip } = await import('../../../useCases/clipEditing/muteClip');
            const { lockClip } = await import('../../../useCases/clipEditing/lockClip');
            fireEvent.click(screen.getByRole('button', { name: 'Unmute Clip' }));
            // isMuted true → toggles to false.
            expect(muteClip).toHaveBeenCalledWith('clipM', false);
            fireEvent.click(screen.getByRole('button', { name: 'Unlock Clip' }));
            expect(lockClip).toHaveBeenCalledWith('clipM', false);
        } finally {
            (trackStore as unknown as { value: unknown }).value = previous;
        }
    });

    it('deletes only the targeted clip when a single clip is selected', () => {
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
        // Single selection → the else branch removes just the one clip.
        expect(removeClip).toHaveBeenCalledTimes(1);
        expect(removeClip).toHaveBeenCalledWith('clip1');
    });

    it('duplicates only the targeted clip when a single clip is selected', () => {
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        // "Duplicate to Next Bar" also renders in single-select, so target the
        // main Duplicate button by its exact accessible name.
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        expect(duplicateClip).toHaveBeenCalledTimes(1);
        expect(duplicateClip).toHaveBeenCalledWith('clip1');
    });

    it('skips tempo and key detection for a clip without an audioBufferId', () => {
        // clip1 has no audioBufferId: both Detect Tempo and Detect Key must
        // short-circuit and never call their analysis use cases.
        render(<ClipContextMenu x={0} y={0} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Detect Tempo' }));
        expect(detectTempo).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Detect Key' }));
        expect(detectKey).not.toHaveBeenCalled();
    });

    it('shows the Open Inline Editor toggle for a midi clip not yet editing inline', async () => {
        const { trackStore } = await import('../../../stores/trackStore');
        const previous = trackStore.value;
        (trackStore as unknown as { value: unknown }).value = {
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'midiPlain', name: 'Plain MIDI', type: 'midi', startBeat: 0, endBeat: 4 }],
                },
            ],
        };
        try {
            render(<ClipContextMenu x={0} y={0} clipId="midiPlain" splitBeat={4} onClose={mockOnClose} />);
            expect(screen.getByRole('button', { name: 'Open Inline Editor' })).toBeInTheDocument();
        } finally {
            (trackStore as unknown as { value: unknown }).value = previous;
        }
    });

    it('initialises the rename field to an empty string when the clip cannot be found', () => {
        // A clipId that matches no clip leaves `clip` undefined, so the
        // `clip?.name ?? ''` fallback seeds an empty rename input.
        render(<ClipContextMenu x={0} y={0} clipId="missing" splitBeat={4} onClose={mockOnClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Clip' }));
        const input = screen.getByTestId('inline-editor').querySelector('input') as HTMLInputElement;
        expect(input.value).toBe('');
    });
});
