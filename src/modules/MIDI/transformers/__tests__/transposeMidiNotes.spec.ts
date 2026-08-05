import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { transposeMidiNotes } from '../transposeMidiNotes';

function note(id: string, pitch: number): MidiNote {
    return { id, pitch, startBeat: 0, duration: 1, velocity: 100 };
}

describe('transposeMidiNotes', () => {
    it('shifts each pitch by the given semitones and preserves other fields', () => {
        const result = transposeMidiNotes({
            notes: [
                { id: 'a', pitch: 60, startBeat: 2, duration: 0.5, velocity: 80 },
                { id: 'b', pitch: 64, startBeat: 3, duration: 1, velocity: 99 },
            ],
            semitones: 5,
        });
        expect(result).toEqual([
            { id: 'a', pitch: 65, startBeat: 2, duration: 0.5, velocity: 80 },
            { id: 'b', pitch: 69, startBeat: 3, duration: 1, velocity: 99 },
        ]);
    });

    it('clamps transposed pitch to [0, 127]', () => {
        const up = transposeMidiNotes({ notes: [note('a', 120)], semitones: 20 });
        expect(up[0]?.pitch).toBe(127);

        const down = transposeMidiNotes({ notes: [note('b', 5)], semitones: -20 });
        expect(down[0]?.pitch).toBe(0);
    });

    it('handles negative transposition', () => {
        const result = transposeMidiNotes({ notes: [note('a', 60)], semitones: -12 });
        expect(result[0]?.pitch).toBe(48);
    });
});
