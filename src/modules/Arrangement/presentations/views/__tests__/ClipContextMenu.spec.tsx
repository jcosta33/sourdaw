import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { describeDetectedKey, detectKey, detectTempo } from '#/modules/AudioAnalysis/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { duplicateClip } from '../../../useCases/clip/duplicateClip';
import { removeClip } from '../../../useCases/clip/removeClip';
import { normalizeClip } from '../../../useCases/clipEditing/normalizeClip';
import { renameClip } from '../../../useCases/clipEditing/renameClip';
import { reverseClip } from '../../../useCases/clipEditing/reverseClip';
import { ClipContextMenu } from '../ClipContextMenu';

type TrackStoreSubscribe = (typeof import('../../../stores/trackStore'))['trackStore']['subscribe'];
type TrackStoreSubscribeReact = (typeof import('../../../stores/trackStore'))['trackStore']['subscribeReact'];

// useStore reads via getSnapshot(); clipSelectionStore must reflect clipSelectionStore.set() in tests.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { getSnapshot?: () => unknown; value?: unknown }, defaultValue: unknown) => {
        const snap = typeof store.getSnapshot === 'function' ? store.getSnapshot() : store.value;
        return snap ?? defaultValue;
    }),
}));

vi.mock('../../../stores/trackStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/trackStore')>();
    const { createTrack } = await import('../../../models/Track');
    const subscribers = new Set<Parameters<TrackStoreSubscribe>[0]>();
    const reactSubscribers = new Set<Parameters<TrackStoreSubscribeReact>[0]>();
    let value: typeof actual.trackStore.value = {
        tracks: [
            {
                ...createTrack({
                    id: 't1',
                    name: 'Track 1',
                    kind: 'audio',
                    color: '#808080',
                    initialAlternativeId: 'alt-1',
                    withoutDefaultDevice: true,
                }),
                clips: [
                    {
                        id: 'clip1',
                        trackId: 't1',
                        name: 'Test',
                        type: 'audio',
                        startBeat: 0,
                        endBeat: 4,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#808080',
                        locked: false,
                        muted: false,
                    },
                    {
                        id: 'clip2',
                        trackId: 't1',
                        name: 'Test With Buffer',
                        type: 'audio',
                        startBeat: 4,
                        endBeat: 8,
                        audioBufferId: 'buffer-2',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#808080',
                        locked: false,
                        muted: false,
                    },
                    {
                        id: 'midi1',
                        trackId: 't1',
                        name: 'MIDI Clip',
                        type: 'midi',
                        startBeat: 0,
                        endBeat: 4,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#808080',
                        locked: false,
                        muted: false,
                        isInlineEditing: true,
                    },
                ],
            },
        ],
        selectedTrackId: null,
    };
    const trackStore = {
        ...actual.trackStore,
        get value(): typeof actual.trackStore.value {
            return value;
        },
        set: vi.fn((nextValue: Parameters<(typeof actual.trackStore)['set']>[0]) => {
            value = nextValue;
            for (const callback of subscribers) {
                try {
                    callback(value);
                } catch {
                    // Listener failures must not prevent later listeners from being notified.
                }
            }
            for (const listener of reactSubscribers) {
                try {
                    listener();
                } catch {
                    // Listener failures must not prevent later listeners from being notified.
                }
            }
        }),
        subscribe: vi.fn<TrackStoreSubscribe>((callback) => {
            subscribers.add(callback);
            return () => subscribers.delete(callback);
        }),
        subscribeReact: vi.fn<TrackStoreSubscribeReact>((listener) => {
            reactSubscribers.add(listener);
            return () => reactSubscribers.delete(listener);
        }),
        getSnapshot: vi.fn(() => value),
    };

    return { ...actual, trackStore };
});

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

