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
});
