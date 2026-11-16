import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, takeLaneStore, type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

import { projectPianoRollTakeNotes } from '#/modules/MIDI/useCases';

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

    it('retains original occurrence IDs when a bounded query reads only the later repeat', () => {
        const full = projectPianoRollTakeNotes(loopingClip, 'track', laneState());
        const bounded = projectPianoRollTakeNotes(loopingClip, 'track', laneState(), [], {
            fromBeat: 4,
            toBeat: 8,
            maxWork: 100,
            maxOutput: 10,
        });
        expect(bounded.notes).toEqual(full.notes.filter((note) => note.startBeat >= 4 && note.startBeat < 8));
        expect(bounded.ownersByViewId.get(bounded.notes[0]!.id)).toEqual(full.ownersByViewId.get(full.notes[1]!.id));
    });

    it('retains frozen controller and bend ownership and carry provenance inside a bounded query', () => {
        const state = laneState();
        const take = state.lanes[0]!.takes[0]!;
        take.midiSource = {
            ...take.midiSource!,
            rows: {
                ...take.midiSource!.rows,
                controlChanges: {
                    present: true,
                    value: [{ id: 'pedal', controller: 64, value: 127, channel: 0, beat: 4.8 }],
                },
                pitchBends: { present: true, value: [{ id: 'bend', value: 2048, channel: 0, beat: 4.9 }] },
            },
        };
        const projected = projectPianoRollTakeNotes(loopingClip, 'track', state, [], {
            fromBeat: 0,
            toBeat: 4,
            maxWork: 1_000,
            maxOutput: 100,
        });
        expect(projected.frozenControllers).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ownerClipId: 'original',
                    takeId: 'first',
                    occurrenceIndex: 0,
                    origin: 'carried',
                    sourceBeat: 4.8,
                    row: expect.objectContaining({ id: 'pedal', beat: 0 }),
                }),
            ])
        );
        expect(projected.frozenPitchBends).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ownerClipId: 'original',
                    takeId: 'first',
                    occurrenceIndex: 0,
                    origin: 'carried',
                    sourceBeat: 4.9,
                    row: expect.objectContaining({ id: 'bend', beat: 0 }),
                }),
            ])
        );
    });

    it('refuses before enumerating a query with too many repeats', () => {
        expect(() =>
            projectPianoRollTakeNotes(loopingClip, 'track', laneState(), [], {
                fromBeat: 0,
                toBeat: 12,
                maxWork: 1,
                maxOutput: 10,
            })
        ).toThrow('MIDI projection work budget exceeded');
    });

    it('refuses a nonprogressing loop coordinate and a deep folded source before projection', () => {
        const distant = laneState();
        distant.lanes[0]!.activeCompRegions = [{ startBeat: 1e16, endBeat: 1e16 + 100, takeId: 'first' }];
        expect(() =>
            projectPianoRollTakeNotes(
                { ...loopingClip, startBeat: 1e16, endBeat: 1e16 + 100, loopLength: 1 },
                'track',
                distant,
                [],
                { fromBeat: 1e16, toBeat: 1e16 + 10, maxWork: 10_000, maxOutput: 100 }
            )
        ).toThrow('MIDI projection work budget exceeded');

        const deep = laneState();
        const take = deep.lanes[0]!.takes[0]!;
        take.midiSource = { ...take.midiSource!, sourceEntryBeat: 1e9, sourceEndBeat: 1e9 + 4 };
        expect(() =>
            projectPianoRollTakeNotes(loopingClip, 'track', deep, [], {
                fromBeat: 0,
                toBeat: 4,
                maxWork: 10_000,
                maxOutput: 100,
            })
        ).toThrow('MIDI projection work budget exceeded');
    });

    it('projects a trimmed anchored base clip on the original loop seams in a late window', () => {
        const clip = {
            id: 'clip',
            startBeat: 1,
            endBeat: 12,
            midiOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
        };
        const source = { id: 'head', pitch: 67, startBeat: 0, duration: 0.25, velocity: 80 };
        const result = projectPianoRollTakeNotes(clip, 'track', null, [source], {
            fromBeat: 4,
            toBeat: 9,
            maxWork: 100,
            maxOutput: 10,
        });
        expect(result.baseOccurrences.map((entry) => [entry.row.id, entry.startBeat])).toEqual([
            ['head', 4],
            ['head', 8],
        ]);
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
