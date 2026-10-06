import { describe, expect, it } from 'vitest';

import { type MidiCC } from '../../../models/MidiNote';
import { projectClipControllerRestore } from '../projectClipControllerRestore';

function controller(id: string, beat: number, value: number, cc = 64, channel = 0): MidiCC {
    return { id, controller: cc, value, beat, channel };
}

function placed(moves: readonly MidiCC[]): { controller: number; beat: number; value: number }[] {
    return moves.map(({ controller: cc, beat, value }) => ({ controller: cc, beat, value }));
}

/** A pedal that is up at the head, down at 3.5 and up again at 6, over an 8-beat clip. */
const pedalLane = [controller('up-0', 0, 0), controller('down', 3.5, 127), controller('up-6', 6, 0)];
const eightBeatClip = { startBeat: 0, endBeat: 8 };

describe('projectClipControllerRestore', () => {
    it('sends the value in force at a destination inside the clip', () => {
        const before = projectClipControllerRestore({ controlChanges: pedalLane, clip: eightBeatClip, atBeat: 2 });
        const during = projectClipControllerRestore({ controlChanges: pedalLane, clip: eightBeatClip, atBeat: 4 });
        const after = projectClipControllerRestore({ controlChanges: pedalLane, clip: eightBeatClip, atBeat: 7 });

        expect(placed(before.moves)).toEqual([{ controller: 64, beat: 2, value: 0 }]);
        expect(placed(during.moves)).toEqual([{ controller: 64, beat: 4, value: 127 }]);
        expect(placed(after.moves)).toEqual([{ controller: 64, beat: 7, value: 0 }]);
    });

    it('leaves a lane with a row on the destination to the window that opens there', () => {
        const restore = projectClipControllerRestore({ controlChanges: pedalLane, clip: eightBeatClip, atBeat: 3.5 });

        expect(restore.moves).toEqual([]);
        expect(restore.held).toEqual(new Set([64]));
    });

    it('takes the later source row when two rows of a lane share the beat before the destination', () => {
        const restore = projectClipControllerRestore({
            controlChanges: [controller('first', 1, 127), controller('second', 1, 0)],
            clip: eightBeatClip,
            atBeat: 2,
        });

        expect(placed(restore.moves)).toEqual([{ controller: 64, beat: 2, value: 0 }]);
    });

    it('keeps each controller and channel a lane of its own', () => {
        const restore = projectClipControllerRestore({
            controlChanges: [
                controller('sustain', 0, 127),
                controller('sostenuto', 1, 64, 66),
                controller('other-channel', 1.5, 90, 64, 3),
            ],
            clip: eightBeatClip,
            atBeat: 2,
        });

        expect(placed(restore.moves)).toEqual(
            expect.arrayContaining([
                { controller: 64, beat: 2, value: 127 },
                { controller: 66, beat: 2, value: 64 },
                { controller: 64, beat: 2, value: 90 },
            ])
        );
        expect(restore.moves).toHaveLength(3);
        expect(restore.held).toEqual(new Set([64, 66]));
    });

    it('sends nothing for a lane that has no row before the destination', () => {
        const restore = projectClipControllerRestore({
            controlChanges: [controller('late', 5, 127)],
            clip: eightBeatClip,
            atBeat: 2,
        });

        expect(restore).toEqual({ moves: [], held: new Set() });
    });

    it('reads the value in force within the loop pass the destination falls in', () => {
        // Passes of 4 beats: the second pass holds 127 from its beat 1 and 0 from its beat 3.
        const lane = [controller('down', 1, 127), controller('up', 3, 0)];
        const clip = { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 };

        const midPass = projectClipControllerRestore({ controlChanges: lane, clip, atBeat: 6 });
        const lateInPass = projectClipControllerRestore({ controlChanges: lane, clip, atBeat: 7.5 });

        expect(placed(midPass.moves)).toEqual([{ controller: 64, beat: 6, value: 127 }]);
        expect(placed(lateInPass.moves)).toEqual([{ controller: 64, beat: 7.5, value: 0 }]);
    });

    it('reads the value in force past the clip content offset', () => {
        // The clip plays content from beat 1, so the row at 0.5 is before its visible span and still in force.
        const restore = projectClipControllerRestore({
            controlChanges: [controller('held', 0.5, 127)],
            clip: { startBeat: 4, endBeat: 8, midiOffsetBeats: 1 },
            atBeat: 5,
        });

        expect(placed(restore.moves)).toEqual([{ controller: 64, beat: 5, value: 127 }]);
    });

    it('leaves a pass head to the window that carries it, and still names what the head holds', () => {
        const clip = { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4, midiOffsetBeats: 1 };

        const onSecondHead = projectClipControllerRestore({
            controlChanges: [controller('held', 0.5, 127)],
            clip,
            atBeat: 4,
        });

        expect(onSecondHead.moves).toEqual([]);
        expect(onSecondHead.held).toEqual(new Set([64]));
    });

    it('sends nothing for a destination outside the clip', () => {
        const before = projectClipControllerRestore({
            controlChanges: pedalLane,
            clip: { startBeat: 4, endBeat: 8 },
            atBeat: 2,
        });
        const atEnd = projectClipControllerRestore({ controlChanges: pedalLane, clip: eightBeatClip, atBeat: 8 });

        expect(before).toEqual({ moves: [], held: new Set() });
        expect(atEnd).toEqual({ moves: [], held: new Set() });
    });
});
