import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { setScrollX } from '#/modules/Arrangement/stores';
import {
    addTrack,
    addClip,
    importMidiFile,
    setTimelineHorizontalScrollbarScrollX,
} from '#/modules/Arrangement/useCases';
import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { defaultWorkspaceState } from '#/modules/WorkspaceShell/stores';
import { ARRANGE_RESIZE_HANDLE_WIDTH, MIN_TIMELINE_COLUMN_WIDTH } from '#/utils/Layout/allocateMainFirstWidths';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip, type Track } from '../../../models/TrackViewTypes';
import { useTracks } from '../../hooks/useTracks';
import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { ArrangeView } from '../ArrangeView';

const preferencesMocks = vi.hoisted(() => ({
    store: {
        value: {
            preferencesSchemaVersion: 1,
            showMinimap: true,
            timelineMinimapHeight: 28,
        },
    },
    setTimelineMinimapHeight: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { value: unknown }, fallback?: unknown) => {
        if (store === preferencesMocks.store) {
            return preferencesMocks.store.value;
        }
        return fallback ?? store.value;
    }),
}));

// Non-spread listing of only the names ArrangeView imports — avoids loading real
// TimelineSurface / TrackListView and the incidental Arrangement / AudioEngine
// useCases barrel walk their modules pull in. A listing factory must still include
// every name ArrangeView actually imports, or render hits `undefined` (#1393).
vi.mock('#/modules/Arrangement/presentations/views', () => ({
    AdjustmentLayerStrip: () => <div data-testid="adjustment-layer-strip">Adjustment Layer Strip</div>,
    getAdjustmentLayerStripHeight: (layerCount: number) => (layerCount > 0 ? 28 + layerCount * 18 : 0),
    TimelineSurface: () => <div data-testid="timeline-surface">Timeline Surface</div>,
    TimelineMinimap: ({ height }: { height: number }) => (
        <div data-testid="timeline-minimap" data-height={height}>
            Timeline Minimap
        </div>
    ),
    ArrangementBar: () => <div data-testid="arrangement-bar">Arrangement Bar</div>,
    MarkerLane: () => <div data-testid="marker-lane">Marker Lane</div>,
    BeatRulerBar: () => <div data-testid="beat-ruler">Beat Ruler</div>,
    TimelineChromeSurface: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
    TrackListView: ({ style, extraHeaderHeight }: { style?: React.CSSProperties; extraHeaderHeight?: number }) => (
        <div data-testid="track-list-view" style={style} data-extra-height={extraHeaderHeight} />
    ),
    ARRANGEMENT_BAR_HEIGHT: 22,
    BEAT_RULER_HEIGHT: 18,
    MARKER_LANE_HEIGHT: 20,
}));

// Non-spread listing of only SessionView — avoids loading LoopStationPanel from
// the SessionLauncher views barrel and its incidental Transport/Arrangement/
// AudioEngine useCases barrel walk.
vi.mock('#/modules/SessionLauncher/presentations/views', () => ({
    SessionView: () => <div data-testid="session-view">Session</div>,
}));

vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: preferencesMocks.store,
    normalizeTimelineMinimapHeight: (height: number) => Math.min(160, Math.max(28, Math.round(height))),
    TIMELINE_MINIMAP_DEFAULT_HEIGHT: 28,
}));

vi.mock('#/modules/Preferences/useCases', () => ({
    setTimelineMinimapHeight: preferencesMocks.setTimelineMinimapHeight,
    TRACK_HEIGHT_VALUES: { compact: 40, normal: 64, large: 96 },
    defaultPreferences: {},
    gridSnapBeats: vi.fn(() => 0),
    setTrackHeight: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    timelineViewStore: { value: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true } },
    setScrollX: vi.fn(),
    markerStore: { value: { markers: [], sections: [] } },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    chordTrackStore: { value: { enabled: false, events: [] } },
    defaultChordTrackState: { enabled: false, events: [] },
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [] })),
}));

