import { afterEach, describe, expect, it, vi } from 'vitest';

import { startNoteExpression } from '#/modules/AudioEngine/useCases';

import { forgetHeldNoteExpression } from '../forgetHeldNoteExpression';
import { holdNoteExpression } from '../holdNoteExpression';
import { keepHeldNoteExpressionOnReceiver } from '../keepHeldNoteExpressionOnReceiver';
import { takeHeldNoteExpression } from '../takeHeldNoteExpression';

// The engine's own timeline is the contract under test with the held notes: what a window takes from a
// started note is what that timeline moves on to.
vi.mock('#/modules/AudioEngine/useCases', async () => ({
    advanceNoteExpression: (
        await vi.importActual<Pick<typeof import('#/modules/AudioEngine/useCases'), 'advanceNoteExpression'>>(
            '#/modules/AudioEngine/useCases/noteExpression/advanceNoteExpression'
        )
    ).advanceNoteExpression,
    startNoteExpression: (
        await vi.importActual<Pick<typeof import('#/modules/AudioEngine/useCases'), 'startNoteExpression'>>(
            '#/modules/AudioEngine/useCases/noteExpression/startNoteExpression'
        )
    ).startNoteExpression,
}));

const frameAtBeat = (beat: number) => beat * 1000;

const change = (beat: number, pressure: number) => ({ beat, frame: beat * 1000, expression: { pressure } });

const bendChange = (beat: number, pitchBend: number, pressure = 10) => ({
    beat,
    frame: beat * 1000,
    expression: { pressure, pitchBend, pitchBendRangeSemitones: 2 },
});

const move = (beat: number, value: number) => ({
    beat,
    frame: beat * 1000,
    recordedBeat: beat,
    value,
    rangeSemitones: 2,
});

/** A note that starts on beat 0 and whose pressure curve is the given points, as `[offsetBeats, value]`. */
function startNote(points: [number, number][], releaseBeat: number, pressure = 10) {
    return startNoteExpression({
        note: {
            pressure,
            expression: { pressure: points.map(([offsetBeats, value]) => ({ offsetBeats, value })) },
        },
        startBeat: 0,
        releaseFrame: releaseBeat * 1000,
        frameAtBeat,
    }).timeline;
}

function hold(
    overrides: Partial<Omit<Parameters<typeof holdNoteExpression>[0], 'timeline'>> & {
        points?: [number, number][];
    } = {}
) {
    const {
        points = [
            [2, 80],
            [4, 90],
        ],
        ...rest
    } = overrides;
    const releaseBeat = rest.releaseBeat ?? 10;
    holdNoteExpression({
        trackId: 'track-1',
        pitch: 64,
        channel: 2,
        receiverId: 'device-1',
        releaseBeat,
        followsChannelBend: false,
        timeline: startNote(points, releaseBeat),
        ...rest,
    });
}

function take(fromBeat: number, toBeat: number, trackId = 'track-1', moves: ReturnType<typeof move>[] = []) {
    return takeHeldNoteExpression({
        trackId,
        fromBeat,
        toBeat,
        fromFrame: fromBeat * 1000 + 7,
        readChannelBend: () => moves,
    });
}

