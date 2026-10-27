import { describe, expect, it } from 'vitest';

import { type TakeLaneStoreState } from '#/modules/Arrangement/stores';

import { projectPianoRollTakeNotes } from '../projectPianoRollTakeNotes';

const first = { id: 'first-row', pitch: 60, startBeat: 5.5, duration: 1, velocity: 90, recordingPassIndex: 0 };
const second = { id: 'second-row', pitch: 64, startBeat: 9.5, duration: 1, velocity: 85, recordingPassIndex: 1 };
const source = {
    sourceClipId: 'original',
    sourceEntryBeat: 5,
    sourceEndBeat: 9,
    phaseHeadBeat: 0,
    passLengthBeats: 4,
    rows: {
        notes: { present: true, value: [first, second] },
        controlChanges: { present: true, value: [] },
        pitchBends: { present: true, value: [] },
    },
};

function laneState(): TakeLaneStoreState {
    return {
        lanes: [
            {
                id: 'lane',
                trackId: 'track',
                takes: [
                    {
                        id: 'first',
                        clipId: 'clip',
                        name: 'First',
                        startBeat: 0,
                        endBeat: 12,
                        selected: true,
                        recordingPassIndex: 0,
                        midiSource: source,
                    },
                    {
                        id: 'second',
                        clipId: 'clip',
                        name: 'Second',
                        startBeat: 0,
                        endBeat: 12,
                        selected: false,
                        recordingPassIndex: 1,
                        midiSource: { ...source, sourceEntryBeat: 9, sourceEndBeat: 13 },
                    },
                ],
                activeCompRegions: [
                    { startBeat: 0, endBeat: 4, takeId: 'first' },
                    { startBeat: 4, endBeat: 8, takeId: 'second' },
                    { startBeat: 8, endBeat: 12, takeId: 'first' },
                ],
            },
        ],
    };
}

describe('piano roll frozen take occurrence ownership', () => {
    it('shows two selected passes and gives repeated occurrences unique view identities with one original row owner', () => {
        const result = projectPianoRollTakeNotes({ id: 'clip', startBeat: 0, endBeat: 12 }, 'track', laneState());
        expect(result.notes.map((note) => [note.pitch, note.startBeat])).toEqual([
            [60, 0.5],
            [64, 4.5],
            [60, 8.5],
        ]);
        expect(new Set(result.notes.map((note) => note.id)).size).toBe(3);
        const firstOwner = result.ownersByViewId.get(result.notes[0]!.id);
        const repeatOwner = result.ownersByViewId.get(result.notes[2]!.id);
        expect(firstOwner?.row).toBe(first);
        expect(repeatOwner?.row).toBe(first);
        expect(firstOwner?.occurrenceIndex).toBe(0);
        expect(repeatOwner?.occurrenceIndex).toBe(2);
        expect(result.ownersByViewId.get(result.notes[1]!.id)?.takeId).toBe('second');
    });

    it('maps insertion through a selected region to original source coordinates and pass identity', () => {
        const result = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 2, endBeat: 12, midiOffsetBeats: 2 },
            'track',
            laneState()
        );
        expect(result.insertOwnerAtBeat(6.5)).toEqual({
            laneId: 'lane',
            takeId: 'second',
            sourceClipId: 'original',
            sourceBeat: 11.5,
            recordingPassIndex: 1,
            slotPresent: true,
        });
        expect(result.insertOwnerAtBeat(20)).toBeNull();
    });
});
