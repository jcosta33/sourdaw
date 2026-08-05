import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { retrogradeMidiNotes } from '../retrogradeMidiNotes';

function note(id: string, startBeat: number, duration: number, velocity = 100): MidiNote {
    return { id, pitch: 60, startBeat, duration, velocity };
}

describe('retrogradeMidiNotes', () => {
    it('clones each note unchanged when fewer than 2 notes', () => {
        expect(retrogradeMidiNotes([])).toEqual([]);

        const single = retrogradeMidiNotes([note('a', 0, 1)]);
        expect(single).toEqual([note('a', 0, 1)]);
    });

    it('mirrors startBeat across the clip span while preserving duration', () => {
        // Notes at beats 0 (dur 1) and 2 (dur 1).
        // minStart=0, maxEnd=3, totalLength=3.
        // For note at 0,dur1: 0 + 3 - (0 - 0) - 1 = 2
        // For note at 2,dur1: 0 + 3 - (2 - 0) - 1 = 0
        const result = retrogradeMidiNotes([note('a', 0, 1), note('b', 2, 1)]);
        expect(result.map((n) => [n.startBeat, n.duration])).toEqual([
            [2, 1],
            [0, 1],
        ]);
    });

    it('offsets the clip start when notes do not begin at beat 0', () => {
        // Notes at beats 4 (dur 2) and 8 (dur 2).
        // minStart=4, maxEnd=10, totalLength=6.
        // For note at 4,dur2: 4 + 6 - (4-4) - 2 = 8
        // For note at 8,dur2: 4 + 6 - (8-4) - 2 = 4
        const result = retrogradeMidiNotes([note('a', 4, 2), note('b', 8, 2)]);
        expect(result.map((n) => n.startBeat)).toEqual([8, 4]);
    });

    it('preserves pitch and velocity while reversing time', () => {
        const result = retrogradeMidiNotes([
            { id: 'a', pitch: 55, startBeat: 0, duration: 1, velocity: 70 },
            { id: 'b', pitch: 67, startBeat: 1, duration: 1, velocity: 90 },
        ]);
        // minStart=0, maxEnd=2, totalLength=2.
        // a at 0,dur1 → 0+2-0-1 = 1
        // b at 1,dur1 → 0+2-1-1 = 0
        expect(result).toEqual([
            { id: 'a', pitch: 55, startBeat: 1, duration: 1, velocity: 70 },
            { id: 'b', pitch: 67, startBeat: 0, duration: 1, velocity: 90 },
        ]);
    });
});