describe('heldNoteExpression', () => {
    afterEach(() => {
        forgetHeldNoteExpression();
    });

    it('hands over the changes of a window once, addressed to the note, and keeps the later ones', () => {
        hold();

        expect(take(0, 3)).toEqual([{ pitch: 64, channel: 2, change: change(2, 80) }]);
        expect(take(0, 3)).toEqual([]);
        expect(take(3, 5)).toEqual([{ pitch: 64, channel: 2, change: change(4, 90) }]);
        expect(take(5, 8)).toEqual([]);
    });

    it('holds nothing for a note without changes to post and no bend to follow', () => {
        hold({ points: [] });

        expect(take(0, 8)).toEqual([]);
    });

    it('keeps a track’s other notes when one of them is taken from', () => {
        hold({ pitch: 60, points: [[2, 80]] });
        hold({ pitch: 67, points: [[6, 90]] });

        expect(take(0, 3).map(({ pitch }) => pitch)).toEqual([60]);
        expect(take(5, 7).map(({ pitch }) => pitch)).toEqual([67]);
    });

    it('keeps another track’s notes out of a window and out of a forget on a receiver', () => {
        hold({ trackId: 'track-1', points: [[2, 80]] });
        hold({ trackId: 'track-2', receiverId: 'device-2', points: [[2, 70]] });

        keepHeldNoteExpressionOnReceiver('track-1', undefined);

        expect(take(0, 3, 'track-1')).toEqual([]);
        expect(take(0, 3, 'track-2')).toEqual([{ pitch: 64, channel: 2, change: change(2, 70) }]);
    });

    it('gives a note the last change a skipped window dropped, at the frame its window opens', () => {
        hold({
            points: [
                [2, 80],
                [3, 85],
                [6, 90],
            ],
        });

        // The windows through beat 5 did not run: the beat 6 change is the window's own.
        expect(take(5, 7)).toEqual([
            { pitch: 64, channel: 2, change: { beat: 5, frame: 5007, expression: { pressure: 85 } } },
            { pitch: 64, channel: 2, change: change(6, 90) },
        ]);
    });

    it('gives the chase ahead of a change the window opens on, so the window’s own change has the last word', () => {
        hold({
            points: [
                [2, 80],
                [5, 90],
            ],
        });

        expect(take(5, 7).map(({ change: { beat, expression } }) => [beat, expression.pressure])).toEqual([
            [5, 80],
            [5, 90],
        ]);
    });

    it('chases a note whose dropped change was the only one it had left', () => {
        hold({ points: [[2, 80]] });

        expect(take(5, 7).map(({ change: { expression } }) => expression.pressure)).toEqual([80]);
        expect(take(7, 9)).toEqual([]);
    });

    it('gives nothing to a note released before the window or on its opening beat', () => {
        hold({ pitch: 60, releaseBeat: 4, points: [[2, 80]] });
        hold({ pitch: 62, releaseBeat: 5, points: [[2, 80]] });
        hold({ pitch: 64, releaseBeat: 5.5, points: [[2, 80]] });

        expect(take(5, 7).map(({ pitch }) => pitch)).toEqual([64]);
    });

    it('posts nothing for a window that opens before any parked change', () => {
        hold();

        expect(take(0, 2)).toEqual([]);
        expect(take(2, 2.5)).toEqual([{ pitch: 64, channel: 2, change: change(2, 80) }]);
    });

    it('keeps only the notes its receiver voiced, and none while the receiver is bypassed', () => {
        hold({ pitch: 60, receiverId: 'device-1', points: [[2, 80]] });
        hold({ pitch: 62, receiverId: 'device-2', points: [[2, 80]] });
        hold({ pitch: 64, receiverId: undefined, points: [[2, 80]] });

        keepHeldNoteExpressionOnReceiver('track-1', 'device-1');
        expect(take(0, 3).map(({ pitch }) => pitch)).toEqual([60]);

        hold({ pitch: 64, receiverId: undefined, points: [[2, 80]] });
        keepHeldNoteExpressionOnReceiver('track-1', undefined);
        expect(take(0, 3)).toEqual([]);
    });

    it('keeps every note on an unchanged receiver across windows', () => {
        hold({ pitch: 60, points: [[2, 80]] });
        hold({ pitch: 62, points: [[4, 80]] });

        keepHeldNoteExpressionOnReceiver('track-1', 'device-1');
        keepHeldNoteExpressionOnReceiver('track-1', 'device-1');

        expect(take(0, 5).map(({ pitch }) => pitch)).toEqual([60, 62]);
    });

    describe('with the channel bend of the clips as the window reads them', () => {
        it('moves a following note that has no curve of its own at each move of the window', () => {
            hold({ points: [], followsChannelBend: true });

            expect(take(0, 5, 'track-1', [move(1, 8_191), move(3, 0)])).toEqual([
                { pitch: 64, channel: 2, change: bendChange(1, 8_191) },
                { pitch: 64, channel: 2, change: bendChange(3, 0) },
            ]);
        });

        it('reads the clips again in every window, so a move that is no longer there reaches no note', () => {
            hold({ points: [], followsChannelBend: true });

            expect(take(0, 5, 'track-1', [move(1, 8_191)])).toHaveLength(1);
            // The lane was edited: this window's clips hold other moves, and the first is not repeated.
            expect(take(5, 8, 'track-1', [move(6, 4_096)])).toEqual([
                { pitch: 64, channel: 2, change: bendChange(6, 4_096) },
            ]);
            expect(take(8, 9, 'track-1', [])).toEqual([]);
        });

        it('hands a move to a note only between its start and its release, on the note’s own frames', () => {
            hold({ pitch: 60, points: [], releaseBeat: 4, followsChannelBend: true });
            hold({ pitch: 67, points: [], releaseBeat: 10, followsChannelBend: true });

            const due = take(0, 6, 'track-1', [move(0, 100), move(2, 200), move(4, 300), move(5, 400)]);

            // The move on the start frame is the note-on's own; the one on the release frame is dropped with the voice.
            expect(due.map(({ pitch, change: { beat, expression } }) => [pitch, beat, expression.pitchBend])).toEqual([
                [60, 2, 200],
                [67, 2, 200],
                [67, 4, 300],
                [67, 5, 400],
            ]);
        });

        it('places a move on the clock the note was started on, not on the window’s own', () => {
            hold({ points: [], releaseBeat: 4, followsChannelBend: true });

            // The window's clock puts beat 3.9999 past the note's release frame, the note's clock before it.
            const lateOnTheWindowClock = {
                beat: 3.9999,
                frame: 4_001,
                recordedBeat: 3.9999,
                value: 8_191,
                rangeSemitones: 2,
            };
            const due = take(0, 6, 'track-1', [lateOnTheWindowClock]);

            expect(due).toHaveLength(1);
            expect(due[0]?.change.frame).toBeCloseTo(3_999.9, 6);
        });

        it('leaves a move on the closing beat of the window to the window that opens there', () => {
            hold({ points: [], followsChannelBend: true });

            expect(take(0, 3, 'track-1', [move(3, 8_191)])).toEqual([]);
            expect(take(3, 5, 'track-1', [move(3, 8_191)])).toEqual([
                { pitch: 64, channel: 2, change: bendChange(3, 8_191) },
            ]);
        });

        it('gives a note that does not follow the channel bend none of the moves its neighbour follows', () => {
            // The note that follows is taken first, so the moves are already read when the other one is.
            hold({ pitch: 67, points: [], followsChannelBend: true });
            hold({ pitch: 60, points: [[3, 80]], followsChannelBend: false });

            const due = take(0, 6, 'track-1', [move(1, 8_191)]);

            expect(
                due.map(({ pitch, change: { beat, expression } }) => [
                    pitch,
                    beat,
                    expression.pressure,
                    expression.pitchBend,
                ])
            ).toEqual([
                [67, 1, 10, 8_191],
                [60, 3, 80, undefined],
            ]);
        });

        it('reads the clips once for every note that follows the channel bend', () => {
            const readChannelBend = vi.fn(() => [move(1, 8_191)]);
            hold({ pitch: 60, points: [], followsChannelBend: true });
            hold({ pitch: 67, points: [], followsChannelBend: true });

            takeHeldNoteExpression({ trackId: 'track-1', fromBeat: 0, toBeat: 5, fromFrame: 0, readChannelBend });

            expect(readChannelBend).toHaveBeenCalledTimes(1);
        });

        it('asks for the moves only when a sounding note follows the channel bend', () => {
            const readChannelBend = vi.fn(() => [move(1, 8_191)]);
            hold({ points: [[2, 80]], followsChannelBend: false });

            takeHeldNoteExpression({ trackId: 'track-1', fromBeat: 0, toBeat: 5, fromFrame: 0, readChannelBend });
            expect(readChannelBend).not.toHaveBeenCalled();

            hold({ points: [], followsChannelBend: true });
            takeHeldNoteExpression({ trackId: 'track-1', fromBeat: 5, toBeat: 6, fromFrame: 5000, readChannelBend });
            expect(readChannelBend).toHaveBeenCalledTimes(1);
        });

        it('gives a note a window resumes the bend in force at the frame the window opens, ahead of its own moves', () => {
            hold({ points: [], followsChannelBend: true });

            // The moves at 1 and 2 fell in a muted span; the one at 6 is the window's own.
            const due = take(5, 8, 'track-1', [move(1, 8_191), move(2, 4_096), move(6, 0)]);

            expect(due.map(({ change: { beat, frame, expression } }) => [beat, frame, expression.pitchBend])).toEqual([
                [5, 5007, 4_096],
                [6, 6000, 0],
            ]);
        });

        /** A following note whose only bend points are its own, at ±48, placed on the given clock. */
        function holdFollowingNote(pitchBend: { offsetBeats: number; value: number }[], clock = frameAtBeat) {
            holdNoteExpression({
                trackId: 'track-1',
                pitch: 64,
                channel: 2,
                receiverId: 'device-1',
                releaseBeat: 10,
                followsChannelBend: true,
                timeline: startNoteExpression({
                    note: { pitchBendRangeSemitones: 48, expression: { pitchBend } },
                    startBeat: 0,
                    releaseFrame: 10_000,
                    frameAtBeat: clock,
                }).timeline,
            });
        }

        const bends = (due: ReturnType<typeof take>) =>
            due.map(({ change: { beat, expression } }) => [
                beat,
                expression.pitchBend,
                expression.pitchBendRangeSemitones,
            ]);

        it('does not replay a move on the beat of the note’s own bend point over that point when a window resumes', () => {
            holdFollowingNote([{ offsetBeats: 1, value: 4_000 }]);

            // The move and the point share beat 1, and the point has the last word there.
            expect(bends(take(0, 1.5, 'track-1', [move(1, 8_191)]))).toEqual([[1, 4_000, 48]]);
            expect(bends(take(1.5, 3, 'track-1', [move(1, 8_191)]))).toEqual([[1.5, 4_000, 48]]);
        });

        it('does not replay a move that shares a frame with the note’s own bend point and sits a rounding step after it', () => {
            // Both land on frame 1000 of a clock that rounds to whole frames; the move is the later beat, but the
            // note’s own point has the last word at the frame.
            const wholeFrames = (beat: number) => Math.round(beat * 1000);
            holdFollowingNote([{ offsetBeats: 1.0001, value: 4_000 }], wholeFrames);
            const roundingStepLater = {
                beat: 1.0004,
                frame: 1000,
                recordedBeat: 1.0004,
                value: 8_191,
                rangeSemitones: 2,
            };

            expect(bends(take(0, 1.5, 'track-1', [roundingStepLater]))).toEqual([[1.0001, 4_000, 48]]);
            expect(bends(take(2, 3, 'track-1', [roundingStepLater]))).toEqual([[2, 4_000, 48]]);
        });

        it('keeps the bend of the last move a note took when a resuming window lists only an older one', () => {
            hold({ points: [], followsChannelBend: true });

            expect(take(0, 3, 'track-1', [move(1, 8_191), move(2, 4_096)])).toHaveLength(2);
            // The lane was edited while the track was muted, and no longer holds the move at 2.
            expect(bends(take(5, 8, 'track-1', [move(1, 8_191)]))).toEqual([[5, 4_096, 2]]);
        });

        it('does not replay moves that share a frame once the note took the last of them', () => {
            // Both land on frame 1000 of a clock that rounds to whole frames, and the clips list the later beat
            // first: the move the note ends on is the one with the earlier beat.
            const wholeFrames = (beat: number) => Math.round(beat * 1000);
            holdFollowingNote([], wholeFrames);
            const listedFirst = { beat: 1.0004, frame: 1000, recordedBeat: 1.0004, value: 8_191, rangeSemitones: 2 };
            const listedLast = { beat: 1.0001, frame: 1000, recordedBeat: 1.0001, value: 4_096, rangeSemitones: 2 };

            expect(bends(take(0, 1.5, 'track-1', [listedFirst, listedLast]))).toEqual([[1.0001, 4_096, 2]]);
            expect(bends(take(2, 3, 'track-1', [listedFirst, listedLast]))).toEqual([[2, 4_096, 2]]);
        });

        it('lets a note’s own bend point overtake a move the note never took, which a window lists later', () => {
            holdFollowingNote([{ offsetBeats: 2, value: 4_000 }]);

            expect(bends(take(0, 3, 'track-1', []))).toEqual([[2, 4_000, 48]]);
            // The lane was unmuted after the point: its move at 1 is older than the point, which keeps the bend.
            expect(bends(take(5, 8, 'track-1', [move(1, 8_191)]))).toEqual([[5, 4_000, 48]]);
        });

        it('does not replay a move a note already took when a window resumes after a mute', () => {
            holdFollowingNote([{ offsetBeats: 2, value: 4_000 }]);

            expect(bends(take(0, 1.5, 'track-1', [move(1, 8_191)]))).toEqual([[1, 8_191, 2]]);
            expect(bends(take(1.5, 3, 'track-1', []))).toEqual([[2, 4_000, 48]]);
            // [3, 5) was muted: the window that resumes lists the moves from the start, and the move the note
            // took at 1 is older than its own point at 2, which still holds the bend.
            const resumed = take(5, 8, 'track-1', [move(1, 8_191)]);
            expect(bends(resumed)).toEqual([[5, 4_000, 48]]);
            // It is posted at the frame the resuming window opens on.
            expect(resumed.map(({ change }) => change.frame)).toEqual([5_007]);
        });

        it('keeps the bend a move set when a later pressure point of the note arrives', () => {
            hold({ points: [[3, 80]], followsChannelBend: true });

            const due = take(0, 8, 'track-1', [move(1, 8_191)]);

            expect(
                due.map(({ change: { beat, expression } }) => [beat, expression.pressure, expression.pitchBend])
            ).toEqual([
                [1, 10, 8_191],
                [3, 80, 8_191],
            ]);
        });

        it('drops a note once it is released, so a later window addresses nothing', () => {
            hold({ points: [], releaseBeat: 4, followsChannelBend: true });

            expect(take(0, 3, 'track-1', [move(1, 8_191)])).toHaveLength(1);
            expect(take(3, 8, 'track-1', [move(3.5, 100), move(5, 0)])).toHaveLength(1);
            expect(take(8, 9, 'track-1', [move(8.5, 0)])).toEqual([]);
        });
    });
});
