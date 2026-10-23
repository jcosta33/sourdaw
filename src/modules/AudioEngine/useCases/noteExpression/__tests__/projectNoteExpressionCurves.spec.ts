import { describe, expect, it } from 'vitest';

import { projectNoteExpressionCurves } from '../projectNoteExpressionCurves';

/** 120 BPM at 48 kHz: one beat is half a second, 24000 frames. */
const FRAMES_PER_BEAT = 24_000;

function frameAtBeat(beat: number): number {
    return Math.round(beat * FRAMES_PER_BEAT);
}

describe('projectNoteExpressionCurves', () => {
    it('posts one change per curve point, each with the full expression in force', () => {
        const { atStart, changes } = projectNoteExpressionCurves({
            note: {
                pressure: 10,
                slide: 64,
                pitchBend: 2048,
                pitchBendRangeSemitones: 12,
                expression: {
                    pressure: [
                        { offsetBeats: 0.5, value: 40 },
                        { offsetBeats: 1, value: 90 },
                        { offsetBeats: 1.5, value: 20 },
                    ],
                },
            },
            startBeat: 2,
            releaseFrame: frameAtBeat(4),
            frameAtBeat,
        });

        expect(atStart).toBeUndefined();
        expect(changes).toEqual([
            {
                beat: 2.5,
                frame: frameAtBeat(2.5),
                expression: { pressure: 40, slide: 64, pitchBend: 2048, pitchBendRangeSemitones: 12 },
            },
            {
                beat: 3,
                frame: frameAtBeat(3),
                expression: { pressure: 90, slide: 64, pitchBend: 2048, pitchBendRangeSemitones: 12 },
            },
            {
                beat: 3.5,
                frame: frameAtBeat(3.5),
                expression: { pressure: 20, slide: 64, pitchBend: 2048, pitchBendRangeSemitones: 12 },
            },
        ]);
    });

    it('posts one change per distinct offset when curves of different dimensions interleave', () => {
        const { changes } = projectNoteExpressionCurves({
            note: {
                pressure: 10,
                slide: 64,
                pitchBendRangeSemitones: 2,
                expression: {
                    pressure: [
                        { offsetBeats: 0.5, value: 40 },
                        { offsetBeats: 1, value: 90 },
                    ],
                    pitchBend: [
                        { offsetBeats: 0.25, value: 1000 },
                        { offsetBeats: 1, value: -500 },
                    ],
                },
            },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        expect(changes.map((change) => change.beat)).toEqual([0.25, 0.5, 1]);
        expect(changes.map((change) => change.expression)).toEqual([
            { pressure: 10, slide: 64, pitchBend: 1000, pitchBendRangeSemitones: 2 },
            { pressure: 40, slide: 64, pitchBend: 1000, pitchBendRangeSemitones: 2 },
            { pressure: 90, slide: 64, pitchBend: -500, pitchBendRangeSemitones: 2 },
        ]);
    });

    it('drops every point at or past the release frame of a note a loop cut shortened', () => {
        const { changes } = projectNoteExpressionCurves({
            note: {
                pressure: 10,
                expression: {
                    pressure: [
                        { offsetBeats: 0.5, value: 40 },
                        { offsetBeats: 1, value: 90 },
                        { offsetBeats: 1.5, value: 20 },
                    ],
                },
            },
            startBeat: 0,
            // The note was two beats long; the loop end cut it to one.
            releaseFrame: frameAtBeat(1),
            frameAtBeat,
        });

        expect(changes.map((change) => change.expression.pressure)).toEqual([40]);
    });

    it('moves the points with the start the caller plays the note at', () => {
        const note = { pressure: 10, expression: { pressure: [{ offsetBeats: 1, value: 90 }] } };

        const onTime = projectNoteExpressionCurves({ note, startBeat: 2, releaseFrame: frameAtBeat(4), frameAtBeat });
        const grooved = projectNoteExpressionCurves({
            note,
            startBeat: 2.1,
            releaseFrame: frameAtBeat(4.1),
            frameAtBeat,
        });

        expect(onTime.changes.map((change) => change.frame)).toEqual([frameAtBeat(3)]);
        expect(grooved.changes.map((change) => change.frame)).toEqual([frameAtBeat(3.1)]);
    });

    it('folds a point on the start frame into the start expression instead of posting a second event', () => {
        const { atStart, changes } = projectNoteExpressionCurves({
            note: {
                pressure: 10,
                expression: {
                    pressure: [
                        // Closer to the start than one frame.
                        { offsetBeats: 1e-6, value: 70 },
                        { offsetBeats: 1, value: 90 },
                    ],
                },
            },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        expect(atStart).toEqual({ pressure: 70 });
        expect(changes.map((change) => change.frame)).toEqual([frameAtBeat(1)]);
    });

    it('collapses points that share a frame to the last of them', () => {
        const { changes } = projectNoteExpressionCurves({
            note: {
                expression: {
                    pressure: [
                        { offsetBeats: 1, value: 30 },
                        { offsetBeats: 1 + 1e-6, value: 50 },
                    ],
                },
            },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        expect(changes).toHaveLength(1);
        expect(changes[0]?.expression.pressure).toBe(50);
    });

    it('clamps each dimension and defaults the bend range only when there is a bend', () => {
        const { changes } = projectNoteExpressionCurves({
            note: {
                expression: {
                    pressure: [{ offsetBeats: 0.5, value: 200 }],
                    pitchBend: [{ offsetBeats: 1, value: 9000 }],
                },
            },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        expect(changes.map((change) => change.expression)).toEqual([
            { pressure: 127, slide: undefined, pitchBend: undefined },
            { pressure: 127, slide: undefined, pitchBend: 8191, pitchBendRangeSemitones: 48 },
        ]);
    });

    it('clamps slide above its range and every dimension below its range', () => {
        const { changes } = projectNoteExpressionCurves({
            note: {
                expression: {
                    pressure: [{ offsetBeats: 0.5, value: -10 }],
                    slide: [{ offsetBeats: 1, value: 300 }],
                    pitchBend: [{ offsetBeats: 1.5, value: -9000 }],
                },
            },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        // Slide holds 300 at the second point, then is read again, still clamped, at the third.
        expect(changes.map((change) => change.expression)).toEqual([
            { pressure: 0, slide: undefined, pitchBend: undefined },
            { pressure: 0, slide: 127, pitchBend: undefined },
            { pressure: 0, slide: 127, pitchBend: -8192, pitchBendRangeSemitones: 48 },
        ]);
    });

    it('clamps slide below its range to 0', () => {
        const { changes } = projectNoteExpressionCurves({
            note: { expression: { slide: [{ offsetBeats: 0.5, value: -10 }] } },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        expect(changes.map((change) => change.expression.slide)).toEqual([0]);
    });

    it('measures offsets from the uncut note start, folding the points a cut passed into the start', () => {
        // The note began at beat 1 but plays from beat 2, one beat in.
        const { atStart, changes } = projectNoteExpressionCurves({
            note: {
                pressure: 10,
                expression: {
                    pressure: [
                        { offsetBeats: 0.5, value: 40 },
                        { offsetBeats: 2, value: 20 },
                    ],
                },
            },
            startBeat: 2,
            beatsIntoNote: 1,
            releaseFrame: frameAtBeat(5),
            frameAtBeat,
        });

        expect(atStart).toEqual({ pressure: 40, slide: undefined, pitchBend: undefined });
        expect(changes).toEqual([
            {
                beat: 3,
                frame: frameAtBeat(3),
                expression: { pressure: 20, slide: undefined, pitchBend: undefined },
            },
        ]);
    });

    it('starts the note on the last point a cut passed, not the first', () => {
        // The note began at beat 0 and plays from beat 2: three points lie behind the cut, one ahead of it.
        const { atStart, changes } = projectNoteExpressionCurves({
            note: {
                pressure: 10,
                expression: {
                    pressure: [
                        { offsetBeats: 0.5, value: 40 },
                        { offsetBeats: 1, value: 60 },
                        { offsetBeats: 1.5, value: 90 },
                        { offsetBeats: 3, value: 20 },
                    ],
                },
            },
            startBeat: 2,
            beatsIntoNote: 2,
            releaseFrame: frameAtBeat(4),
            frameAtBeat,
        });

        expect(atStart?.pressure).toBe(90);
        expect(changes.map((change) => [change.beat, change.expression.pressure])).toEqual([[3, 20]]);
    });

    it('starts the note on its last point when a cut passed every point of it', () => {
        const { atStart, changes } = projectNoteExpressionCurves({
            note: {
                pressure: 10,
                expression: {
                    pressure: [
                        { offsetBeats: 0.5, value: 40 },
                        { offsetBeats: 1, value: 60 },
                    ],
                },
            },
            startBeat: 2,
            beatsIntoNote: 2,
            releaseFrame: frameAtBeat(4),
            frameAtBeat,
        });

        expect(atStart?.pressure).toBe(60);
        expect(changes).toEqual([]);
    });

    it('clamps a recorded bend range above 127 to 127', () => {
        const { changes } = projectNoteExpressionCurves({
            note: {
                pitchBendRangeSemitones: 500,
                expression: { pitchBend: [{ offsetBeats: 0.5, value: 100 }] },
            },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        expect(changes[0]?.expression.pitchBendRangeSemitones).toBe(127);
    });

    it('clamps a recorded bend range below 0 to 0', () => {
        const { changes } = projectNoteExpressionCurves({
            note: {
                pitchBendRangeSemitones: -3,
                expression: { pitchBend: [{ offsetBeats: 0.5, value: 100 }] },
            },
            startBeat: 0,
            releaseFrame: frameAtBeat(2),
            frameAtBeat,
        });

        expect(changes[0]?.expression.pitchBendRangeSemitones).toBe(0);
    });

    it('projects nothing for a note without recorded curves', () => {
        expect(
            projectNoteExpressionCurves({
                note: { pressure: 10, slide: 64, pitchBend: 100 },
                startBeat: 0,
                releaseFrame: frameAtBeat(2),
                frameAtBeat,
            })
        ).toEqual({ changes: [] });
    });

    describe('with the track channel pitch bend', () => {
        const move = (beat: number, value: number, rangeSemitones = 2) => ({
            beat,
            frame: frameAtBeat(beat),
            recordedBeat: beat,
            value,
            rangeSemitones,
        });
        /** A move a pass head plays at `beat`, carried from the row recorded at `recordedBeat` before it. */
        const carried = (beat: number, recordedBeat: number, value: number) => ({
            ...move(beat, value),
            recordedBeat,
        });
        const plainNote = { pressure: 10, slide: 64 };

        it('moves a sounding note at each move strictly between its start and its release', () => {
            const { atStart, changes } = projectNoteExpressionCurves({
                note: plainNote,
                channelBend: [move(1, 8_191), move(2, 0), move(3, -4_096, 12)],
                startBeat: 0,
                releaseFrame: frameAtBeat(3),
                frameAtBeat,
            });

            expect(atStart).toBeUndefined();
            // The move on the release frame is dropped with the voice; pressure and slide stay the note's own.
            expect(changes).toEqual([
                {
                    beat: 1,
                    frame: frameAtBeat(1),
                    expression: { pressure: 10, slide: 64, pitchBend: 8_191, pitchBendRangeSemitones: 2 },
                },
                {
                    beat: 2,
                    frame: frameAtBeat(2),
                    expression: { pressure: 10, slide: 64, pitchBend: 0, pitchBendRangeSemitones: 2 },
                },
            ]);
        });

        it('starts a note on the bend in force at its start, the last move at or before the start frame', () => {
            const { atStart, changes } = projectNoteExpressionCurves({
                note: plainNote,
                channelBend: [move(0.5, 8_191), move(1, 4_096, 12), move(1.5, 0)],
                startBeat: 1,
                releaseFrame: frameAtBeat(3),
                frameAtBeat,
            });

            // The move on the start frame replaces the one before it: the note-on carries 4096 at 12.
            expect(atStart).toEqual({ pressure: 10, slide: 64, pitchBend: 4_096, pitchBendRangeSemitones: 12 });
            expect(changes.map((change) => [change.beat, change.expression.pitchBend])).toEqual([[1.5, 0]]);
        });

        it('leaves the glide of an MPE note intact under a stale centred bend from before it started', () => {
            const { atStart, changes } = projectNoteExpressionCurves({
                note: {
                    pitchBend: 0,
                    pitchBendRangeSemitones: 48,
                    expression: { pitchBend: [{ offsetBeats: 1, value: 4_000 }] },
                },
                channelBend: [move(0.5, 0)],
                startBeat: 1,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            // The note's own bend is the latest at its start, so the note-on keeps its scalar and the glide plays.
            expect(atStart).toBeUndefined();
            expect(changes).toEqual([
                {
                    beat: 2,
                    frame: frameAtBeat(2),
                    expression: {
                        pressure: undefined,
                        slide: undefined,
                        pitchBend: 4_000,
                        pitchBendRangeSemitones: 48,
                    },
                },
            ]);
        });

        it('starts a note with a bend of its own on that bend, whatever bend is in force, even on the start frame', () => {
            const note = { pitchBend: 1_000, pitchBendRangeSemitones: 48 };

            const before = projectNoteExpressionCurves({
                note,
                channelBend: [move(0.5, 2_000)],
                startBeat: 1,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });
            const onTheFrame = projectNoteExpressionCurves({
                note,
                channelBend: [move(1, 2_000)],
                startBeat: 1,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(before).toEqual({ changes: [] });
            expect(onTheFrame).toEqual({ changes: [] });
        });

        it('starts a note with no bend of its own on the bend in force, at that move’s range', () => {
            const { atStart, changes } = projectNoteExpressionCurves({
                note: plainNote,
                channelBend: [move(0.5, 8_191, 12)],
                startBeat: 1,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(atStart).toEqual({ pressure: 10, slide: 64, pitchBend: 8_191, pitchBendRangeSemitones: 12 });
            expect(changes).toEqual([]);
        });

        it('lets the later of a channel move and the note’s own bend point hold the bend and its range', () => {
            const { atStart, changes } = projectNoteExpressionCurves({
                note: {
                    pitchBend: 1_000,
                    pitchBendRangeSemitones: 48,
                    expression: {
                        pitchBend: [
                            { offsetBeats: 2, value: 2_000 },
                            { offsetBeats: 4, value: -1_000 },
                        ],
                    },
                },
                channelBend: [move(1, 8_191, 12), move(3, 0)],
                startBeat: 0,
                releaseFrame: frameAtBeat(6),
                frameAtBeat,
            });

            expect(atStart).toBeUndefined();
            // A move holds the bend until the note's next own point, and that point holds it until the next move.
            expect(
                changes.map((change) => [
                    change.beat,
                    change.expression.pitchBend,
                    change.expression.pitchBendRangeSemitones,
                ])
            ).toEqual([
                [1, 8_191, 12],
                [2, 2_000, 48],
                [3, 0, 2],
                [4, -1_000, 48],
            ]);
        });

        it('lets the note’s own bend point have the last word over a move on the same frame', () => {
            const { changes } = projectNoteExpressionCurves({
                note: { pitchBend: 1_000, expression: { pitchBend: [{ offsetBeats: 2, value: 2_000 }] } },
                channelBend: [move(2, 8_191)],
                startBeat: 0,
                releaseFrame: frameAtBeat(6),
                frameAtBeat,
            });

            expect(changes.map((change) => change.expression.pitchBend)).toEqual([2_000]);
        });

        it('holds a move’s bend over a later pressure point of the note, which is not a bend point', () => {
            const { changes } = projectNoteExpressionCurves({
                note: { pitchBend: 1_000, expression: { pressure: [{ offsetBeats: 3, value: 90 }] } },
                channelBend: [move(1, 8_191)],
                startBeat: 0,
                releaseFrame: frameAtBeat(6),
                frameAtBeat,
            });

            expect(
                changes.map((change) => [change.beat, change.expression.pressure, change.expression.pitchBend])
            ).toEqual([
                [1, undefined, 8_191],
                [3, 90, 8_191],
            ]);
        });

        it('keeps the note’s own bend until the first move arrives', () => {
            const { atStart, changes } = projectNoteExpressionCurves({
                note: { pitchBend: 1_000, pitchBendRangeSemitones: 48, expression: { pressure: [] } },
                channelBend: [move(2, 0)],
                startBeat: 0,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(atStart).toBeUndefined();
            expect(changes.map((change) => change.expression.pitchBend)).toEqual([0]);
        });

        it('follows the move into a note a clip cut took the head off, from the cut start', () => {
            const { atStart } = projectNoteExpressionCurves({
                note: plainNote,
                channelBend: [move(1, 8_191)],
                startBeat: 2,
                beatsIntoNote: 1.5,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(atStart?.pitchBend).toBe(8_191);
        });

        // A trimmed clip head carries its rows onto the head the cut note starts on (beat 2), each still saying
        // where it was recorded, as `projectChannelBend` lists them.
        it('starts a cut note on a channel move recorded after its scalar bend, before the cut', () => {
            const { atStart, changes } = projectNoteExpressionCurves({
                note: { pitchBend: 0, pitchBendRangeSemitones: 48 },
                channelBend: [carried(2, 1, 4_096)],
                startBeat: 2,
                beatsIntoNote: 2,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(atStart?.pitchBend).toBe(4_096);
            expect(atStart?.pitchBendRangeSemitones).toBe(2);
            expect(changes).toEqual([]);
        });

        it('keeps a cut note on its own bend point recorded after the channel move', () => {
            const { atStart } = projectNoteExpressionCurves({
                note: {
                    pitchBend: 0,
                    pitchBendRangeSemitones: 48,
                    expression: { pitchBend: [{ offsetBeats: 1.5, value: 1_000 }] },
                },
                channelBend: [carried(2, 1, 4_096)],
                startBeat: 2,
                beatsIntoNote: 2,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(atStart).toEqual({
                pressure: undefined,
                slide: undefined,
                pitchBend: 1_000,
                pitchBendRangeSemitones: 48,
            });
        });

        it('starts a cut note on a channel move recorded after its own bend point', () => {
            const { atStart } = projectNoteExpressionCurves({
                note: {
                    pitchBend: 0,
                    pitchBendRangeSemitones: 48,
                    expression: { pitchBend: [{ offsetBeats: 0.5, value: 1_000 }] },
                },
                channelBend: [carried(2, 1, 4_096)],
                startBeat: 2,
                beatsIntoNote: 2,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(atStart?.pitchBend).toBe(4_096);
            expect(atStart?.pitchBendRangeSemitones).toBe(2);
        });

        it('leaves a cut note with its own bend when a move was recorded on the frame of its bend point or its uncut start', () => {
            const onThePoint = projectNoteExpressionCurves({
                note: {
                    pitchBend: 0,
                    pitchBendRangeSemitones: 48,
                    expression: { pitchBend: [{ offsetBeats: 1, value: 1_000 }] },
                },
                channelBend: [carried(2, 1, 4_096)],
                startBeat: 2,
                beatsIntoNote: 2,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });
            const onTheUncutStart = projectNoteExpressionCurves({
                note: { pitchBend: 0, pitchBendRangeSemitones: 48 },
                channelBend: [carried(2, 1, 4_096)],
                startBeat: 2,
                beatsIntoNote: 1,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(onThePoint.atStart?.pitchBend).toBe(1_000);
            expect(onTheUncutStart.atStart).toBeUndefined();
        });

        it('keeps a cut note on its scalar bend when the channel move was recorded before the uncut start', () => {
            const { atStart } = projectNoteExpressionCurves({
                note: { pitchBend: 0, pitchBendRangeSemitones: 48 },
                channelBend: [carried(2, 0.5, 4_096)],
                startBeat: 2,
                beatsIntoNote: 1,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(atStart).toBeUndefined();
        });

        it('interleaves the moves with the curve points of the note in time order', () => {
            const { changes } = projectNoteExpressionCurves({
                note: { pressure: 10, expression: { pressure: [{ offsetBeats: 1.5, value: 90 }] } },
                channelBend: [move(1, 8_191), move(3, 0)],
                startBeat: 0,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            // The pressure point between the two moves carries the bend then in force, and the move after
            // it carries the pressure the point left.
            expect(
                changes.map((change) => [change.beat, change.expression.pressure, change.expression.pitchBend])
            ).toEqual([
                [1, 10, 8_191],
                [1.5, 90, 8_191],
                [3, 90, 0],
            ]);
        });

        it('collapses moves that share a frame to the last in posting order', () => {
            const { changes } = projectNoteExpressionCurves({
                note: plainNote,
                // Two moves on one frame: the later in posting order wins, as the instrument ends on it.
                channelBend: [move(1, 100), { ...move(1, 200), beat: 1.00001 }, move(2, 300)],
                startBeat: 0,
                releaseFrame: frameAtBeat(4),
                frameAtBeat,
            });

            expect(changes.map((change) => [change.frame, change.expression.pitchBend])).toEqual([
                [frameAtBeat(1), 200],
                [frameAtBeat(2), 300],
            ]);
        });
    });
});
