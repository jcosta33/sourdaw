import { describe, expect, it } from 'vitest';

import { frozenMidiTakeRepeatAt, frozenMidiTakeRepeats, type FrozenMidiTakeFragment } from '../frozenMidiTakeRepeats';
import { type FrozenMidiTakeSource } from '../isFrozenMidiTakeSource';

const rows: FrozenMidiTakeSource['rows'] = {
    notes: { present: true, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

/** The first pass of a recording begun at 6 in loop [8, 12): its take reads source 2 at 8. */
const firstPass: FrozenMidiTakeSource = {
    sourceClipId: 'source',
    rows,
    sourceEntryBeat: 2,
    sourceEndBeat: 6,
    phaseHeadBeat: 8,
    passLengthBeats: 4,
};

function spans(fragment: FrozenMidiTakeFragment, fromBeat: number, toBeat: number): number[][] {
    return frozenMidiTakeRepeats(firstPass, fragment, fromBeat, toBeat).map((repeat) => [
        repeat.absoluteOccurrenceIndex,
        repeat.startBeat,
        repeat.passHeadBeat,
        repeat.endBeat,
        repeat.strideBeats,
    ]);
}

describe('frozen MIDI take repeats', () => {
    it('reads a fragment that does not loop as one repeat, from the fragment start to its end', () => {
        // A comp from the clip start at 6 reads source 0 there: the run-up, with no rule of its own.
        expect(spans({ startBeat: 6, endBeat: 12 }, 6, 12)).toEqual([[0, 6, 8, 12, 6]]);
        expect(spans({ startBeat: 6, endBeat: 8 }, 6, 8)).toEqual([[0, 6, 8, 8, 2]]);
        // Past the pass end it reads straight through, as live does.
        expect(spans({ startBeat: 9, endBeat: 20 }, 9, 20)).toEqual([[0, 9, 8, 20, 11]]);
    });

    it.each([
        {
            fromBeat: 9.5,
            toBeat: 17.5,
            expected: [
                [0, 9.5, 8, 13.5, 4],
                [1, 13.5, 12, 17.5, 4],
            ],
        },
        { fromBeat: 14, toBeat: 15, expected: [[1, 13.5, 12, 17.5, 4]] },
        { fromBeat: 17.5, toBeat: 30, expected: [] },
    ])(
        'restarts a looping fragment every loop length from its own start over [$fromBeat, $toBeat)',
        ({ fromBeat, toBeat, expected }) => {
            expect(
                spans({ startBeat: 9.5, endBeat: 17.5, loopEnabled: true, loopLength: 4 }, fromBeat, toBeat)
            ).toEqual(expected);
        }
    );

    it('restarts every loop length, not every pass length, when the clip loops on another length', () => {
        // The pass is four beats; the clip loops every two, then every six.
        expect(spans({ startBeat: 8, endBeat: 14, loopEnabled: true, loopLength: 2 }, 8, 14)).toEqual([
            [0, 8, 8, 10, 2],
            [1, 10, 10, 12, 2],
            [2, 12, 12, 14, 2],
        ]);
        expect(spans({ startBeat: 8, endBeat: 20, loopEnabled: true, loopLength: 6 }, 8, 20)).toEqual([
            [0, 8, 8, 14, 6],
            [1, 14, 14, 20, 6],
        ]);
    });

    it('ends the last repeat of a looping fragment at the fragment end', () => {
        expect(spans({ startBeat: 6, endBeat: 11, loopEnabled: true, loopLength: 4 }, 6, 11)).toEqual([
            [0, 6, 8, 10, 4],
            [1, 10, 12, 11, 4],
        ]);
    });

    it('finds the repeat sounding at a beat, and none outside the fragment', () => {
        const fragment = { startBeat: 9.5, endBeat: 17.5, loopEnabled: true, loopLength: 4 };
        expect(frozenMidiTakeRepeatAt(firstPass, fragment, 9)).toBeNull();
        expect(frozenMidiTakeRepeatAt(firstPass, fragment, 9.5)).toMatchObject({ absoluteOccurrenceIndex: 0 });
        expect(frozenMidiTakeRepeatAt(firstPass, fragment, 13.5)).toMatchObject({
            absoluteOccurrenceIndex: 1,
            startBeat: 13.5,
            passHeadBeat: 12,
        });
        expect(frozenMidiTakeRepeatAt(firstPass, fragment, 17.5)).toBeNull();
        expect(frozenMidiTakeRepeatAt(firstPass, { startBeat: 6, endBeat: 12 }, 6.5)).toMatchObject({
            absoluteOccurrenceIndex: 0,
            passHeadBeat: 8,
        });
    });
});
