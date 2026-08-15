import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { selectClip } from '#/modules/Arrangement/useCases';
import { setWorkspaceMode } from '#/modules/WorkspaceShell/useCases';

import { type Clip, type Track } from '../../../models/TrackViewTypes';
import { useTracks } from '../../hooks/useTracks';
import { ClipView } from '../ClipView';

const clipSelectionMocks = vi.hoisted(() => ({
    store: {
        value: { selectedClipId: null as string | null, selectedClipIds: [] as string[], marqueeSelection: null },
    },
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, variant, size, className }: any) => (
        <button type="button" onClick={onClick} data-variant={variant} data-size={size} className={className}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title, description, action }: any) => (
        <div data-testid="blocked-state">
            <span>{title}</span>
            <span>{description}</span>
            {action}
        </div>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('#/components/daw/DawPanelSurface', () => ({
    DawPanelSurface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [], selectedTrackId: null })),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    setWorkspaceMode: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    selectClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    clipSelectionStore: clipSelectionMocks.store,
    defaultClipSelectionState: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { value: unknown }, fallback?: unknown) => {
        if (store === clipSelectionMocks.store) {
            return clipSelectionMocks.store.value;
        }
        return fallback ?? store.value;
    }),
}));

vi.mock('../ClipView/PianoRoll', () => ({
    PianoRoll: ({ clipId, trackId, openedClipIds, onScrollChange, onBeatWidthChange, onContentWidthChange }: any) => (
        <div
            data-testid="piano-roll"
            data-clip-id={clipId}
            data-track-id={trackId}
            data-opened-clip-ids={openedClipIds ? openedClipIds.join(',') : ''}
        >
            <button type="button" onClick={() => onScrollChange(42)}>
                trigger-scroll
            </button>
            <button type="button" onClick={() => onBeatWidthChange(88)}>
                trigger-beat-width
            </button>
            <button type="button" onClick={() => onContentWidthChange(777)}>
                trigger-content-width
            </button>
        </div>
    ),
}));

vi.mock('../ClipView/WaveformEditor', () => ({
    WaveformEditor: ({ clipId, audioBufferId }: any) => (
        <div data-testid="waveform-editor" data-clip-id={clipId} data-audio-buffer-id={audioBufferId ?? ''} />
    ),
}));

vi.mock('../ClipView/KneadEditor', () => ({
    KneadEditor: ({ clipId, trackId }: any) => (
        <div data-testid="knead-editor" data-clip-id={clipId} data-track-id={trackId} />
    ),
}));

vi.mock('../ClipView/AutomationLane', () => ({
    AutomationLane: ({ clipId, trackId, beatWidth, contentWidth, scrollRef }: any) => (
        <div
            data-testid="automation-lane"
            data-clip-id={clipId ?? 'null'}
            data-track-id={trackId}
            data-beat-width={beatWidth}
            data-content-width={contentWidth}
            ref={scrollRef}
        />
    ),
}));

