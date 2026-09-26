import { describe, it, expect } from 'vitest';

import { quantizeBeatToGrid } from '../quantizeBeatToGrid';

describe('quantizeBeatToGrid', () => {
    it('swings every second sixteenth on a 1/16 grid (0.25), leaving the eighth-note positions straight', () => {
        // Step indices 0, 1, 2, 3. Odd steps (1, 3) get delayed by swing * gridSize / 2.
        const beats = [0, 0.25, 0.5, 0.75];

        const result = beats.map((beat) => quantizeBeatToGrid({ beat, gridSize: 0.25, strength: 1, swing: 1 }));

        expect(result).toEqual([0, 0.375, 0.5, 0.875]);
    });

    it('leaves an already-swung 1/16 grid untouched on a second pass', () => {
        // A destructive quantize must leave its own output in place: each of these
        // beats already sits on the nearest point of the swung grid, so quantizing
        // them again must not walk any of them toward the next straight downbeat.
        const beats = [0, 0.375, 0.5, 0.875];

        const result = beats.map((beat) => quantizeBeatToGrid({ beat, gridSize: 0.25, strength: 1, swing: 1 }));

        expect(result).toEqual([0, 0.375, 0.5, 0.875]);
    });

    it('snaps a near-swung note to the swung sixteenth rather than the next downbeat', () => {
        // 0.42 is closer to the swung point at 0.375 than to the straight downbeat at 0.5.
        const result = quantizeBeatToGrid({ beat: 0.42, gridSize: 0.25, strength: 1, swing: 1 });

        expect(result).toBe(0.375);
    });

    it('snaps to a partially swung grid point at less than full swing', () => {
        const result = quantizeBeatToGrid({ beat: 0.38, gridSize: 0.25, strength: 1, swing: 0.5 });

        expect(result).toBe(0.3125);
    });

    it('breaks an exact tie between the straight and swung candidate points toward the later point', () => {
        // 0.1875 sits exactly midway between step 0 (target 0) and the swung step 1
        // (target 0.375); Math.round's own half-up rule also picks the later point.
        const result = quantizeBeatToGrid({ beat: 0.1875, gridSize: 0.25, strength: 1, swing: 1 });

        expect(result).toBe(0.375);
    });

    it('swings every second eighth on a 1/8 grid (0.5), unchanged from before the fix', () => {
        const beats = [0, 0.5, 1, 1.5];

        const result = beats.map((beat) => quantizeBeatToGrid({ beat, gridSize: 0.5, strength: 1, swing: 1 }));

        expect(result).toEqual([0, 0.75, 1, 1.75]);
    });

    it('swings every second quarter note on a 1/4 grid (1)', () => {
        const beats = [0, 1, 2, 3];

        const result = beats.map((beat) => quantizeBeatToGrid({ beat, gridSize: 1, strength: 1, swing: 1 }));

        expect(result).toEqual([0, 1.5, 2, 3.5]);
    });

    it('moves an off-grid offbeat note partway toward the swung target at partial swing and strength', () => {
        const result = quantizeBeatToGrid({ beat: 0.3, gridSize: 0.25, strength: 0.5, swing: 0.5 });

        // stepIndex = round(0.3 / 0.25) = 1 (odd). target = 0.25 + 0.5 * 0.25 / 2 = 0.3125.
        // result = 0.3 + (0.3125 - 0.3) * 0.5 = 0.30625.
        expect(result).toBeCloseTo(0.30625, 10);
    });

    it('quantizes straight to the grid line when swing is 0', () => {
        const result = quantizeBeatToGrid({ beat: 0.1, gridSize: 0.25, strength: 1, swing: 0 });

        expect(result).toBe(0);
    });
});
