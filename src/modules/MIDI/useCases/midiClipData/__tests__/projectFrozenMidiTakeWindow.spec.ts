import { describe, expect, it } from 'vitest';

import {
    type FrozenMidiTakeSource,
    isFrozenMidiTakeSource,
    projectFrozenMidiTakeWindow,
} from '../projectFrozenMidiTakeWindow';

function source(): FrozenMidiTakeSource {
    return {
        sourceClipId: 'original',
        sourceEntryBeat: 5,
        sourceEndBeat: 9,
        phaseHeadBeat: 0,
        passLengthBeats: 4,
        rows: {
            notes: {
                present: true,
                value: [
                    { id: 'selected', pitch: 60, startBeat: 5.5, duration: 1, velocity: 100 },
                    { id: 'seam', pitch: 64, startBeat: 8.75, duration: 1, velocity: 100 },
                    { id: 'other-pass', pitch: 72, startBeat: 9.5, duration: 1, velocity: 100 },
                ],
            },
            controlChanges: {
                present: true,
                value: [{ id: 'pedal', controller: 64, value: 127, channel: 0, beat: 4.8 }],
            },
            pitchBends: {
                present: true,
                value: [{ id: 'bend', value: 2048, channel: 0, beat: 4.9 }],
            },
        },
    };
}

describe('frozen MIDI take window', () => {
    it('keeps original row ids, occurrence and controller state through right fragment windows', () => {
        const original = source();
        const first = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 0,
            fromBeat: 0,
            toBeat: 2,
        });
        const rightFirst = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 0,
            fromBeat: 2,
            toBeat: 4,
        });
        const rightSecond = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 1,
            fromBeat: 2,
            toBeat: 8,
        });
        const partialThird = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 2,
            fromBeat: 8,
            toBeat: 9,
        });

        expect(first?.notes.map((note) => [note.id, note.startBeat])).toEqual([['selected', 0.5]]);
        expect(rightFirst?.notes.map((note) => [note.id, note.startBeat, note.duration])).toEqual([
            ['seam', 3.75, 0.25],
        ]);
        expect(rightSecond?.notes.map((note) => [note.id, note.startBeat, note.duration])).toEqual([
            ['selected', 4.5, 1],
            ['seam', 7.75, 0.25],
        ]);
        expect(partialThird?.notes.map((note) => [note.id, note.startBeat])).toEqual([['selected', 8.5]]);
        expect(rightSecond?.controlChanges.map((row) => [row.id, row.beat])).toEqual([['pedal', 4]]);
        expect(rightSecond?.pitchBends.map((row) => [row.id, row.beat])).toEqual([['bend', 4]]);
        expect(rightSecond?.sourceClipId).toBe('original');
        expect(rightSecond?.absoluteOccurrenceIndex).toBe(1);
    });

    it('shifts phase with Delete Time and preserves the source occurrence', () => {
        const moved = { ...source(), phaseHeadBeat: -2 };
        const projected = projectFrozenMidiTakeWindow({
            source: moved,
            absoluteOccurrenceIndex: 1,
            fromBeat: 2,
            toBeat: 6,
        });
        expect(projected?.notes.map((note) => [note.id, note.startBeat])).toEqual([
            ['selected', 2.5],
            ['seam', 5.75],
        ]);
        expect(projected?.absoluteOccurrenceIndex).toBe(1);
    });

    it('treats present empty rows as empty and refuses a partial modern capture', () => {
        const original = source();
        const empty = { ...original, rows: { ...original.rows, notes: { present: true, value: [] } } };
        expect(
            projectFrozenMidiTakeWindow({ source: empty, absoluteOccurrenceIndex: 1, fromBeat: 4, toBeat: 8 })?.notes
        ).toEqual([]);

        const malformed = { ...source(), rows: { notes: { present: true, value: [] } } };
        expect(isFrozenMidiTakeSource(malformed)).toBe(false);
    });
});
