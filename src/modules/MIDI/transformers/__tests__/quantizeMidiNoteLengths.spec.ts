import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { quantizeMidiNoteLengths } from '../quantizeMidiNoteLengths';

function note(id: string, duration: number): MidiNote {
    return { id, pitch: 60, startBeat: 0, duration, velocity: 100 };
}

describe('quantizeMidiNoteLengths', () => {
    it('snaps each duration to the nearest grid multiple', () => {
        const result = quantizeMidiNoteLengths({
            notes: [note('a', 0.3), note('b', 0.6), note('c', 1.1)],
            gridSize: 0.25,
        });
        // 0.3 / 0.25 = 1.2 → round to 1 → 0.25
        // 0.6 / 0.25 = 2.4 → round to 2 → 0.5
        // 1.1 / 0.25 = 4.4 → round to 4 → 1.0
        expect(result.map((n) => n.duration)).toEqual([0.25, 0.5, 1.0]);
    });

    it('returns clones unchanged when gridSize is below the minimum threshold', () => {
        const original = [note('a', 0.3)];
        const result = quantizeMidiNoteLengths({
            notes: original,
            gridSize: 0.01, // below MIN_NOTE_LENGTH_GRID_SIZE (0.03125)
        });
        expect(result).toEqual([note('a', 0.3)]);
        // Fresh object, not the same reference.
        expect(result[0]).not.toBe(original[0]);
    });

    it('returns clones unchanged when gridSize is not finite', () => {
        const original = [note('a', 0.3)];
        const result = quantizeMidiNoteLengths({
            notes: original,
            gridSize: Number.POSITIVE_INFINITY,
        });
        expect(result).toEqual([note('a', 0.3)]);
    });

    it('preserves original duration when the snap would produce zero multiples', () => {
        // duration 0.1, gridSize 0.25 → 0.1/0.25 = 0.4 → round to 0 → multiples < 1 → keep original
        const result = quantizeMidiNoteLengths({
            notes: [note('a', 0.1)],
            gridSize: 0.25,
        });
        expect(result[0]?.duration).toBe(0.1);
    });
});