vi.mock('../../../useCases/clipEditing/normalizeClip', () => ({
    normalizeClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/reverseClip', () => ({
    reverseClip: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    clearUndoHistory: vi.fn(),
    isAppActionCommittedError: vi.fn(() => false),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
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

    it('uses the same track store through the defining module and public barrel', async () => {
        const [{ trackStore: definingTrackStore }, { trackStore: barrelTrackStore }] = await Promise.all([
            import('../../../stores/trackStore'),
            import('#/modules/Arrangement/stores'),
        ]);
        const previous = definingTrackStore.value;
        if (!previous) {
            throw new Error('Expected the track fixture to contain a value');
        }
        const selected = { ...previous, selectedTrackId: 't1' };

        try {
            expect(barrelTrackStore).toBe(definingTrackStore);
            definingTrackStore.set(selected);
            expect(barrelTrackStore.value).toBe(selected);
            expect(barrelTrackStore.getSnapshot()).toBe(selected);

            barrelTrackStore.set(previous);
            expect(definingTrackStore.value).toBe(previous);
            expect(definingTrackStore.getSnapshot()).toBe(previous);
        } finally {
            definingTrackStore.set(previous);
        }
    });

    it('keeps both reactive track store subscriber channels on one snapshot', async () => {
        const { trackStore } = await import('../../../stores/trackStore');
        const previous = trackStore.value;
        if (!previous) {
            throw new Error('Expected the track fixture to contain a value');
        }
        const subscriber = vi.fn();
        const reactSubscriber = vi.fn();
        const unsubscribe = trackStore.subscribe(subscriber);
        const unsubscribeReact = trackStore.subscribeReact(reactSubscriber);
        const selected = { ...previous, selectedTrackId: 't1' };

        try {
            trackStore.set(selected);
            expect(subscriber).toHaveBeenCalledOnce();
            expect(subscriber).toHaveBeenCalledWith(selected);
            expect(reactSubscriber).toHaveBeenCalledOnce();
            expect(trackStore.getSnapshot()).toBe(selected);
            expect(trackStore.value).toBe(selected);

            unsubscribe();
            unsubscribeReact();
            trackStore.set(previous);
            expect(subscriber).toHaveBeenCalledOnce();
            expect(reactSubscriber).toHaveBeenCalledOnce();
            expect(trackStore.getSnapshot()).toBe(previous);
            expect(trackStore.value).toBe(previous);
        } finally {
            unsubscribe();
            unsubscribeReact();
            trackStore.set(previous);
        }
    });

    it('isolates reactive track store listener failures and cleans up subscriptions', async () => {
        const { trackStore } = await import('../../../stores/trackStore');
        const previous = trackStore.value;
        if (!previous) {
            throw new Error('Expected the track fixture to contain a value');
        }

        const failingSubscriber = vi.fn<Parameters<TrackStoreSubscribe>[0]>(() => {
            throw new Error('legacy subscriber failed');
        });
        const laterSubscriber = vi.fn();
        const failingReactSubscriber = vi.fn<Parameters<TrackStoreSubscribeReact>[0]>(() => {
            throw new Error('React subscriber failed');
        });
        const laterReactSubscriber = vi.fn();
        const selected = { ...previous, selectedTrackId: 't1' };

        let unsubscribeFailing: (() => void) | undefined;
        let unsubscribeLater: (() => void) | undefined;
        let unsubscribeFailingReact: (() => void) | undefined;
        let unsubscribeLaterReact: (() => void) | undefined;

        try {
            unsubscribeFailing = trackStore.subscribe(failingSubscriber);
            unsubscribeLater = trackStore.subscribe(laterSubscriber);
            unsubscribeFailingReact = trackStore.subscribeReact(failingReactSubscriber);
            unsubscribeLaterReact = trackStore.subscribeReact(laterReactSubscriber);

            expect(() => trackStore.set(selected)).not.toThrow();
            expect(failingSubscriber).toHaveBeenCalledOnce();
            expect(laterSubscriber).toHaveBeenCalledOnce();
            expect(failingReactSubscriber).toHaveBeenCalledOnce();
            expect(laterReactSubscriber).toHaveBeenCalledOnce();

            unsubscribeFailing();
            unsubscribeLater();
            unsubscribeFailingReact();
            unsubscribeLaterReact();
            trackStore.set(previous);

            expect(failingSubscriber).toHaveBeenCalledOnce();
            expect(laterSubscriber).toHaveBeenCalledOnce();
            expect(failingReactSubscriber).toHaveBeenCalledOnce();
            expect(laterReactSubscriber).toHaveBeenCalledOnce();
        } finally {
            unsubscribeFailing?.();
            unsubscribeLater?.();
            unsubscribeFailingReact?.();
            unsubscribeLaterReact?.();
            trackStore.set(previous);
        }
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

    it('routes Normalize through the undoable command path, not the bare use case', () => {
        render(<ClipContextMenu x={100} y={100} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Normalize' }));

        expect(executeAppAction).toHaveBeenCalledWith({ type: 'normalizeClip', payload: { clipId: 'clip1' } });
        expect(normalizeClip).not.toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('routes Reverse through the undoable command path, not the bare use case', () => {
        render(<ClipContextMenu x={100} y={100} clipId="clip1" splitBeat={4} onClose={mockOnClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));

        expect(executeAppAction).toHaveBeenCalledWith({ type: 'reverseClip', payload: { clipId: 'clip1' } });
        expect(reverseClip).not.toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
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
        const { trackStore } = await import('../../../stores/trackStore');
        const previous = trackStore.value;
        const track = previous?.tracks[0];
        const clip = track?.clips[0];
        if (!previous || !track || !clip) {
            throw new Error('Expected the track fixture to contain a clip');
        }
        try {
            trackStore.set({
                ...previous,
                tracks: [
                    {
                        ...track,
                        clips: [
                            {
                                ...clip,
                                id: 'clipM',
                                name: 'Muted',
                                muted: true,
                                locked: true,
                                audioBufferId: 'bufM',
                            },
                        ],
                    },
                ],
            });
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
            trackStore.set(previous);
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
        const track = previous?.tracks[0];
        const clip = track?.clips[0];
        if (!previous || !track || !clip) {
            throw new Error('Expected the track fixture to contain a clip');
        }
        try {
            trackStore.set({
                ...previous,
                tracks: [
                    {
                        ...track,
                        clips: [
                            {
                                ...clip,
                                id: 'midiPlain',
                                name: 'Plain MIDI',
                                type: 'midi',
                                isInlineEditing: false,
                            },
                        ],
                    },
                ],
            });
            render(<ClipContextMenu x={0} y={0} clipId="midiPlain" splitBeat={4} onClose={mockOnClose} />);
            expect(screen.getByRole('button', { name: 'Open Inline Editor' })).toBeInTheDocument();
        } finally {
            trackStore.set(previous);
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
