import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, takeLaneStore, type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

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

/**
 * Two passes of a loop [0, 4) recording that began at 0: the first reads
 * source 5 at its pass head 0, the next a pass deeper.
 */
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
                        // The loop's next pass: it opens on the same loop start, a pass deeper in the source.
                        midiSource: { ...source, sourceEntryBeat: 9, sourceEndBeat: 13 },
                    },
                ],
                activeCompRegions: [
                    { startBeat: 0, endBeat: 8, takeId: 'first' },
                    { startBeat: 8, endBeat: 12, takeId: 'second' },
                ],
            },
        ],
    };
}

const loopingClip = { id: 'clip', startBeat: 0, endBeat: 12, loopEnabled: true, loopLength: 4 };

describe('piano roll frozen take occurrence ownership', () => {
    it('shows two selected passes and gives repeated occurrences unique view identities with one original row owner', () => {
        // A looping clip restarts the first pass's region every loop length, as live does.
        const result = projectPianoRollTakeNotes(loopingClip, 'track', laneState());
        expect(result.notes.map((note) => [note.pitch, note.startBeat])).toEqual([
            [60, 0.5],
            [60, 4.5],
            [64, 8.5],
        ]);
        expect(new Set(result.notes.map((note) => note.id)).size).toBe(3);
        const firstOwner = result.ownersByViewId.get(result.notes[0]!.id);
        const repeatOwner = result.ownersByViewId.get(result.notes[1]!.id);
        expect(firstOwner?.row).toBe(first);
        expect(repeatOwner?.row).toBe(first);
        expect(firstOwner?.occurrenceIndex).toBe(0);
        expect(repeatOwner?.occurrenceIndex).toBe(1);
        expect(result.ownersByViewId.get(result.notes[2]!.id)?.takeId).toBe('second');
    });

    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    it('maps insertion through a selected region to original source coordinates and pass identity', () => {
        const placement = { ...loopingClip, startBeat: 2, midiOffsetBeats: 2 };
        const result = projectPianoRollTakeNotes(placement, 'track', laneState());
        expect(result.insertOwnerAtBeat(8.5)).toEqual({
            laneId: 'lane',
            takeId: 'second',
            sourceClipId: 'original',
            sourceBeat: 17.5,
            recordingPassIndex: 1,
            slotPresent: true,
        });
        expect(result.insertOwnerAtBeat(20)).toBeNull();

        // Live comp playback of the same passes, before any freeze, reads the same source beat there.
        const live = laneState();
        live.lanes[0]!.takes = live.lanes[0]!.takes.map(({ midiSource, ...take }) => ({
            ...take,
            sourceOffsetBeats: midiSource!.sourceEntryBeat - midiSource!.phaseHeadBeat,
        }));
        takeLaneStore.set(live);
        const clip: Clip = {
            ...placement,
            trackId: 'track',
            name: 'Recording',
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#000',
            locked: false,
            muted: false,
        };
        const fragment = resolveClipsWithComping('track', [clip]).find(
            (candidate) => candidate.startBeat <= 8.5 && candidate.endBeat > 8.5
        );
        expect((fragment?.midiOffsetBeats ?? 0) + 8.5 - (fragment?.startBeat ?? 0)).toBe(17.5);
    });

    it('clips base notes around a selected empty region and keeps both gap views on one base row', () => {
        const state = laneState();
        state.lanes[0]!.activeCompRegions = [{ startBeat: 2, endBeat: 4, takeId: 'first' }];
        const base = {
            id: 'base-held',
            pitch: 70,
            startBeat: 0,
            duration: 6,
            velocity: 80,
            expression: {
                pressure: [
                    { offsetBeats: 1, value: 20 },
                    { offsetBeats: 3, value: 40 },
                    { offsetBeats: 5, value: 60 },
                ],
            },
        };
        const result = projectPianoRollTakeNotes({ id: 'clip', startBeat: 0, endBeat: 6 }, 'track', state, [base]);
        expect(result.baseNotes.map((note) => [note.startBeat, note.duration])).toEqual([
            [0, 2],
            [4, 2],
        ]);
        expect(result.baseNotes[0]?.id).not.toBe(result.baseNotes[1]?.id);
        expect(result.baseNotes.map((note) => result.baseOwnersByViewId.get(note.id)?.row)).toEqual([base, base]);
        expect(result.baseNotes[1]?.expression?.pressure?.map((point) => point.offsetBeats)).toEqual([1]);
        expect(result.insertOwnerAtBeat(2.5)?.takeId).toBe('first');
        expect(result.insertOwnerAtBeat(4.5)).toBeNull();
    });
});

describe('piano roll frozen take run-up', () => {
    // Recorded from 6 in loop [8, 12): the first pass's take opens on the loop, its run-up before it.
    const runUp = { id: 'run-up', pitch: 61, startBeat: 0.5, duration: 0.25, velocity: 90, recordingPassIndex: 0 };
    const inLoop = { id: 'in-loop', pitch: 62, startBeat: 3, duration: 0.25, velocity: 90, recordingPassIndex: 0 };
    function runUpLane(region: { startBeat: number; endBeat: number }): TakeLaneStoreState {
        return {
            lanes: [
                {
                    id: 'lane',
                    trackId: 'track',
                    takes: [
                        {
                            id: 'first-pass',
                            clipId: 'clip',
                            name: 'First pass',
                            startBeat: 8,
                            endBeat: 12,
                            selected: true,
                            recordingPassIndex: 0,
                            midiSource: {
                                sourceClipId: 'original',
                                sourceEntryBeat: 2,
                                sourceEndBeat: 6,
                                phaseHeadBeat: 8,
                                passLengthBeats: 4,
                                rows: {
                                    notes: { present: true, value: [runUp, inLoop] },
                                    controlChanges: { present: true, value: [] },
                                    pitchBends: { present: true, value: [] },
                                },
                            },
                        },
                    ],
                    activeCompRegions: [{ ...region, takeId: 'first-pass' }],
                },
            ],
        };
    }
    const clip = { id: 'clip', startBeat: 6, endBeat: 13 };

    it('shows the run-up of a comped first pass from the clip start', () => {
        const result = projectPianoRollTakeNotes(clip, 'track', runUpLane({ startBeat: 6, endBeat: 12 }));

        expect(result.notes.map((note) => [note.pitch, note.startBeat])).toEqual([
            [61, 0.5],
            [62, 3],
        ]);
        expect(result.ownersByViewId.get(result.notes[0]!.id)).toMatchObject({ row: runUp, occurrenceIndex: 0 });
    });

    it('shows the run-up under a comp that ends at the take start and inserts into it at its source beat', () => {
        const result = projectPianoRollTakeNotes(clip, 'track', runUpLane({ startBeat: 6, endBeat: 8 }));

        expect(result.notes.map((note) => [note.pitch, note.startBeat])).toEqual([[61, 0.5]]);
        expect(result.insertOwnerAtBeat(1)).toMatchObject({
            takeId: 'first-pass',
            sourceBeat: 1,
            recordingPassIndex: 0,
        });
    });
});