vi.mock('../../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(() => ({
        trackListOpen: true,
        trackListWidth: 200,
        scratchPadOpen: false,
        scratchPadHeight: 150,
    })),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    closeScratchPad: vi.fn(),
    setSessionViewWidth: vi.fn(),
    setTrackListWidth: vi.fn(),
    closeCollaborationPanel: vi.fn(),
    onScrollToPlayhead: vi.fn(),
    onZoomToFit: vi.fn(),
    onZoomToSelection: vi.fn(),
    setWorkspaceMode: vi.fn(),
}));

vi.mock('../../components/ResizeHandle', () => ({
    ResizeHandle: ({
        direction,
        onResize: _onResize,
        onResizeEnd: _onResizeEnd,
    }: {
        direction: string;
        onResize: (delta: number) => void;
        onResizeEnd: () => void;
    }) => <div data-testid="resize-handle" data-direction={direction} />,
}));

vi.mock('../TimelineMinimapResizeHandle', () => ({
    TimelineMinimapResizeHandle: ({
        height,
        persistedHeight,
        onPreview,
        onCommit,
        onCancel,
    }: {
        height: number;
        persistedHeight: number;
        onPreview: (height: number) => void;
        onCommit: (height: number) => void;
        onCancel: () => void;
    }) => (
        <div
            role="separator"
            aria-label="Resize timeline minimap"
            data-testid="timeline-minimap-resize-handle"
            data-height={height}
            data-persisted-height={persistedHeight}
            onPointerMove={() => onPreview(96)}
            onPointerUp={() => onCommit(96)}
            onPointerCancel={onCancel}
        />
    ),
}));

vi.mock('../Timeline/ChordTrackLane', () => ({
    ChordTrackLane: () => <div data-testid="chord-track-lane">Chord Track Lane</div>,
}));

vi.mock('../Timeline/ScratchPadView', () => ({
    ScratchPadView: ({ height }: { height: number }) => (
        <div data-testid="scratch-pad-view" style={{ height }}>
            Scratch Pad
        </div>
    ),
}));

vi.mock('../ArrangeEmptyStateShell', () => ({
    ArrangeEmptyStateShell: ({ active, children }: { active?: boolean; children: React.ReactNode }) => (
        <div data-testid="empty-state-shell" data-active={active}>
            {children}
        </div>
    ),
}));

// ArrangeView imports addTrack/addClip/importMidiFile from the Arrangement
// useCases barrel and decodeAudioFile from the AudioEngine useCases barrel —
// mock those exact specifiers so the drop handler is fully driveable.
vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    addClip: vi.fn(),
    importMidiFile: vi.fn(),
    setTimelineHorizontalScrollbarScrollX: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
}));

const projectEpoch = vi.hoisted(() => {
    let epoch = 0;
    let latest: { isCurrent: () => boolean } | null = null;
    const makeAuthority = () => {
        const capturedEpoch = epoch;
        return { isCurrent: () => epoch === capturedEpoch };
    };
    return {
        advance: () => {
            epoch += 1;
        },
        capture: vi.fn(() => {
            latest = makeAuthority();
            return latest;
        }),
        currentAuthority: makeAuthority,
        latest: () => latest,
        reset: () => {
            epoch = 0;
            latest = null;
        },
    };
});
vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: projectEpoch.capture,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const makeClip = ({ endBeat }: { endBeat: number }): Clip => ({
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip 1',
    startBeat: 0,
    endBeat,
    type: 'audio',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#7c3aed',
    locked: false,
    muted: false,
});

const makeTrack = ({ clipEndBeat }: { clipEndBeat: number }): Track => ({
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: '#7c3aed',
    clips: [makeClip({ endBeat: clipEndBeat })],
    devices: [],
    midiFx: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 64,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'main',
    alternatives: [],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
});

const renderOverflowingTimeline = (): HTMLElement => {
    vi.mocked(useTracks).mockReturnValue({
        tracks: [makeTrack({ clipEndBeat: 400 })],
        selectedTrackId: 'track-1',
    });

    render(<ArrangeView />);

    const thumb = document.querySelector('.daw-scrollbar-thumb');
    if (!(thumb instanceof HTMLElement)) {
        throw new TypeError('Expected horizontal scrollbar thumb to render');
    }
    return thumb;
};

