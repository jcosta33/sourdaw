import { describe, expect, it } from 'vitest';

import { quantizeMidiNotes } from '../quantizeMidiNotes';

import type { MidiNote } from '../../models/MidiNote';

function note(startBeat: number, duration = 1, pitch = 60): MidiNote {
    return {
        id: `n-${startBeat}`,
        pitch,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('quantizeMidiNotes', () => {
    it('snaps each note to the nearest grid division', () => {
        // gridSize 0.25 (1/16 at 4/4). Notes off the grid get pulled to it.
        const notes = [note(0.1), note(0.6), note(1.15), note(2.4)];

        const result = quantizeMidiNotes({ notes, gridSize: 0.25 });

        // 0.1 → 0, 0.6 → 0.5, 1.15 → 1.25, 2.4 → 2.5
        expect(result[0]?.startBeat).toBe(0);
        expect(result[1]?.startBeat).toBe(0.5);
        expect(result[2]?.startBeat).toBe(1.25);
        expect(result[3]?.startBeat).toBe(2.5);
    });

    it('preserves pitch, duration, and velocity (only startBeat changes)', () => {
        const notes = [note(0.3, 2, 72)];

        const result = quantizeMidiNotes({ notes, gridSize: 0.5 });

        expect(result[0]?.startBeat).toBe(0.5);
        expect(result[0]?.duration).toBe(2);
        expect(result[0]?.pitch).toBe(72);
        expect(result[0]?.velocity).toBe(100);
    });

    it('moves notes partway toward the grid at strength < 1', () => {
        const notes = [note(0.25)]; // exactly between 0 and 0.5 grid lines

        // strength 0.5: moves halfway from 0.25 to the nearest grid (0.5).
        const result = quantizeMidiNotes({ notes, gridSize: 0.5, strength: 0.5 });

        // target = 0.5, startBeat = 0.25 + (0.5 - 0.25) * 0.5 = 0.375.
        expect(result[0]?.startBeat).toBeCloseTo(0.375, 5);
    });

    it('does not move notes when strength is 0', () => {
        const notes = [note(0.3)];

        const result = quantizeMidiNotes({ notes, gridSize: 0.5, strength: 0 });

        expect(result[0]?.startBeat).toBe(0.3);
    });

    it('applies swing to offbeat (odd swing-unit) notes but not on-beat notes', () => {
        // gridSize 0.5, swing 1.0 (full). Swing unit is 0.5 beats.
        // A note at beat 0.0 is on-beat (swing unit index 0, even → no swing).
        // A note at beat 0.5 is offbeat (swing unit index 1, odd → swing offset).
        const notes = [note(0.0), note(0.5)];

        const result = quantizeMidiNotes({ notes, gridSize: 0.5, swing: 1.0 });

        // On-beat: stays at 0.
        expect(result[0]?.startBeat).toBe(0);
        // Off-beat: swing offset = swing * (gridSize / 2) = 1.0 * 0.25 = 0.25.
        // Target = 0.5 + 0.25 = 0.75.
        expect(result[1]?.startBeat).toBeCloseTo(0.75, 5);
    });

    it('applies partial swing proportionally', () => {
        const notes = [note(0.5)];

        // swing 0.5: offset = 0.5 * (0.5 / 2) = 0.125. Target = 0.5 + 0.125 = 0.625.
        const result = quantizeMidiNotes({ notes, gridSize: 0.5, swing: 0.5 });

        expect(result[0]?.startBeat).toBeCloseTo(0.625, 5);
    });

    it('combines swing and strength', () => {
        const notes = [note(0.45)];

        // gridSize 0.5: quantized to 0.5 (nearest). Offbeat (index 1).
        // swing 1.0: offset = 0.25. Target = 0.5 + 0.25 = 0.75.
        // strength 0.5: startBeat = 0.45 + (0.75 - 0.45) * 0.5 = 0.45 + 0.15 = 0.6.
        const result = quantizeMidiNotes({ notes, gridSize: 0.5, swing: 1.0, strength: 0.5 });

        expect(result[0]?.startBeat).toBeCloseTo(0.6, 5);
    });

    it('returns a new array (does not mutate the input notes)', () => {
        const original = [note(0.3)];
        const originalBeat = original[0]!.startBeat;

        quantizeMidiNotes({ notes: original, gridSize: 0.5 });

        // The original note object is unchanged.
        expect(original[0]?.startBeat).toBe(originalBeat);
    });

    it('handles an empty note array', () => {
        const result = quantizeMidiNotes({ notes: [], gridSize: 0.25 });

        expect(result).toEqual([]);
    });

    it('does not shift a note already on the grid with no swing', () => {
        const notes = [note(1.0), note(2.0)];

        const result = quantizeMidiNotes({ notes, gridSize: 0.5, swing: 0 });

        expect(result[0]?.startBeat).toBe(1.0);
        expect(result[1]?.startBeat).toBe(2.0);
    });
});
