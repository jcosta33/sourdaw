import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addTrack, addClip } from '#/modules/Arrangement/useCases';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { ArrangeView } from '../ArrangeView';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { value: unknown }, fallback?: unknown) => fallback ?? store.value),
}));

vi.mock('#/modules/Arrangement/presentations/views/TimelineSurface', () => ({
    TimelineSurface: () => <div data-testid="timeline-surface">Timeline Surface</div>,
}));

vi.mock('#/modules/Arrangement/presentations/views/TimelineMinimap', () => ({
    TimelineMinimap: () => <div data-testid="timeline-minimap">Timeline Minimap</div>,
}));

vi.mock('#/modules/Arrangement/presentations/views/ArrangementBar', () => ({
    ArrangementBar: () => <div data-testid="arrangement-bar">Arrangement Bar</div>,
}));

vi.mock('#/modules/Arrangement/presentations/views/MarkerLane', () => ({
    MarkerLane: () => <div data-testid="marker-lane">Marker Lane</div>,
}));

vi.mock('#/modules/Arrangement/presentations/views/BeatRulerBar', () => ({
    BeatRulerBar: () => <div data-testid="beat-ruler">Beat Ruler</div>,
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
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('ArrangeView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
