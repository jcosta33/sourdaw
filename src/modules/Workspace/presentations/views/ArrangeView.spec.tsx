import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArrangeView } from './ArrangeView';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, fallback) => fallback || store.value),
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

vi.mock('#/modules/Arrangement/stores/chordTrackStore', () => ({
    chordTrackStore: { value: { enabled: false, events: [] } },
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [] })),
}));

vi.mock('../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(() => ({
        trackListOpen: true,
        trackListWidth: 200,
        scratchPadOpen: false,
        scratchPadHeight: 150,
    })),
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/panelToggles', () => ({
    setTrackListWidth: vi.fn(),
    closeScratchPad: vi.fn(),
}));

vi.mock('#/modules/Workspace/presentations/components/ResizeHandle', () => ({
    ResizeHandle: ({ direction, onResize, onResizeEnd }: { direction: string; onResize: (delta: number) => void; onResizeEnd: () => void }) => (
        <div data-testid="resize-handle" data-direction={direction} />
    ),
}));

vi.mock('./Timeline/ChordTrackLane', () => ({
    ChordTrackLane: () => <div data-testid="chord-track-lane">Chord Track Lane</div>,
}));

vi.mock('./Timeline/ScratchPadView', () => ({
    ScratchPadView: ({ height }: { height: number }) => (
        <div data-testid="scratch-pad-view" style={{ height }}>Scratch Pad</div>
    ),
}));

vi.mock('./ArrangeEmptyStateShell', () => ({
    ArrangeEmptyStateShell: ({ active, children }: { active?: boolean; children: React.ReactNode }) => (
        <div data-testid="empty-state-shell" data-active={active}>{children}</div>
    ),
}));

vi.mock('#/modules/Arrangement/useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/trackViewActions', () => ({
    decodeAudioFile: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/importMidiFile', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('#/helpers/Notification/notifyUser', () => ({
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
});
