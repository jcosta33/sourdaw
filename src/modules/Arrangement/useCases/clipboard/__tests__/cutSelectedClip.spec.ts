import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type MidiNote } from '../../../models/MidiNoteViewTypes';
import { type Clip } from '../../../models/Track';
import { clipboardStore } from '../../../stores/clipboardStore';
import { cutSelectedClip } from '../cutSelectedClip';

const mocks = vi.hoisted(() => ({
    clipSelectionStore: {
        value: null as {
            selectedClipId: string | null;
            selectedClipIds: string[];
        } | null,
    },
    midiStore: {
        value: null as { notesByClipId: Record<string, MidiNote[]> } | null,
    },
    getTrackStoreState: vi.fn(),
    mapAllTracks: vi.fn(),
    removeMidiClipData: vi.fn(),
    removeEnvelope: vi.fn(),
    removeWarpState: vi.fn(),
    getAutomationLanes: vi.fn(() => []),
    removeAutomationLane: vi.fn(),
    clipDragPreviewRef: { current: null },
    activeRecordingRef: { current: [] as string[] },
}));

vi.mock('../../../stores/clipSelectionStore', () => ({
    clipSelectionStore: mocks.clipSelectionStore,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: mocks.midiStore,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    removeMidiClipData: mocks.removeMidiClipData,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationLanes: mocks.getAutomationLanes,
    removeAutomationLane: mocks.removeAutomationLane,
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('../../../stores/gainEnvelopeStore', () => ({
    removeEnvelope: mocks.removeEnvelope,
}));

vi.mock('../../../stores/warpStates', () => ({
    removeWarpState: mocks.removeWarpState,
}));

vi.mock('../../../stores/clipDragPreviewRef', () => ({
    clipDragPreviewRef: mocks.clipDragPreviewRef,
}));

vi.mock('../../../stores/activeRecordingRef', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
}));

function createClip(overrides: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'type'>): Clip {
    return {
        name: overrides.id,
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('cutSelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clipSelectionStore.value = null;
        mocks.midiStore.value = null;
        mocks.getTrackStoreState.mockReturnValue(null);
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
    });

    it('returns early when workspace is unavailable without calling removeClip', () => {
        cutSelectedClip();

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(clipboardStore.value?.clipClipboard).toEqual([]);
    });

    it('preserves cloned MIDI and audio entries after removeClip clears matching clipboard data', () => {
        const midiClip = createClip({ id: 'clip-midi', trackId: 'track-midi', type: 'midi' });
        const audioClip = createClip({ id: 'clip-audio', trackId: 'track-audio', type: 'audio' });
        const midiNote: MidiNote = {
            id: 'note-1',
            pitch: 60,
            startBeat: 0,
            duration: 1,
            velocity: 0.8,
        };
        const midiNotes = [midiNote];

        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-midi',
            selectedClipIds: ['clip-midi', 'clip-audio'],
        };
        mocks.midiStore.value = { notesByClipId: { 'clip-midi': midiNotes } };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                TrackDummy.create({ id: 'track-midi', kind: 'midi', clips: [midiClip] }),
                TrackDummy.create({ id: 'track-audio', clips: [audioClip] }),
            ],
        });
        clipboardStore.set({
            clipClipboard: [
                { clip: midiClip, midiNotes, sourceTrackId: 'track-midi' },
                { clip: audioClip, sourceTrackId: 'track-audio' },
            ],
            noteClipboard: { notes: [midiNote] },
        });

        cutSelectedClip();

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(2);
        expect(clipboardStore.value).toEqual({
            clipClipboard: [
                { clip: midiClip, midiNotes, sourceTrackId: 'track-midi' },
                { clip: audioClip, midiNotes: undefined, sourceTrackId: 'track-audio' },
            ],
            noteClipboard: { notes: [midiNote] },
        });

        const [midiEntry, audioEntry] = clipboardStore.value?.clipClipboard ?? [];
        expect(midiEntry?.clip).not.toBe(midiClip);
        expect(audioEntry?.clip).not.toBe(audioClip);
        expect(midiEntry?.midiNotes).not.toBe(midiNotes);
        expect(midiEntry?.midiNotes?.[0]).not.toBe(midiNote);
    });
});
