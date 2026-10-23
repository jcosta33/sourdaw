import { afterEach, describe, expect, it } from 'vitest';

import {
    forgetHeldNoteExpression,
    holdNoteExpression,
    keepHeldNoteExpressionOnReceiver,
    takeHeldNoteExpression,
} from '../heldNoteExpression';

const change = (beat: number, pressure: number) => ({ beat, frame: beat * 1000, expression: { pressure } });

function hold(overrides: Partial<Parameters<typeof holdNoteExpression>[0]> = {}) {
    holdNoteExpression({
        trackId: 'track-1',
        pitch: 64,
        channel: 2,
        receiverId: 'device-1',
        releaseBeat: 10,
        changes: [change(2, 80), change(4, 90)],
        ...overrides,
    });
}

function take(fromBeat: number, toBeat: number, trackId = 'track-1') {
    return takeHeldNoteExpression({ trackId, fromBeat, toBeat, fromFrame: fromBeat * 1000 + 7 });
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

    it('holds nothing for a note without changes to park', () => {
        hold({ changes: [] });

        expect(take(0, 8)).toEqual([]);
    });

    it('keeps a track’s other notes when one of them is taken from', () => {
        hold({ pitch: 60, changes: [change(2, 80)] });
        hold({ pitch: 67, changes: [change(6, 90)] });

        expect(take(0, 3).map(({ pitch }) => pitch)).toEqual([60]);
        expect(take(5, 7).map(({ pitch }) => pitch)).toEqual([67]);
    });

    it('keeps another track’s notes out of a window and out of a forget on a receiver', () => {
        hold({ trackId: 'track-1', changes: [change(2, 80)] });
        hold({ trackId: 'track-2', receiverId: 'device-2', changes: [change(2, 70)] });

        keepHeldNoteExpressionOnReceiver('track-1', undefined);

        expect(take(0, 3, 'track-1')).toEqual([]);
        expect(take(0, 3, 'track-2')).toEqual([{ pitch: 64, channel: 2, change: change(2, 70) }]);
    });

    it('gives a note the last change a skipped window dropped, at the frame its window opens', () => {
        hold({ changes: [change(2, 80), change(3, 85), change(6, 90)] });

        // The windows through beat 5 did not run: the beat 6 change is the window's own.
        expect(take(5, 7)).toEqual([
            { pitch: 64, channel: 2, change: { beat: 5, frame: 5007, expression: { pressure: 85 } } },
            { pitch: 64, channel: 2, change: change(6, 90) },
        ]);
    });

    it('gives the chase ahead of a change the window opens on, so the window’s own change has the last word', () => {
        hold({ changes: [change(2, 80), change(5, 90)] });

        expect(take(5, 7).map(({ change: { beat, expression } }) => [beat, expression.pressure])).toEqual([
            [5, 80],
            [5, 90],
        ]);
    });

    it('chases a note whose dropped change was the only one it had left', () => {
        hold({ changes: [change(2, 80)] });

        expect(take(5, 7).map(({ change: { expression } }) => expression.pressure)).toEqual([80]);
        expect(take(7, 9)).toEqual([]);
    });

    it('gives nothing to a note released before the window or on its opening beat', () => {
        hold({ pitch: 60, releaseBeat: 4, changes: [change(2, 80)] });
        hold({ pitch: 62, releaseBeat: 5, changes: [change(2, 80)] });
        hold({ pitch: 64, releaseBeat: 5.5, changes: [change(2, 80)] });

        expect(take(5, 7).map(({ pitch }) => pitch)).toEqual([64]);
    });

    it('posts nothing for a window that opens before any parked change', () => {
        hold();

        expect(take(0, 2)).toEqual([]);
        expect(take(2, 2.5)).toEqual([{ pitch: 64, channel: 2, change: change(2, 80) }]);
    });

    it('keeps only the notes its receiver voiced, and none while the receiver is bypassed', () => {
        hold({ pitch: 60, receiverId: 'device-1', changes: [change(2, 80)] });
        hold({ pitch: 62, receiverId: 'device-2', changes: [change(2, 80)] });
        hold({ pitch: 64, receiverId: undefined, changes: [change(2, 80)] });

        keepHeldNoteExpressionOnReceiver('track-1', 'device-1');
        expect(take(0, 3).map(({ pitch }) => pitch)).toEqual([60]);

        hold({ pitch: 64, receiverId: undefined, changes: [change(2, 80)] });
        keepHeldNoteExpressionOnReceiver('track-1', undefined);
        expect(take(0, 3)).toEqual([]);
    });

    it('keeps every note on an unchanged receiver across windows', () => {
        hold({ pitch: 60, changes: [change(2, 80)] });
        hold({ pitch: 62, changes: [change(4, 80)] });

        keepHeldNoteExpressionOnReceiver('track-1', 'device-1');
        keepHeldNoteExpressionOnReceiver('track-1', 'device-1');

        expect(take(0, 5).map(({ pitch }) => pitch)).toEqual([60, 62]);
    });
});