const readFirstScrollbarCall = (): { scrollX: number; maxScrollX: number } => {
    const input = vi.mocked(setTimelineHorizontalScrollbarScrollX).mock.calls[0]?.[0];
    if (!input) {
        throw new Error('Expected horizontal scrollbar write use case to be called');
    }
    return input;
};

describe('ArrangeView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectEpoch.reset();
        vi.mocked(addClip).mockReturnValue({ id: 'clip-imported' } as never);
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 1000,
        });
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get: () => 1000,
        });
        vi.mocked(useTracks).mockReturnValue({ tracks: [], selectedTrackId: null });
        vi.mocked(useWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            trackListOpen: true,
            trackListWidth: 200,
            scratchPadOpen: false,
            scratchPadHeight: 150,
        });
        preferencesMocks.store.value = {
            preferencesSchemaVersion: 1,
            showMinimap: true,
            timelineMinimapHeight: 28,
        };
    });

    afterEach(() => {
        fireEvent.mouseUp(window);
        vi.restoreAllMocks();
    });

    it('should render without crashing', () => {
        render(<ArrangeView />);
        // When no user tracks, shows empty state
        expect(screen.getByTestId('empty-state-shell')).toBeInTheDocument();
    });

    it('should show empty state when no user tracks exist', () => {
        render(<ArrangeView />);
        expect(screen.getByText('Add your first track')).toBeInTheDocument();
    });

    it('should render add audio track button', () => {
        render(<ArrangeView />);
        expect(screen.getByText('Audio')).toBeInTheDocument();
    });

    it('should render add MIDI track button', () => {
        render(<ArrangeView />);
        expect(screen.getByText('MIDI')).toBeInTheDocument();
    });

    it('should render drop hint', () => {
        render(<ArrangeView />);
        expect(screen.getByText(/Drop audio or MIDI files here/)).toBeInTheDocument();
    });

    const dropFiles = (files: File[]): void => {
        const dropZone = screen.getByText(/Drop audio or MIDI files here/).closest('[class*="absolute"]');
        fireEvent.drop(dropZone as Element, {
            dataTransfer: { files, types: ['Files'] },
        });
    };

    it('does not create an orphan track when an audio file fails to decode', async () => {
        // Regression: decode must happen before addTrack so a decode failure
        // never leaves an empty track behind. Previously addTrack ran first and
        // the catch block only toasted, orphaning the empty track.
        vi.mocked(decodeAudioFile).mockRejectedValueOnce(new Error('corrupt'));

        render(<ArrangeView />);
        const badFile = new File([new Uint8Array([1, 2, 3])], 'broken.wav', { type: 'audio/wav' });
        dropFiles([badFile]);

        await waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('broken.wav'), 'error');
        });
        expect(addTrack).not.toHaveBeenCalled();
        expect(addClip).not.toHaveBeenCalled();
    });

    it('creates the track and clip only after a successful decode', async () => {
        vi.mocked(decodeAudioFile).mockResolvedValueOnce({
            id: 'buf-1',
            buffer: { duration: 2 } as AudioBuffer,
        });
        vi.mocked(addTrack).mockReturnValueOnce({ id: 'track-1' } as ReturnType<typeof addTrack>);

        render(<ArrangeView />);
        const goodFile = new File([new Uint8Array([1, 2, 3])], 'kick.wav', { type: 'audio/wav' });
        dropFiles([goodFile]);

        await waitFor(() => {
            expect(addTrack).toHaveBeenCalledWith({ name: 'kick', kind: 'audio' });
        });
        expect(addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 'track-1', audioBufferId: 'buf-1', type: 'audio' })
        );
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('reports a failed MIDI import instead of silently dropping every remaining file', async () => {
        // Regression: an unguarded `await importMidiFile(...)` inside the drop
        // loop meant one bad .mid threw past every remaining file in the same
        // drop — the audio branch already had this catch, MIDI did not.
        vi.mocked(importMidiFile).mockRejectedValueOnce(new Error('bad midi'));
        vi.mocked(decodeAudioFile).mockResolvedValueOnce({
            id: 'buf-1',
            buffer: { duration: 2 } as AudioBuffer,
        });
        vi.mocked(addTrack).mockReturnValueOnce({ id: 'track-1' } as ReturnType<typeof addTrack>);

        render(<ArrangeView />);
        const badMidi = new File([new Uint8Array([1, 2, 3])], 'broken.mid', { type: 'audio/midi' });
        const goodAudio = new File([new Uint8Array([1, 2, 3])], 'kick.wav', { type: 'audio/wav' });
        dropFiles([badMidi, goodAudio]);

        await waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('broken.mid'), 'error');
        });
        // The file dropped alongside the bad one must still import.
        expect(addTrack).toHaveBeenCalledWith({ name: 'kick', kind: 'audio' });
        expect(addClip).toHaveBeenCalled();
    });

    it('imports every well-formed MIDI file in a drop without touching notifyUser', async () => {
        vi.mocked(importMidiFile).mockResolvedValueOnce('completed');

        render(<ArrangeView />);
        const goodMidi = new File([new Uint8Array([1, 2, 3])], 'melody.mid', { type: 'audio/midi' });
        dropFiles([goodMidi]);

        await waitFor(() => {
            expect(importMidiFile).toHaveBeenCalledWith(goodMidi, { shouldContinue: expect.any(Function) });
        });
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('discards every uncommitted parallel decode when the initiating project is superseded', async () => {
        let resolveFirst!: (value: { id: string; buffer: AudioBuffer }) => void;
        let resolveSecond!: (value: { id: string; buffer: AudioBuffer }) => void;
        vi.mocked(decodeAudioFile)
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveFirst = resolve;
                })
            )
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveSecond = resolve;
                })
            );
        render(<ArrangeView />);
        const first = new File(['first'], 'first.wav', { type: 'audio/wav' });
        const second = new File(['second'], 'second.wav', { type: 'audio/wav' });
        dropFiles([first, second]);
        await waitFor(() => expect(decodeAudioFile).toHaveBeenCalledTimes(2));

        resolveFirst({ id: 'audio-first', buffer: { duration: 1 } as AudioBuffer });
        projectEpoch.advance();
        expect(projectEpoch.latest()?.isCurrent()).toBe(false);
        expect(projectEpoch.currentAuthority().isCurrent()).toBe(true);
        resolveSecond({ id: 'audio-second', buffer: { duration: 1 } as AudioBuffer });

        await waitFor(() => {
            expect(discardDecodedAudioFile).toHaveBeenCalledWith('audio-first');
            expect(discardDecodedAudioFile).toHaveBeenCalledWith('audio-second');
        });
        expect(addTrack).not.toHaveBeenCalled();
        expect(addClip).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();

        vi.mocked(decodeAudioFile).mockResolvedValueOnce({
            id: 'audio-successor',
            buffer: { duration: 1 } as AudioBuffer,
        });
        vi.mocked(addTrack).mockReturnValueOnce({ id: 'track-successor' } as ReturnType<typeof addTrack>);
        const successor = new File(['successor'], 'successor.wav', { type: 'audio/wav' });
        dropFiles([successor]);

        await waitFor(() => {
            expect(addClip).toHaveBeenCalledWith(
                expect.objectContaining({ trackId: 'track-successor', audioBufferId: 'audio-successor' })
            );
        });
        expect(projectEpoch.latest()?.isCurrent()).toBe(true);
    });

    it('preserves an earlier committed decode when a later MIDI import supersedes the drop', async () => {
        vi.mocked(decodeAudioFile)
            .mockResolvedValueOnce({ id: 'audio-committed', buffer: { duration: 1 } as AudioBuffer })
            .mockResolvedValueOnce({ id: 'audio-pending', buffer: { duration: 1 } as AudioBuffer });
        vi.mocked(addTrack).mockReturnValueOnce({ id: 'track-committed' } as ReturnType<typeof addTrack>);
        vi.mocked(importMidiFile).mockImplementationOnce(async () => {
            projectEpoch.advance();
            return 'superseded';
        });
        render(<ArrangeView />);
        const first = new File(['first'], 'first.wav', { type: 'audio/wav' });
        const midi = new File(['midi'], 'switch.mid', { type: 'audio/midi' });
        const pending = new File(['pending'], 'pending.wav', { type: 'audio/wav' });

        dropFiles([first, midi, pending]);

        await waitFor(() => expect(discardDecodedAudioFile).toHaveBeenCalledWith('audio-pending'));
        expect(addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 'track-committed', audioBufferId: 'audio-committed' })
        );
        expect(discardDecodedAudioFile).not.toHaveBeenCalledWith('audio-committed');
        expect(addTrack).toHaveBeenCalledTimes(1);
        expect(notifyUser).not.toHaveBeenCalled();
        expect(projectEpoch.latest()?.isCurrent()).toBe(false);
        expect(projectEpoch.currentAuthority().isCurrent()).toBe(true);
    });

    it('computes the horizontal scrollbar width without blowing the call stack on a very large clip count', () => {
        // Regression: `Math.max(256, ...allEndBeats)` spreads every clip end
        // beat as a call argument — past V8's argument-count ceiling it throws
        // `RangeError: Maximum call stack size exceeded` instead of a width.
        const manyClips = Array.from({ length: 200_000 }, (_, index) => makeClip({ endBeat: index }));
        vi.mocked(useTracks).mockReturnValue({
            tracks: [{ ...makeTrack({ clipEndBeat: 0 }), clips: manyClips }],
            selectedTrackId: 'track-1',
        });

        expect(() => render(<ArrangeView />)).not.toThrow();
        expect(document.querySelector('.daw-scrollbar-thumb')).toBeInTheDocument();
    });

    it('should coalesce horizontal scrollbar drag writes through the Arrangement use case', () => {
        const frameCallbacks: FrameRequestCallback[] = [];
        const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frameCallbacks.push(callback);
            return 7;
        });

        const thumb = renderOverflowingTimeline();

        fireEvent.mouseDown(thumb, { clientX: 0 });
        fireEvent.mouseMove(window, { clientX: 100 });
        fireEvent.mouseMove(window, { clientX: 200 });

        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
        expect(setTimelineHorizontalScrollbarScrollX).not.toHaveBeenCalled();
        expect(setScrollX).not.toHaveBeenCalled();

        const frameCallback = frameCallbacks.at(0);
        if (!frameCallback) {
            throw new Error('Expected scrollbar drag to schedule a frame');
        }
        frameCallback(0);

        const call = readFirstScrollbarCall();
        expect(call.scrollX).toBeCloseTo(960);
        expect(call.maxScrollX).toBe(3800);
        expect(setScrollX).not.toHaveBeenCalled();
    });

    it('should commit the pending horizontal scrollbar drag synchronously on mouseup through the Arrangement use case', () => {
        const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(9);
        const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        const thumb = renderOverflowingTimeline();

        fireEvent.mouseDown(thumb, { clientX: 0 });
        fireEvent.mouseMove(window, { clientX: 125 });

        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
        expect(setTimelineHorizontalScrollbarScrollX).not.toHaveBeenCalled();

        fireEvent.mouseUp(window);

        expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(9);
        const call = readFirstScrollbarCall();
        expect(call.scrollX).toBeCloseTo(600);
        expect(call.maxScrollX).toBe(3800);
        expect(setScrollX).not.toHaveBeenCalled();
    });

    it('projects one persisted minimap height across the canvas, separator, and track-list header', () => {
        preferencesMocks.store.value = {
            preferencesSchemaVersion: 1,
            showMinimap: true,
            timelineMinimapHeight: 72,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ clipEndBeat: 32 })],
            selectedTrackId: 'track-1',
        });

        render(<ArrangeView />);

        expect(screen.getByTestId('timeline-minimap')).toHaveAttribute('data-height', '72');
        expect(screen.getByTestId('timeline-minimap-resize-handle')).toHaveAttribute('data-height', '72');
        expect(screen.getByTestId('track-list-view')).toHaveAttribute('data-extra-height', '112');
    });

    it('honors explicit visibility without mounting canvas, separator, or minimap header height', () => {
        preferencesMocks.store.value = {
            preferencesSchemaVersion: 1,
            showMinimap: false,
            timelineMinimapHeight: 72,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ clipEndBeat: 32 })],
            selectedTrackId: 'track-1',
        });

        render(<ArrangeView />);

        expect(screen.queryByTestId('timeline-minimap')).not.toBeInTheDocument();
        expect(screen.queryByTestId('timeline-minimap-resize-handle')).not.toBeInTheDocument();
        expect(screen.getByTestId('track-list-view')).toHaveAttribute('data-extra-height', '40');
    });

    it('uses local drag preview atomically and commits only through the Preferences use case', () => {
        preferencesMocks.store.value = {
            preferencesSchemaVersion: 1,
            showMinimap: true,
            timelineMinimapHeight: 72,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ clipEndBeat: 32 })],
            selectedTrackId: 'track-1',
        });

        render(<ArrangeView />);
        const handle = screen.getByTestId('timeline-minimap-resize-handle');
        fireEvent.pointerMove(handle);

        expect(screen.getByTestId('timeline-minimap')).toHaveAttribute('data-height', '96');
        expect(screen.getByTestId('timeline-minimap-resize-handle')).toHaveAttribute('data-height', '96');
        expect(screen.getByTestId('track-list-view')).toHaveAttribute('data-extra-height', '136');
        expect(preferencesMocks.setTimelineMinimapHeight).not.toHaveBeenCalled();

        fireEvent.pointerUp(handle);
        expect(preferencesMocks.setTimelineMinimapHeight).toHaveBeenCalledTimes(1);
        expect(preferencesMocks.setTimelineMinimapHeight).toHaveBeenCalledWith(96);
    });

    it('drops a stale local preview when a newer persisted height arrives', () => {
        preferencesMocks.store.value = {
            preferencesSchemaVersion: 1,
            showMinimap: true,
            timelineMinimapHeight: 72,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ clipEndBeat: 32 })],
            selectedTrackId: 'track-1',
        });

        const { rerender } = render(<ArrangeView />);
        fireEvent.pointerMove(screen.getByTestId('timeline-minimap-resize-handle'));
        expect(screen.getByTestId('timeline-minimap')).toHaveAttribute('data-height', '96');

        preferencesMocks.store.value = {
            preferencesSchemaVersion: 1,
            showMinimap: true,
            timelineMinimapHeight: 88,
        };
        rerender(<ArrangeView />);

        expect(screen.getByTestId('timeline-minimap')).toHaveAttribute('data-height', '88');
        expect(screen.getByTestId('track-list-view')).toHaveAttribute('data-extra-height', '128');
    });

    it('keeps a positive timeline column when the arrange row is narrower than the open track list', () => {
        // Leftover after default sidebar+inspector at a 640px CSS (200% UI scale) viewport.
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get: () => 150,
        });
        vi.mocked(useWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            trackListOpen: true,
            trackListWidth: 220,
            scratchPadOpen: false,
            scratchPadHeight: 150,
        });
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ clipEndBeat: 32 })],
            selectedTrackId: 'track-1',
        });

        render(<ArrangeView />);

        const trackListWidth = Number.parseFloat(screen.getByTestId('track-list-view').style.width);
        const timelineColumn = screen.getByTestId('timeline-surface').parentElement;
        expect(trackListWidth).toBeGreaterThan(0);
        expect(trackListWidth).toBeLessThan(220);
        expect(trackListWidth + ARRANGE_RESIZE_HANDLE_WIDTH + MIN_TIMELINE_COLUMN_WIDTH).toBeLessThanOrEqual(150);
        expect(timelineColumn).toHaveClass('min-w-0');
        expect(timelineColumn).toHaveStyle({ minWidth: `${MIN_TIMELINE_COLUMN_WIDTH}px` });
    });
});
