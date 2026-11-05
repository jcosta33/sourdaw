import { describe, expect, it } from 'vitest';

import { type ClipPlacement, resolveAudibleNoteWindow } from '../audibleNoteWindow';

const placement = (overrides: Partial<ClipPlacement> = {}): ClipPlacement => ({
    startBeat: 8,
    endBeat: 24,
    midiOffsetBeats: 0,
    loopEnabled: false,
    ...overrides,
});

describe('resolveAudibleNoteWindow', () => {
    it.each([
        { name: 'no loop, no offset', input: {}, expected: { startBeat: 0, endBeat: 16, windowLengthBeats: 16 } },
        {
            name: 'loop shorter than the clip',
            input: { loopEnabled: true, configuredLoopLengthBeats: 8 },
            expected: { startBeat: 0, endBeat: 8, windowLengthBeats: 8 },
        },
        {
            name: 'loop length ignored while looping is off',
            input: { configuredLoopLengthBeats: 8 },
            expected: { startBeat: 0, endBeat: 16, windowLengthBeats: 16 },
        },
        {
            name: 'positive midi offset',
            input: { midiOffsetBeats: 2 },
            expected: { startBeat: 2, endBeat: 18, windowLengthBeats: 16 },
        },
        {
            name: 'loop anchor carries the floor back by the trim advance',
            input: { loopEnabled: true, configuredLoopLengthBeats: 8, loopOriginBeat: 6, midiOffsetBeats: 3 },
            expected: { startBeat: 1, endBeat: 9, windowLengthBeats: 8 },
        },
    ])('$name', ({ input, expected }) => {
        expect(resolveAudibleNoteWindow(placement(input))).toEqual(expected);
    });

    it.each([
        { name: 'infinite end', input: { endBeat: Number.POSITIVE_INFINITY } },
        { name: 'infinite end while looping', input: { endBeat: Number.POSITIVE_INFINITY, loopEnabled: true } },
        { name: 'NaN end', input: { endBeat: Number.NaN } },
        { name: 'zero length', input: { endBeat: 8 } },
    ])('returns no window for $name', ({ input }) => {
        expect(resolveAudibleNoteWindow(placement(input))).toBeUndefined();
    });
});