vi.mock('../ClipEditorTray', () => ({
    ClipEditorTray: ({ children }: any) => <div>{children}</div>,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

const makeClip = ({
    id,
    name,
    type,
    audioBufferId,
    trackId,
}: {
    id: string;
    name: string;
    type: 'audio' | 'midi';
    audioBufferId?: string;
    trackId?: string;
}): Clip => ({
    id,
    trackId: trackId ?? 'track-1',
    name,
    startBeat: 0,
    endBeat: 4,
    type,
    audioBufferId,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#7c3aed',
    locked: false,
    muted: false,
});

const makeTrack = ({ id, kind, clips }: { id: string; kind: Track['kind']; clips: Clip[] }): Track => ({
    id,
    name: `Track ${id}`,
    kind,
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: '#7c3aed',
    clips,
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

describe('ClipView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clipSelectionMocks.store.value = { selectedClipId: null, selectedClipIds: [], marqueeSelection: null };
        vi.mocked(useTracks).mockReturnValue({ tracks: [], selectedTrackId: null });
    });

    it('should render without crashing', () => {
        renderWithTooltip(<ClipView />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
    });

    it('should show blocked state when no track is selected', () => {
        renderWithTooltip(<ClipView />);
        expect(screen.getByText('Select a track to edit clips')).toBeInTheDocument();
    });

    it('should call setWorkspaceMode when back button is clicked', () => {
        renderWithTooltip(<ClipView />);
        fireEvent.click(screen.getByText('Back to Arrange'));
        expect(setWorkspaceMode).toHaveBeenCalledWith('arrange');
    });

    it('should render the piano roll for a midi track with a clip', () => {
        const clip = makeClip({ id: 'clip-midi', name: 'Midi Clip', type: 'midi' });
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'midi', clips: [clip] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        const pianoRoll = screen.getByTestId('piano-roll');
        expect(pianoRoll).toHaveAttribute('data-clip-id', 'clip-midi');
        expect(pianoRoll).toHaveAttribute('data-track-id', 'track-1');
        expect(screen.queryByTestId('waveform-editor')).not.toBeInTheDocument();
        expect(screen.queryByTestId('knead-editor')).not.toBeInTheDocument();
        expect(screen.getByText('Track track-1')).toBeInTheDocument();
        expect(screen.getByText('— Midi Clip')).toBeInTheDocument();
        // The note-count readout mirrors the MIDI store's notes for the
        // selected clip (live content, not clip bookkeeping).
        const noteCount = screen.getByTestId('selected-clip-note-count');
        expect(noteCount).toHaveTextContent('0 notes');
        expect(noteCount).toHaveAttribute('aria-label', '0 notes in Midi Clip');
    });

    it('should render the waveform editor by default for an audio track with a clip', () => {
        const clip = makeClip({ id: 'clip-audio', name: 'Audio Clip', type: 'audio', audioBufferId: 'buf-1' });
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'audio', clips: [clip] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        const waveform = screen.getByTestId('waveform-editor');
        expect(waveform).toHaveAttribute('data-clip-id', 'clip-audio');
        expect(waveform).toHaveAttribute('data-audio-buffer-id', 'buf-1');
        expect(screen.queryByTestId('knead-editor')).not.toBeInTheDocument();

        const waveformButton = screen.getByText('Waveform');
        const pitchButton = screen.getByText('Knead (Pitch)');
        expect(waveformButton).toHaveAttribute('data-variant', 'secondary');
        expect(pitchButton).toHaveAttribute('data-variant', 'ghost');

        fireEvent.click(waveformButton);
        expect(screen.getByTestId('waveform-editor')).toBeInTheDocument();
    });

    it('should switch to the knead editor when the pitch mode button is clicked', () => {
        const clip = makeClip({ id: 'clip-audio', name: 'Audio Clip', type: 'audio', audioBufferId: 'buf-1' });
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'audio', clips: [clip] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);
        fireEvent.click(screen.getByText('Knead (Pitch)'));

        expect(screen.queryByTestId('waveform-editor')).not.toBeInTheDocument();
        const kneadEditor = screen.getByTestId('knead-editor');
        expect(kneadEditor).toHaveAttribute('data-clip-id', 'clip-audio');
        expect(kneadEditor).toHaveAttribute('data-track-id', 'track-1');
        expect(screen.getByText('Knead (Pitch)')).toHaveAttribute('data-variant', 'secondary');
        expect(screen.getByText('Waveform')).toHaveAttribute('data-variant', 'ghost');
    });

    it('should render the empty state for a track with no clips', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'audio', clips: [] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        expect(screen.getByTestId('empty-state')).toHaveTextContent('No clips on this track');
        expect(screen.queryByText('Waveform')).not.toBeInTheDocument();
        const automationLane = screen.getByTestId('automation-lane');
        expect(automationLane).toHaveAttribute('data-clip-id', 'null');
    });

    it('should render a clip switcher when a track has multiple clips and select on click', () => {
        const clipA = makeClip({ id: 'clip-a', name: 'Clip A', type: 'audio' });
        const clipB = makeClip({ id: 'clip-b', name: 'Clip B', type: 'audio' });
        clipSelectionMocks.store.value = { selectedClipId: 'clip-b', selectedClipIds: [], marqueeSelection: null };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'audio', clips: [clipA, clipB] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        const buttonA = screen.getByText('Clip A');
        const buttonB = screen.getByText('Clip B');
        expect(buttonB).toHaveAttribute('data-variant', 'secondary');
        expect(buttonA).toHaveAttribute('data-variant', 'ghost');

        fireEvent.click(buttonA);
        expect(selectClip).toHaveBeenCalledWith('clip-a');
    });

    it('should fall back to the first clip when no selection matches', () => {
        const clipA = makeClip({ id: 'clip-a', name: 'Clip A', type: 'audio' });
        const clipB = makeClip({ id: 'clip-b', name: 'Clip B', type: 'audio' });
        clipSelectionMocks.store.value = {
            selectedClipId: 'not-on-this-track',
            selectedClipIds: [],
            marqueeSelection: null,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'audio', clips: [clipA, clipB] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        expect(screen.getByText('Clip A')).toHaveAttribute('data-variant', 'secondary');
    });

    it('should not pass openedClipIds when at most one clip is selected', () => {
        const clip = makeClip({ id: 'clip-midi', name: 'Midi Clip', type: 'midi' });
        clipSelectionMocks.store.value = {
            selectedClipId: 'clip-midi',
            selectedClipIds: ['clip-midi'],
            marqueeSelection: null,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'midi', clips: [clip] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-opened-clip-ids', '');
    });

    it('should pass openedClipIds when multiple midi clips are selected across tracks', () => {
        const clipA = makeClip({ id: 'clip-a', name: 'Clip A', type: 'midi', trackId: 'track-1' });
        const clipB = makeClip({ id: 'clip-b', name: 'Clip B', type: 'midi', trackId: 'track-2' });
        clipSelectionMocks.store.value = {
            selectedClipId: 'clip-a',
            selectedClipIds: ['clip-a', 'clip-b'],
            marqueeSelection: null,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [
                makeTrack({ id: 'track-1', kind: 'midi', clips: [clipA] }),
                makeTrack({ id: 'track-2', kind: 'midi', clips: [clipB] }),
            ],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-opened-clip-ids', 'clip-a,clip-b');
    });

    it('should not pass openedClipIds when only one selected id resolves to a midi clip', () => {
        const clipA = makeClip({ id: 'clip-a', name: 'Clip A', type: 'midi', trackId: 'track-1' });
        const clipC = makeClip({ id: 'clip-c', name: 'Clip C', type: 'audio', trackId: 'track-2' });
        clipSelectionMocks.store.value = {
            selectedClipId: 'clip-a',
            selectedClipIds: ['clip-a', 'clip-c'],
            marqueeSelection: null,
        };
        vi.mocked(useTracks).mockReturnValue({
            tracks: [
                makeTrack({ id: 'track-1', kind: 'midi', clips: [clipA] }),
                makeTrack({ id: 'track-2', kind: 'audio', clips: [clipC] }),
            ],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-opened-clip-ids', '');
    });

    it('should sync automation lane scroll and beat/content width from piano roll callbacks', () => {
        const clip = makeClip({ id: 'clip-midi', name: 'Midi Clip', type: 'midi' });
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', kind: 'midi', clips: [clip] })],
            selectedTrackId: 'track-1',
        });

        renderWithTooltip(<ClipView />);

        const automationLane = screen.getByTestId('automation-lane') as HTMLDivElement;
        expect(automationLane.scrollLeft).toBe(0);

        fireEvent.click(screen.getByText('trigger-scroll'));
        expect(automationLane.scrollLeft).toBe(42);

        fireEvent.click(screen.getByText('trigger-beat-width'));
        fireEvent.click(screen.getByText('trigger-content-width'));

        expect(screen.getByTestId('automation-lane')).toHaveAttribute('data-beat-width', '88');
        expect(screen.getByTestId('automation-lane')).toHaveAttribute('data-content-width', '777');
    });
});
