import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { setScrollX } from '#/modules/Arrangement/stores';
import { addTrack, addClip, setTimelineHorizontalScrollbarScrollX } from '#/modules/Arrangement/useCases';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip, type Track } from '../../../models/TrackViewTypes';
import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import { useTracks } from '../../hooks/useTracks';
import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { ArrangeView } from '../ArrangeView';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { value: unknown }, fallback?: unknown) => fallback ?? store.value),
}));

vi.mock('#/modules/Arrangement/presentations/views/TimelineSurface', () => ({
    TimelineSurface: () => <div data-testid="timeline-surface">Timeline Surface</div>,
}));

vi.mock('#/modules/Arrangement/presentations/views/TimelineMinimap', () => ({
    TimelineMinimap: () => <div data-testid="timeline-minimap">Timeline Minimap</div>,
    MINIMAP_HEIGHT: 28,
}));

vi.mock('#/modules/Arrangement/presentations/views/ArrangementBar', () => ({
    ArrangementBar: () => <div data-testid="arrangement-bar">Arrangement Bar</div>,
    ARRANGEMENT_BAR_HEIGHT: 22,
}));

vi.mock('#/modules/Arrangement/presentations/views/MarkerLane', () => ({
    MarkerLane: () => <div data-testid="marker-lane">Marker Lane</div>,
    MARKER_LANE_HEIGHT: 20,
}));

vi.mock('#/modules/Arrangement/presentations/views/BeatRulerBar', () => ({
    BeatRulerBar: () => <div data-testid="beat-ruler">Beat Ruler</div>,
    BEAT_RULER_HEIGHT: 18,
}));

vi.mock('#/modules/Arrangement/presentations/views/AdjustmentLayerStrip', () => ({
    AdjustmentLayerStrip: () => <div data-testid="adjustment-layer-strip">Adjustment Layer Strip</div>,
    getAdjustmentLayerStripHeight: (layerCount: number) => (layerCount > 0 ? 28 + layerCount * 18 : 0),
}));

vi.mock('#/modules/Arrangement/presentations/views/TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('#/modules/Arrangement/presentations/views/TrackListView', () => ({
    TrackListView: ({ style, extraHeaderHeight }: { style?: React.CSSProperties; extraHeaderHeight?: number }) => (
        <div data-testid="track-list-view" style={style} data-extra-height={extraHeaderHeight} />
    ),
}));

vi.mock('#/modules/Arrangement/stores/timelineViewStore', () => ({
    timelineViewStore: { value: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true } },
    setScrollX: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/markerStore', () => ({
    markerStore: { value: { markers: [], sections: [] } },
}));

vi.mock('#/modules/MIDI/stores/chordTrackStore', () => ({
    chordTrackStore: { value: { enabled: false, events: [] } },
    defaultChordTrackState: { enabled: false, events: [] },
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
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

vi.mock('#/modules/Workspace/useCases/togglePanel/panelToggles/closeScratchPad', () => ({
    closeScratchPad: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/panelToggles/setTrackListWidth', () => ({
    setTrackListWidth: vi.fn(),
}));

vi.mock('#/modules/Workspace/presentations/components/ResizeHandle', () => ({
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
});
