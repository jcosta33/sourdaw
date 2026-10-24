import { describe, expect, it } from 'vitest';

import { relocateNoteExpression } from '../relocateNoteExpression';
import { startNoteExpression } from '../startNoteExpression';

const frameAtBeat = (beat: number) => beat * 1000;
const newPassFrameAtBeat = (beat: number) => 50_000 + beat * 1000;

const move = (beat: number, value: number, rangeSemitones = 2, channel = 0, zoneWide = false) => ({
    beat,
    frame: beat * 1000,
    recordedBeat: beat,
    value,
    rangeSemitones,
    channel,
    zoneWide,
});

/** The destination of the relocation, 50 000 frames on: a new pass whose beat 0 lands there. */
const AT_FRAME = 50_000;
/** A move of the new pass, placed on the new clock. */
const newPassMove = (beat: number, value: number, rangeSemitones = 2, channel = 0, zoneWide = false) => ({
    beat,
    frame: newPassFrameAtBeat(beat),
    recordedBeat: beat,
    value,
    rangeSemitones,
    channel,
    zoneWide,
});

function startNote(
    options: {
        note?: Parameters<typeof startNoteExpression>[0]['note'];
        channelBend?: ReturnType<typeof move>[];
    } = {}
) {
    return startNoteExpression({
        note: options.note ?? { pressure: 10 },
        channelBend: options.channelBend,
        startBeat: 0,
        releaseFrame: 80_000,
        frameAtBeat,
    }).timeline;
}

describe('relocateNoteExpression', () => {
    it('gives the note the last channel move at or before the frame the window opens on, on that frame', () => {
        const timeline = startNote({ channelBend: [move(0, 100)] });

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(-3, 500, 12), newPassMove(0, 4096), newPassMove(1, 8191)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        // The move on the opening frame is in force there; the one after it waits for its own frame.
        expect(relocated.expression).toEqual({ pressure: 10, pitchBend: 4096, pitchBendRangeSemitones: 2 });
        expect(relocated.timeline.channel).toEqual({ value: 4096, rangeSemitones: 2 });
        expect(relocated.timeline.bendOwner).toBe('channel');
    });

    describe('per MIDI channel', () => {
        it('takes the bend in force on the note’s own channel and ignores another channel’s', () => {
            const timeline = startNote({ note: { pressure: 10, channel: 2 } });

            const relocated = relocateNoteExpression({
                timeline,
                channelBend: [newPassMove(0, 300, 12, 2), newPassMove(0, 8191, 2, 1)],
                atFrame: AT_FRAME,
                frameAtBeat: newPassFrameAtBeat,
            });

            expect(relocated.expression).toEqual({ pressure: 10, pitchBend: 300, pitchBendRangeSemitones: 12 });
        });

        it('sends a note nothing when only another channel holds a bend at the destination', () => {
            const timeline = startNote({ note: { pressure: 10, channel: 2 } });

            const relocated = relocateNoteExpression({
                timeline,
                channelBend: [newPassMove(0, 8191, 2, 1)],
                atFrame: AT_FRAME,
                frameAtBeat: newPassFrameAtBeat,
            });

            expect(relocated.expression).toBeUndefined();
            expect(relocated.timeline.channel).toBeUndefined();
        });

        it('takes the bend in force on any channel for a note with no stored channel', () => {
            const timeline = startNote({ note: { pressure: 10 } });

            const relocated = relocateNoteExpression({
                timeline,
                channelBend: [newPassMove(0, 300, 12, 2)],
                atFrame: AT_FRAME,
                frameAtBeat: newPassFrameAtBeat,
            });

            expect(relocated.expression).toEqual({ pressure: 10, pitchBend: 300, pitchBendRangeSemitones: 12 });
        });

        it('gives a zone-wide move to a note on any channel', () => {
            const timeline = startNote({ note: { pressure: 10, channel: 4 } });

            const relocated = relocateNoteExpression({
                timeline,
                channelBend: [newPassMove(0, 700, 48, 0, true)],
                atFrame: AT_FRAME,
                frameAtBeat: newPassFrameAtBeat,
            });

            expect(relocated.expression).toEqual({ pressure: 10, pitchBend: 700, pitchBendRangeSemitones: 48 });
        });
    });

    it('records the move in force as taken, so the window that lists it again does not replay it', () => {
        const relocated = relocateNoteExpression({
            timeline: startNote(),
            channelBend: [newPassMove(-2, 100), newPassMove(0, 4096)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.timeline.advancedBeat).toBe(0);
    });

    it('moves the note on the clock of the pass it relocates to, with its start and release where they were', () => {
        const timeline = startNote();

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(0, 4096)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.timeline.frameAtBeat(3)).toBe(53_000);
        expect(relocated.timeline.startFrame).toBe(timeline.startFrame);
        expect(relocated.timeline.releaseFrame).toBe(80_000);
    });

    it('drops the own curve points the note had not reached, and keeps the value it holds', () => {
        const timeline = startNote({
            note: {
                pressure: 10,
                expression: {
                    pressure: [
                        { offsetBeats: 1, value: 40 },
                        { offsetBeats: 2, value: 90 },
                    ],
                },
            },
        });
        expect(timeline.pending).toHaveLength(2);

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(0, 4096)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.timeline.pending).toEqual([]);
        expect(relocated.expression?.pressure).toBe(10);
    });

    it('takes the bend from a note that held its own, and keeps its pressure and slide', () => {
        const timeline = startNote({
            note: { pressure: 20, slide: 70, pitchBend: 1000, pitchBendRangeSemitones: 48 },
        });
        expect(timeline.bendOwner).toBe('note');

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(0, 2048, 24)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.expression).toEqual({
            pressure: 20,
            slide: 70,
            pitchBend: 2048,
            pitchBendRangeSemitones: 24,
        });
        expect(relocated.timeline.bendOwner).toBe('channel');
    });

    it('returns a note a channel move bent to centre, at the depth it was bent at, when none is in force', () => {
        // The note followed a move of the pass it leaves, at beat 3.
        const timeline = { ...startNote({ channelBend: [move(0, 8191, 12)] }), advancedBeat: 3 };

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(2, 4096)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.expression).toEqual({ pressure: 10, pitchBend: 0, pitchBendRangeSemitones: 12 });
        expect(relocated.timeline.channel).toEqual({ value: 0, rangeSemitones: 12 });
        expect(relocated.timeline.advancedBeat).toBe(Number.NEGATIVE_INFINITY);
    });

    it('leaves a note no channel move ever bent as it is when none is in force', () => {
        const timeline = startNote({ note: { pressure: 10, pitchBend: 1000, pitchBendRangeSemitones: 48 } });

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(2, 4096)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.expression).toBeUndefined();
        expect(relocated.timeline.channel).toBeUndefined();
        expect(relocated.timeline.bendOwner).toBe('note');
    });

    it('returns no expression when the bend in force is the one the note holds', () => {
        const timeline = startNote({ channelBend: [move(0, 4096)] });

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(0, 4096)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.expression).toBeUndefined();
    });

    it('returns the expression when the same bend is read at another depth', () => {
        const timeline = startNote({ channelBend: [move(0, 4096, 2)] });

        const relocated = relocateNoteExpression({
            timeline,
            channelBend: [newPassMove(0, 4096, 12)],
            atFrame: AT_FRAME,
            frameAtBeat: newPassFrameAtBeat,
        });

        expect(relocated.expression).toEqual({ pressure: 10, pitchBend: 4096, pitchBendRangeSemitones: 12 });
    });
});
