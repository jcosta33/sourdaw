import { describe, expect, it, vi } from 'vitest';

import {
    type ClipGlueActionSnapshot,
    type MidiClipDataActionSnapshot,
    type MidiClipGlueActionSnapshot,
} from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';

const mocks = vi.hoisted(() => ({
    hasClipGlueDependencies: vi.fn(() => false),
    midiClipGlueStateMatches: vi.fn(() => true),
}));

vi.mock('#/modules/MIDI/useCases', () => ({ midiClipGlueStateMatches: mocks.midiClipGlueStateMatches }));
vi.mock('../hasClipGlueDependencies', () => ({ hasClipGlueDependencies: mocks.hasClipGlueDependencies }));

const { clipGlueStateRestorable } = await import('../clipGlueStateRestorable');

const emptyMidiData: MidiClipDataActionSnapshot = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function snapshot(clips: ClipGlueActionSnapshot['clips']): ClipGlueActionSnapshot {
    const midi: MidiClipGlueActionSnapshot = {
        clips: clips.map((clip) => ({ clipId: clip.id, data: emptyMidiData })),
        migratedAbsoluteNoteClipIds: { present: false, value: [] },
    };
    return {
        trackId: 'track-1',
        clips,
        clipOrder: clips.map((clip) => clip.id),
        midi,
        clipSatellites: [],
        clipAutomationLanes: [],
    };
}

describe('clipGlueStateRestorable', () => {
    it('accepts matching clips rebuilt with different object-key insertion order', () => {
        const first = ClipDummy.create({ id: 'clip-1', trackId: 'track-1' });
        const second = ClipDummy.create({ id: 'clip-2', trackId: 'track-1' });
        const { audioBufferId, ...leadingFields } = first;
        const expected = snapshot([first, second]);
        const state = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [{ ...leadingFields, audioBufferId }, second] })],
            selectedTrackId: null,
        };

        expect(clipGlueStateRestorable({ expected, replacement: expected }, state)).toBe(true);
    });

    it('rejects a collaborator change to a captured clip', () => {
        const first = ClipDummy.create({ id: 'clip-1', trackId: 'track-1' });
        const second = ClipDummy.create({ id: 'clip-2', trackId: 'track-1' });
        const expected = snapshot([first, second]);
        const state = {
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [{ ...first, gain: first.gain + 0.25 }, second],
                }),
            ],
            selectedTrackId: null,
        };

        expect(clipGlueStateRestorable({ expected, replacement: expected }, state)).toBe(false);
    });
});
