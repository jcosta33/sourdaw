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
    resolveEligibleClipWriteTarget: vi.fn(),
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

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
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
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId: string }) => ({
            status: 'eligible',
            clipId: input.clipId,
            trackId: input.clipId === 'clip-midi' ? 'track-midi' : 'track-audio',
        }));
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
    });

    it('returns early when workspace is unavailable without calling removeClip', () => {
        expect(cutSelectedClip()).toBe(false);

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

        expect(cutSelectedClip()).toBe(true);

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

    it('rejects a mixed valid and ineligible selection before cleanup or clipboard writes', () => {
        const clip = createClip({ id: 'clip-audio', trackId: 'track-audio', type: 'audio' });
        const existingClipboard = { clipClipboard: [], noteClipboard: null };
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-audio',
            selectedClipIds: ['clip-audio', 'vca-clip'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [TrackDummy.create({ id: 'track-audio', clips: [clip] })],
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId: string }) => {
            if (input.clipId === 'vca-clip') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', clipId: input.clipId, trackId: 'track-audio' };
        });
        clipboardStore.set(existingClipboard);

        expect(cutSelectedClip()).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        expect(mocks.removeEnvelope).not.toHaveBeenCalled();
        expect(mocks.removeWarpState).not.toHaveBeenCalled();
        expect(clipboardStore.value).toEqual(existingClipboard);
    });

    it('falls back to the singular selectedClipId when the multi-selection list is empty', () => {
        const clip = createClip({ id: 'clip-audio', trackId: 'track-audio', type: 'audio' });
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-audio',
            selectedClipIds: [], // empty plural list -> singular fallback used
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [TrackDummy.create({ id: 'track-audio', clips: [clip] })],
        });

        expect(cutSelectedClip()).toBe(true);

        expect(clipboardStore.value?.clipClipboard).toHaveLength(1);
        expect(clipboardStore.value?.clipClipboard[0]?.clip.id).toBe('clip-audio');
    });

    it('returns false when neither a singular nor a plural selection is present', () => {
        mocks.clipSelectionStore.value = { selectedClipId: null, selectedClipIds: [] };

        expect(cutSelectedClip()).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(clipboardStore.value?.clipClipboard).toEqual([]);
    });

    it('rejects a selection containing a duplicate id before any cleanup', () => {
        const clip = createClip({ id: 'clip-audio', trackId: 'track-audio', type: 'audio' });
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-audio',
            selectedClipIds: ['clip-audio', 'clip-audio'], // duplicate
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [TrackDummy.create({ id: 'track-audio', clips: [clip] })],
        });

        expect(cutSelectedClip()).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(clipboardStore.value?.clipClipboard).toEqual([]);
    });

    it('returns false when the eligible clip is no longer in the track store', () => {
        // Eligibility passes, but findClipById cannot locate the clip in tracks
        // (torn down between eligibility resolution and the lookup).
        mocks.clipSelectionStore.value = {
            selectedClipId: 'ghost',
            selectedClipIds: ['ghost'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [TrackDummy.create({ id: 'track-audio', clips: [] })],
        });

        expect(cutSelectedClip()).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(clipboardStore.value?.clipClipboard).toEqual([]);
    });

    it('returns false when the track store has been cleared after eligibility passed', () => {
        // Eligibility passes, but the project/track store was torn down before
        // the clip lookup ran (getTrackStoreState returns null).
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-audio',
            selectedClipIds: ['clip-audio'],
        };
        mocks.getTrackStoreState.mockReturnValue(null);

        expect(cutSelectedClip()).toBe(false);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(clipboardStore.value?.clipClipboard).toEqual([]);
    });
});
