import { describe, expect, it } from 'vitest';

import { frozenMidiTakeRepeatAt, frozenMidiTakeRepeats } from '../frozenMidiTakeRepeats';
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

/** The same pass, captured with the run-up from the clip start at 6. */
const firstPassWithRunUp: FrozenMidiTakeSource = { ...firstPass, runUpEntryBeat: 0 };

function spans(source: FrozenMidiTakeSource, fromBeat: number, toBeat: number): number[][] {
    return frozenMidiTakeRepeats(source, fromBeat, toBeat).map((repeat) => [
        repeat.absoluteOccurrenceIndex,
        repeat.startBeat,
        repeat.passHeadBeat,
        repeat.endBeat,
        repeat.strideBeats,
    ]);
}

describe('frozen MIDI take repeats', () => {
    it.each([
        { fromBeat: 6, toBeat: 12, expected: [[0, 8, 8, 12, 4]] },
        { fromBeat: 6, toBeat: 8, expected: [] },
        {
            fromBeat: 9,
            toBeat: 17,
            expected: [
                [0, 8, 8, 12, 4],
                [1, 12, 12, 16, 4],
                [2, 16, 16, 20, 4],
            ],
        },
        { fromBeat: 12, toBeat: 16, expected: [[1, 12, 12, 16, 4]] },
    ])(
        'strides a source with no run-up from its pass head over [$fromBeat, $toBeat)',
        ({ fromBeat, toBeat, expected }) => {
            expect(spans(firstPass, fromBeat, toBeat)).toEqual(expected);
        }
    );

    it('opens the first repeat at its run-up and every later repeat at its pass head', () => {
        expect(spans(firstPassWithRunUp, 6, 16)).toEqual([
            [0, 6, 8, 12, 6],
            [1, 12, 12, 16, 4],
        ]);
    });

    it('reaches the first repeat from a window that ends inside its run-up', () => {
        expect(spans(firstPassWithRunUp, 6, 8)).toEqual([[0, 6, 8, 12, 6]]);
        expect(spans(firstPassWithRunUp, 4, 6)).toEqual([]);
    });

    it('finds the repeat sounding at a beat, the run-up belonging to the first', () => {
        expect(frozenMidiTakeRepeatAt(firstPass, 6.5)).toBeNull();
        expect(frozenMidiTakeRepeatAt(firstPassWithRunUp, 5.5)).toBeNull();
        expect(frozenMidiTakeRepeatAt(firstPassWithRunUp, 6.5)).toMatchObject({ absoluteOccurrenceIndex: 0 });
        expect(frozenMidiTakeRepeatAt(firstPassWithRunUp, 9)).toMatchObject({ absoluteOccurrenceIndex: 0 });
        expect(frozenMidiTakeRepeatAt(firstPassWithRunUp, 13)).toMatchObject({
            absoluteOccurrenceIndex: 1,
            startBeat: 12,
        });
        // A pass shorter than its stride leaves a gap no repeat sounds in.
        expect(frozenMidiTakeRepeatAt({ ...firstPass, sourceEndBeat: 4 }, 11)).toBeNull();
    });
});
